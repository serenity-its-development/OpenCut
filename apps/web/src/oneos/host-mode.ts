/**
 * Cut inside OneOS (doctrine files/016, files/989): the editor opens the file the host hands it, and saves to the host, nothing else.
 *
 * - The frame page declares the host (`globalThis.__craftHost`); with none there is no host mode and nothing here runs.
 * - Storage is this window's memory (`storageService.holdInMemory()`): no IndexedDB, no OPFS. The project's media are its OneOS files, asked
 *   of the host one by one (`craft:medium:need`) and handed over as bytes; the frame fetches nothing.
 * - Open: `CutSession.open` decides how (a Cut project whole, any other .otio carried with what Cut cannot edit locked and named). A file
 *   or a medium it cannot open is refused by name (`craft:failed`), never opened half.
 * - The assistant's run (`craft:command`, files/025) is run by `command-host.ts` once the project is loaded, as ONE undo step.
 * - Save: the project as the editor holds it -> `CutSession.save` -> `craft:save` on the version opened; `craft:saved` makes those bytes
 *   the file (`committed`), a refusal is said by name and nothing is lost. An export (MP4/WebM) is a NEW file beside the project.
 */
import { EditorCore } from "@/core";
import { storageService } from "@/services/storage/service";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { CURRENT_PROJECT_VERSION } from "@/services/storage/migrations";
import { DEFAULT_FPS } from "@/fps/defaults";
import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import type { TProject } from "@/project/types";
import type { MediaType } from "@/media/types";
import type { MediaTime } from "@/wasm";
import { HostBridge, readDeclared, type Opened } from "./host-bridge.ts";
import { CutSaveRefusal, CutSession, type LockedTrack } from "./cut-session.ts";
import { OTIO_MAX_BYTES, OTIO_MIME, mediaUrl } from "./otio.ts";
import { runInEditor } from "./command-host.ts";
import type { CutMedia } from "./cut-otio.ts";

/** The one project a host-mode window holds. */
export const HOST_PROJECT_ID = "oneos";

export type HostState =
	| { stage: "waiting" }
	| { stage: "refused"; error: string }
	| { stage: "open"; name: string; readOnly: boolean; locked: LockedTrack[]; dirty: boolean; saving: boolean; notice: string };

type J = Record<string, any>;

let current: HostMode | null = null;
/** The host mode this window runs in, or null (a plain OpenCut window). */
export function hostMode(): HostMode | null {
	return current;
}

export class HostMode {
	private state: HostState = { stage: "waiting" };
	private readonly listeners = new Set<() => void>();
	private readonly bridge: HostBridge;
	private session: CutSession | null = null;
	private opened: Opened | null = null;
	/** The media that came with the file, by asset id, exactly as the file named them. */
	private readonly fromFile = new Map<string, CutMedia>();
	private settled = false;
	private unsubscribe: Array<() => void> = [];
	private dirtyTimer: ReturnType<typeof setTimeout> | null = null;

	/** Start host mode when the page declared a host; else the reason there is none (by name), and the window stays plain OpenCut. */
	static start(g: typeof globalThis & { __craftHost?: unknown }): HostMode | { refused: string } {
		if (current) return current;
		const declared = readDeclared(g);
		if ("refused" in declared) return declared;
		storageService.holdInMemory();
		current = new HostMode(new HostBridge(window, declared, { mime: OTIO_MIME, maxBytes: OTIO_MAX_BYTES }, (o) => void current?.open(o)));
		current.bridge.ready();
		return current;
	}

	private constructor(bridge: HostBridge) {
		this.bridge = bridge;
	}

