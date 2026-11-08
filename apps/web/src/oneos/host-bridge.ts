/**
 * The OneOS host bridge for Cut (doctrine files/016, files/989): `postMessage` to the ONE parent the frame page declared.
 *
 * The frame page's loader sets `globalThis.__craftHost = {app, version, parent}`; the editor lives on its own origin, so the parent is a
 * DIFFERENT origin. Messages go to that origin only, and only that window on that origin is heard; a message of another session, of a
 * wrong shape, or over the bound is dropped.
 *
 * - `craft:ready {app, version}` (to the parent): listening; send the file now.
 * - `craft:open {session, name, mime, bytes, versionId, readOnly}` (from the parent): the `.otio` to open (an ArrayBuffer).
 * - `craft:dirty {session, dirty}` (to the parent): unsaved changes appeared or went away.
 * - `craft:save {session, name, mime, bytes, baseVersionId, saveAs}` (to the parent): the person saved; the bytes are transferred. The host
 *   makes a NEW version through the compare-and-set on the version it opened and answers `craft:saved {session, versionId}` or
 *   `craft:refused {session, code, reason}`. An export (MP4/WebM) goes with `saveAs: true`: a new file beside the project, never the project.
 * - `craft:failed {error}` (to the parent): the editor could not start, or the file was refused (by name).
 * - `craft:command {session, id, method: "command.batch", params: {label, steps}}` (from the parent): the assistant's run (files/025), handed
 *   to the editor (`onCommand`) and answered `craft:result {session, id, ok, result | error}`; any other method is answered refused, by name.
 * - `craft:medium:need {session, id, url}` (to the parent): the bytes of a medium the project uses, named by its OneOS reference
 *   `oneos:file/<file id>?version=<version>` (files/989). The host reads it as the person, through the storage proxy, and answers
 *   `craft:medium:data {session, id, url, name, mime, bytes, versionId}` (that exact version) or `{session, id, url, code, reason}`.
 *
 * There is no network call here: the bytes arrive and leave only as these messages.
 */
import { parseMediaUrl } from "./otio.ts";

/** The most bytes one medium may carry into the frame (the host states the same bound). */
export const MEDIUM_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1;

export type CommandAnswer = { ok: true; result: unknown } | { ok: false; error: string };

export type MediumAnswer = { ok: true; name: string; mime: string; bytes: Uint8Array<ArrayBuffer>; versionId: string } | { ok: false; code: string; reason: string };


export interface HostDeclared {
	app: string;
	version: string;
	parent: string;
}

export interface Opened {
	session: string;
	name: string;
	bytes: Uint8Array;
	versionId: string;
	readOnly: boolean;
}

export type SaveAnswer = { ok: true; versionId: string } | { ok: false; code: string; reason: string };

/** The window surface the bridge needs (the real `window`, or a test's stand-in). */
export interface BridgeWindow {
	parent: { postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void } | null;
	addEventListener(type: "message", listener: (e: { origin: string; source: unknown; data: unknown }) => void): void;
}

/** `scheme://host[:port]` exactly: https, or http only on localhost (the dev estate). */
export function plainOrigin(v: unknown): v is string {
	if (typeof v !== "string") return false;
	const m = /^(https|http):\/\/([A-Za-z0-9.-]+(?::\d{1,5})?)$/.exec(v);
	if (!m) return false;
	const host = m[2].replace(/:\d+$/, "");
	return m[1] === "https" || host === "localhost" || host === "127.0.0.1";
}

/** What the page declared, or the reason there is no bridge (said by name; there is no default parent). */
export function readDeclared(g: { __craftHost?: unknown }): HostDeclared | { refused: string } {
	const d = g.__craftHost as Record<string, unknown> | undefined;
	if (!d || typeof d !== "object") return { refused: "craft-host-undeclared: the frame page declared no host" };
	if (!plainOrigin(d.parent)) return { refused: "craft-host-origin: the declared parent is not a plain https origin" };
	if (typeof d.app !== "string" || !d.app || typeof d.version !== "string" || !d.version) return { refused: "craft-host-undeclared: the frame page states no app or version" };
	return { app: d.app, version: d.version, parent: d.parent };
}

