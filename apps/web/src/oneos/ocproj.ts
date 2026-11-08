/**
 * `.ocproj` - Cut's own project file (OneOS, Mona 2026-11-08: "an ocproj file is a good idea"; doctrine files/999).
 *
 * One JSON document: the project as OpenCut serialises it (timeline, tracks, clips, effects, keyframes, masks: `SerializedProject`)
 * and its media as REFERENCES to files in OneOS storage (a file id and the version it was placed at), never their bytes and never a
 * browser-only copy. The host reads a referenced medium through its storage proxy and hands it over; the frame fetches nothing.
 *
 * What opens writes back UNCHANGED: `decodeOcproj` re-encodes what it read and refuses the file by name when the bytes differ
 * (`format-not-round-trip`), so a save can never quietly rewrite a project it did not understand. Every refusal is by name.
 * This module is pure: no DOM, no storage, no network.
 */

export const OCPROJ_EXT = "ocproj";
export const OCPROJ_MIME = "application/x-opencut-project";
export const OCPROJ_FORMAT = "ocproj";
/** The one version this build reads and writes. */
export const OCPROJ_VERSION = 1;
/** The editor's own bound on a project document (its media are references, so a project is small). */
export const OCPROJ_MAX_BYTES = 32 * 1024 * 1024;

export type OcprojRefusalCode =
	| "file-unreadable"
	| "format-not-editable"
	| "format-not-round-trip"
	| "media-not-referenced"
	| "file-too-large";

export class OcprojRefusal extends Error {
	readonly code: OcprojRefusalCode;
	constructor(code: OcprojRefusalCode, reason: string) {
		super(`${code}: ${reason}`);
		this.code = code;
		this.name = "OcprojRefusal";
	}
}

/** Where a medium lives in OneOS storage: the file and the version the project placed. */
export interface OcprojFileRef {
	id: string;
	version: string;
}

/** A medium of the project: OpenCut's asset facts plus its storage reference. */
export interface OcprojMedia {
	/** The asset id the timeline's elements name (`mediaId`). */
	id: string;
	name: string;
	type: "video" | "audio" | "image";
	file: OcprojFileRef;
	size?: number;
	width?: number;
	height?: number;
	duration?: number;
	fps?: number;
	hasAudio?: boolean;
}

export interface OcprojDocument {
	/** OpenCut's `SerializedProject`, kept as it serialises it. */
	project: Record<string, unknown>;
	media: OcprojMedia[];
}

const ULID = /^[0-9a-z]{26}$/;
const MEDIA_KEYS = ["id", "name", "type", "file", "size", "width", "height", "duration", "fps", "hasAudio"] as const;
const MEDIA_TYPES = new Set(["video", "audio", "image"]);

/** The canonical bytes of a document: a fixed key order at the top and per medium, the project as given, two-space JSON, one newline. */
export function encodeOcproj(doc: OcprojDocument): Uint8Array {
	checkMedia(doc.media);
	if (!isObject(doc.project)) throw new OcprojRefusal("file-unreadable", "the project is not an object");
	const media = doc.media.map((m) => {
		const out: Record<string, unknown> = {};
		for (const k of MEDIA_KEYS) if (m[k] !== undefined) out[k] = k === "file" ? { id: m.file.id, version: m.file.version } : m[k];
		return out;
	});
	const text = `${JSON.stringify({ format: OCPROJ_FORMAT, formatVersion: OCPROJ_VERSION, project: doc.project, media }, null, 2)}\n`;
	return new TextEncoder().encode(text);
}

/** The document `bytes` hold, or the refusal by name. */
export function decodeOcproj(name: string, bytes: Uint8Array): OcprojDocument {
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	if (ext !== OCPROJ_EXT) throw new OcprojRefusal("format-not-editable", `Cut edits Cut projects (.ocproj); ${name} is an import, not a document it saves back`);
	if (bytes.byteLength > OCPROJ_MAX_BYTES) throw new OcprojRefusal("file-too-large", `${name} is over ${OCPROJ_MAX_BYTES} bytes`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (e) {
		throw new OcprojRefusal("file-unreadable", `${name} is not a Cut project: ${(e as Error).message}`);
	}
	if (!isObject(parsed) || parsed.format !== OCPROJ_FORMAT) throw new OcprojRefusal("file-unreadable", `${name} does not say it is a Cut project`);
	if (parsed.formatVersion !== OCPROJ_VERSION) throw new OcprojRefusal("format-not-editable", `${name} is Cut project version ${String(parsed.formatVersion)}; this Cut reads version ${OCPROJ_VERSION}`);
	const extra = Object.keys(parsed).filter((k) => !["format", "formatVersion", "project", "media"].includes(k));
	if (extra.length) throw new OcprojRefusal("format-not-round-trip", `${name} holds ${extra.join(", ")}, which Cut cannot write back`);
	if (!isObject(parsed.project) || !Array.isArray(parsed.media)) throw new OcprojRefusal("file-unreadable", `${name} states no project or no media list`);
	const doc: OcprojDocument = { project: parsed.project, media: parsed.media as OcprojMedia[] };
	checkMedia(doc.media);
	const again = encodeOcproj(doc);
	if (!sameBytes(again, bytes)) throw new OcprojRefusal("format-not-round-trip", `${name} is not in the form Cut writes, so a save would change it; it is not opened for editing`);
	return doc;
}

/** The Create blank: an empty project of `name`, 1920x1080 at 30 fps, no media. */
export function blankOcproj(name: string, id: string, now: string): Uint8Array {
	return encodeOcproj({
		project: {
			metadata: { id, name, duration: 0, createdAt: now, updatedAt: now },
			scenes: [{ id: `${id}-main`, name: "Main", isMain: true, tracks: [], bookmarks: [], createdAt: now, updatedAt: now }],
			currentSceneId: `${id}-main`,
			settings: { fps: 30, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } },
			version: 1,
		},
		media: [],
	});
}

function checkMedia(media: unknown): asserts media is OcprojMedia[] {
	if (!Array.isArray(media)) throw new OcprojRefusal("file-unreadable", "the media list is not a list");
	const ids = new Set<string>();
	for (const m of media) {
		if (!isObject(m) || typeof m.id !== "string" || !m.id || typeof m.name !== "string" || !MEDIA_TYPES.has(m.type as string)) {
			throw new OcprojRefusal("file-unreadable", "a medium states no id, name or type");
		}
		if (ids.has(m.id)) throw new OcprojRefusal("file-unreadable", `the medium ${m.id} is listed twice`);
		ids.add(m.id);
		const f = m.file;
		if (!isObject(f) || typeof f.id !== "string" || !ULID.test(f.id) || typeof f.version !== "string" || !f.version) {
			throw new OcprojRefusal("media-not-referenced", `the medium ${m.name} is not a file in OneOS storage (a file id and version)`);
		}
		const extra = Object.keys(m).filter((k) => !(MEDIA_KEYS as readonly string[]).includes(k));
		if (extra.length) throw new OcprojRefusal("format-not-round-trip", `the medium ${m.name} holds ${extra.join(", ")}, which Cut cannot write back`);
	}
}

function isObject(v: unknown): v is Record<string, any> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false;
	for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
	return true;
}