	getState(): HostState {
		return this.state;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(next: HostState): void {
		this.state = next;
		for (const l of this.listeners) l();
	}

	private patch(p: Partial<Extract<HostState, { stage: "open" }>>): void {
		if (this.state.stage === "open") this.set({ ...this.state, ...p });
	}

	private refuse(error: string): void {
		this.bridge.failed(error);
		this.set({ stage: "refused", error });
	}

	private async open(o: Opened): Promise<void> {
		this.stopWatching();
		this.settled = false;
		this.fromFile.clear();
		this.opened = o;
		this.set({ stage: "waiting" });
		let session: CutSession;
		try {
			session = CutSession.open(o.name, o.bytes);
		} catch (e) {
			this.refuse((e as Error).message);
			return;
		}
		if (session.mode === "cut" && session.project.version !== CURRENT_PROJECT_VERSION) {
			this.refuse(`project-version: ${o.name} was saved by a Cut of project version ${String(session.project.version)}; this Cut reads version ${CURRENT_PROJECT_VERSION}`);
			return;
		}
		const types = new Map<string, MediaType>();
		for (const m of session.media) {
			const url = mediaUrl(m.file.id, m.file.version);
			const got = await this.bridge.medium(url);
			if (!got.ok) {
				this.refuse(`${got.code}: the medium ${m.name} (${url}) could not be read: ${got.reason}`);
				return;
			}
			const file = new File([got.bytes], got.name, { type: got.mime });
			const [asset] = await processMediaAssets({ files: [file] });
			if (!asset) {
				this.refuse(`media-unreadable: the medium ${m.name} (${got.mime}) is not a picture, a video or a sound Cut can use`);
				return;
			}
			if (session.mode === "cut" && asset.type !== m.type) {
				this.refuse(`media-type-changed: the project uses ${m.name} as ${m.type}, but the file is ${asset.type}`);
				return;
			}
			types.set(m.id, asset.type);
			this.fromFile.set(m.id, m);
			await storageService.saveMediaAsset({ projectId: HOST_PROJECT_ID, mediaAsset: { ...asset, id: m.id, name: m.name } });
		}
		this.session = session;
		const project = session.mode === "cut" ? session.project : carriedProject(session.project, types);
		await storageService.saveProject({ project: toProject({ ...project, metadata: { ...project.metadata, id: HOST_PROJECT_ID } }) });
		this.set({ stage: "open", name: o.name, readOnly: o.readOnly, locked: session.locked, dirty: false, saving: false, notice: "" });
	}

	/** The editor has loaded the project: what it holds now is the unedited state (its defaults filled in). */
	async settle(): Promise<void> {
		const s = this.session;
		if (!s || this.settled) return;
		const held = await this.held();
		if (!held) return;
		s.baseline(held.project, held.media);
		this.settled = true;
		// The assistant's runs (files/025) from now on: a read-only window takes none.
		this.bridge.onCommand((params) => {
			const o = this.opened;
			if (o?.readOnly) return { ok: false, error: `craft-read-only: ${o.name} is open read-only; the assistant edits nothing here` };
			return runInEditor(params);
		});
		const editor = EditorCore.getInstance();
		const changed = () => this.measureSoon();
		this.unsubscribe = [editor.scenes.subscribe(changed), editor.timeline.subscribe(changed), editor.media.subscribe(changed)];
	}

	private stopWatching(): void {
		for (const u of this.unsubscribe) u();
		this.unsubscribe = [];
		if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
		this.dirtyTimer = null;
	}

	/** Is the project edited? Measured a moment after the last change (the host shows unsaved changes; the editor's own state is the truth). */
	private measureSoon(): void {
		if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
		this.dirtyTimer = setTimeout(() => {
			void (async () => {
				const s = this.session;
				const held = await this.held();
				if (!s || !held) return;
				const dirty = s.isEdited(held.project, held.media);
				this.bridge.dirty(dirty);
				this.patch({ dirty });
			})();
		}, 300);
	}

	/** The project and media as the editor holds them now, in the stored form (dates as text). */
	private async held(): Promise<{ project: J; media: CutMedia[] } | null> {
		const editor = EditorCore.getInstance();
		if (!editor.project.getActiveOrNull()) return null;
		await editor.project.saveCurrentProject();
		const project = await storageService.loadSerializedProject({ id: HOST_PROJECT_ID });
		if (!project) return null;
		const media = editor.media.getAssets().map((a) => this.fromFile.get(a.id) ?? ({ id: a.id, name: a.name, type: a.type } as unknown as CutMedia));
		return { project: project as unknown as J, media };
	}

	/** Save the project to the host as a new version of the file opened; a refusal is said by name and nothing is written. */
	async save(): Promise<void> {
		const s = this.session, o = this.opened;
		if (!s || !o || this.state.stage !== "open" || this.state.saving) return;
		if (o.readOnly) { this.patch({ notice: `${o.name} is open read-only` }); return; }
		this.patch({ saving: true, notice: "" });
		try {
			const held = await this.held();
			if (!held) { this.patch({ notice: "craft-nothing-open: the project is not loaded yet" }); return; }
			let bytes: Uint8Array;
			try {
				bytes = s.save(held.project, held.media);
			} catch (e) {
				if (e instanceof CutSaveRefusal) { this.patch({ notice: `Not saved. ${e.message}` }); return; }
				throw e;
			}
			const answer = await this.bridge.save(o.name, OTIO_MIME, bytes, false);
			if (!answer.ok) { this.patch({ notice: `Not saved. ${answer.code}: ${answer.reason}` }); return; }
			s.committed(bytes, held.project, held.media);
			this.bridge.dirty(false);
			this.patch({ dirty: false });
		} finally {
			this.patch({ saving: false });
		}
	}

	/** An export (MP4/WebM): a NEW file beside the project, never the project. */
	async exportBeside(name: string, mime: string, buffer: ArrayBuffer): Promise<{ ok: boolean; reason: string }> {
		const answer = await this.bridge.save(name, mime, new Uint8Array(buffer), true);
		return answer.ok ? { ok: true, reason: "" } : { ok: false, reason: `${answer.code}: ${answer.reason}` };
	}
}

/** A carried project as the editor holds it: Cut's own settings when the file has none, each element filled with the editor's defaults. */
function carriedProject(p: J, types: Map<string, MediaType>): J {
	const q = JSON.parse(JSON.stringify(p));
	q.version = CURRENT_PROJECT_VERSION;
	q.settings ??= { fps: DEFAULT_FPS, canvasSize: DEFAULT_CANVAS_SIZE, canvasSizeMode: "preset", lastCustomCanvasSize: null, originalCanvasSize: null, background: { type: "color", color: DEFAULT_BACKGROUND_COLOR } };
	for (const sc of q.scenes as J[]) {
		for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio] as J[]) {
			t.elements = (t.elements as J[]).map((e) => {
				const mediaType = types.get(e.mediaId) ?? (t.type === "audio" ? "audio" : "video");
				const defaults = buildElementFromMedia({ mediaId: e.mediaId, mediaType: t.type === "audio" ? "audio" : mediaType, name: e.name, duration: e.duration as MediaTime, startTime: e.startTime as MediaTime });
				return { ...defaults, ...e, type: defaults.type };
			});
		}
	}
	return q;
}

/** The stored form (dates as text) as the project the storage service keeps. */
function toProject(p: J): TProject {
	return {
		...p,
		metadata: { ...p.metadata, createdAt: new Date(p.metadata.createdAt), updatedAt: new Date(p.metadata.updatedAt) },
		scenes: (p.scenes as J[]).map((sc) => ({ ...sc, createdAt: new Date(sc.createdAt), updatedAt: new Date(sc.updatedAt) })),
	} as TProject;
}