export class HostBridge {
	private opened: Opened | null = null;
	private lastDirty: boolean | null = null;
	private saving: { resolve: (a: SaveAnswer) => void; saveAs: boolean } | null = null;
	private readonly media = new Map<string, { url: string; version: string; resolve: (a: MediumAnswer) => void }>();
	private nextMedium = 0;
	private runner: ((params: unknown) => CommandAnswer) | null = null;
	private readonly win: BridgeWindow;
	private readonly declared: HostDeclared;
	private readonly onOpen: (o: Opened) => void;
	/** The project's own type (a save of the project is this mime) and the most bytes an open may carry: `otio.ts`'s. */
	private readonly projectMime: string;
	private readonly maxBytes: number;

	constructor(win: BridgeWindow, declared: HostDeclared, format: { mime: string; maxBytes: number }, onOpen: (o: Opened) => void) {
		this.win = win;
		this.projectMime = format.mime;
		this.maxBytes = format.maxBytes;
		this.declared = declared;
		this.onOpen = onOpen;
		win.addEventListener("message", (e) => this.hear(e));
	}

	/** Listening: the host sends the file now. */
	ready(): void {
		this.post({ type: "craft:ready", app: this.declared.app, version: this.declared.version });
	}

	failed(error: string): void {
		this.post({ type: "craft:failed", error: String(error).slice(0, 2000) });
	}

	/** Report unsaved changes when they appear or go away (once per change). */
	dirty(dirty: boolean): void {
		if (!this.opened || this.lastDirty === dirty) return;
		this.lastDirty = dirty;
		this.post({ type: "craft:dirty", session: this.opened.session, dirty });
	}

	/**
	 * Hand a file to the host. `saveAs: false` is the opened project under its own name (a new version of it, on the version it opened);
	 * anything else (an export) is `saveAs: true`, a new file beside it. A read-only window never saves.
	 */
	save(name: string, mime: string, bytes: Uint8Array, saveAs: boolean): Promise<SaveAnswer> {
		const o = this.opened;
		if (!o) return Promise.resolve({ ok: false, code: "craft-nothing-open", reason: "no file is open from the host" });
		if (o.readOnly) return Promise.resolve({ ok: false, code: "craft-read-only", reason: `${o.name} is open read-only` });
		if (!saveAs && (name !== o.name || mime !== this.projectMime)) {
			return Promise.resolve({ ok: false, code: "craft-save-not-the-project", reason: `a save of the project goes under ${o.name} as a Cut project` });
		}
		if (this.saving) return Promise.resolve({ ok: false, code: "craft-save-busy", reason: "a save is already on its way" });
		const buf = bytes.slice().buffer;
		return new Promise((resolve) => {
			this.saving = { resolve, saveAs };
			this.post({ type: "craft:save", session: o.session, name, mime, bytes: buf, baseVersionId: o.versionId, saveAs }, [buf]);
		});
	}

	/** The editor takes the assistant's runs from now on. */
	onCommand(run: (params: unknown) => CommandAnswer): void {
		this.runner = run;
	}

	/** The bytes of a medium the project uses, asked of the host by its OneOS reference; anything else is refused here, by name, unasked. */
	medium(url: string): Promise<MediumAnswer> {
		const o = this.opened;
		if (!o) return Promise.resolve({ ok: false, code: "craft-nothing-open", reason: "no file is open from the host" });
		const ref = parseMediaUrl(url);
		if (!ref) return Promise.resolve({ ok: false, code: "media-not-referenced", reason: `${url} is not a OneOS file and version (oneos:file/<id>?version=<v>)` });
		this.nextMedium += 1;
		const id = `m${this.nextMedium}`;
		return new Promise((resolve) => {
			this.media.set(id, { url, version: ref.version, resolve });
			this.post({ type: "craft:medium:need", session: o.session, id, url });
		});
	}

	private post(message: Record<string, unknown>, transfer?: Transferable[]): void {
		this.win.parent?.postMessage(message, this.declared.parent, transfer);
	}

	private hear(e: { origin: string; source: unknown; data: unknown }): void {
		if (e.origin !== this.declared.parent || e.source !== this.win.parent) return;
		const m = e.data as Record<string, unknown> | null;
		if (!m || typeof m !== "object" || typeof m.type !== "string") return;
		if (m.type === "craft:open") {
			if (typeof m.session !== "string" || !m.session || typeof m.name !== "string" || !(m.bytes instanceof ArrayBuffer)) return;
			if (typeof m.versionId !== "string" || typeof m.readOnly !== "boolean") return;
			if (m.bytes.byteLength > this.maxBytes) return;
			this.opened = { session: m.session, name: m.name, bytes: new Uint8Array(m.bytes), versionId: m.versionId, readOnly: m.readOnly };
			this.lastDirty = null;
			// A medium asked of an earlier open is never answered into this one.
			for (const w of this.media.values()) w.resolve({ ok: false, code: "craft-reopened", reason: "another file was opened" });
			this.media.clear();
			this.onOpen(this.opened);
			return;
		}
		if (!this.opened || m.session !== this.opened.session) return;
		if (m.type === "craft:command") {
			if (typeof m.id !== "number" || !Number.isInteger(m.id)) return;
			const reply = (a: CommandAnswer) => this.post({ type: "craft:result", session: this.opened?.session, id: m.id, ...a });
			if (m.method !== "command.batch") { reply({ ok: false, error: `craft-method-unknown: Cut answers command.batch only, not ${String(m.method)}` }); return; }
			if (!this.runner) { reply({ ok: false, error: "craft-not-ready: the project is not loaded yet" }); return; }
			let answer: CommandAnswer;
			try {
				answer = this.runner(m.params);
			} catch (e) {
				answer = { ok: false, error: `craft-run-failed: ${(e as Error).message}` };
			}
			reply(answer);
			return;
		}
		if (m.type === "craft:medium:data") {
			const w = typeof m.id === "string" ? this.media.get(m.id) : undefined;
			if (!w || m.url !== w.url) return;
			this.media.delete(m.id as string);
			if (typeof m.code === "string") {
				w.resolve({ ok: false, code: m.code, reason: typeof m.reason === "string" ? m.reason : m.code });
			} else if (!(m.bytes instanceof ArrayBuffer) || m.bytes.byteLength > MEDIUM_MAX_BYTES || typeof m.name !== "string" || typeof m.mime !== "string") {
				w.resolve({ ok: false, code: "media-unreadable", reason: `the host's answer for ${w.url} is not a medium` });
			} else if (m.versionId !== w.version) {
				w.resolve({ ok: false, code: "media-version-mismatch", reason: `the host read version ${String(m.versionId)}, not ${w.version}` });
			} else {
				w.resolve({ ok: true, name: m.name, mime: m.mime, bytes: new Uint8Array(m.bytes), versionId: w.version });
			}
			return;
		}
		if (m.type === "craft:saved" && typeof m.versionId === "string" && m.versionId) {
			const done = this.saving;
			this.saving = null;
			// A save of the project: the next save's base is the version it made. An export is a new file beside it; the base stays.
			if (done && !done.saveAs) {
				this.opened = { ...this.opened, versionId: m.versionId };
				this.lastDirty = null;
			}
			done?.resolve({ ok: true, versionId: m.versionId });
		} else if (m.type === "craft:refused" && typeof m.code === "string") {
			const done = this.saving;
			this.saving = null;
			done?.resolve({ ok: false, code: m.code, reason: typeof m.reason === "string" ? m.reason : m.code });
		}
	}
}
