/**
 * The ONE video project format of Cut and Film (OneOS doctrine files/989; Mona 2026-11-08: "OpenTimelineIO .otio", "Stay on .otio, fix
 * writers"). Cut opens any OpenTimelineIO document (a Timeline.1, or Film's SerializableCollection.1 of a whole project), shows what it can
 * edit and CARRIES THE REST THROUGH UNTOUCHED: the document is kept as read, and a save writes it back with only Cut's edits applied.
 *
 * Editable: a Track.1 (Video or Audio) whose children are all plain `Clip.2` (one DEFAULT_MEDIA `ExternalReference.1` that is a OneOS file,
 * `oneos:file/<id>?version=<v>`; no effects, no markers) and `Gap.1`. Anything else on a track - a transition, an effect, a marker, a nested
 * stack, a generator, media that is not a OneOS file - LOCKS that track (shown, not editable, written back exactly), with the reason named.
 * Everything outside the tracks (Film's metadata.filmcraft.project, other tools' metadata, the stack's own markers) is never touched.
 * Refused by name only what Cut would damage: bytes that are not OpenTimelineIO, and a document its own write-back would change.
 * Pure: no DOM, no storage, no network.
 */

export const OTIO_EXT = "otio";
/** The type OneOS stores an .otio under (OpenTimelineIO registers none). */
export const OTIO_MIME = "application/x-otio+json";
export const OTIO_MAX_BYTES = 64 * 1024 * 1024;

export type OtioRefusalCode = "file-unreadable" | "format-not-editable" | "format-not-round-trip" | "media-not-referenced" | "file-too-large";

export class OtioRefusal extends Error {
	readonly code: OtioRefusalCode;
	constructor(code: OtioRefusalCode, reason: string) {
		super(`${code}: ${reason}`);
		this.code = code;
		this.name = "OtioRefusal";
	}
}

type Json = Record<string, any>;
export interface MediaRef { id: string; version: string }
export interface Span { start: number; duration: number; rate: number }
export type Item =
	| { type: "clip"; name: string; enabled: boolean; source: Span; media: MediaRef; metadata: Json; raw: Json }
	| { type: "gap"; name: string; enabled: boolean; source: Span; metadata: Json; raw: Json };
export interface Track {
	kind: string;
	name: string;
	/** Null when Cut may edit it; else why it is locked (carried through untouched). */
	locked: string | null;
	items: Item[];
	raw: Json;
}
export interface Timeline { name: string; tracks: Track[]; raw: Json }
export interface OtioDocument { timelines: Timeline[]; raw: Json }

const URL_RE = /^oneos:file\/([0-9a-z]{26})\?version=([A-Za-z0-9._-]{1,128})$/;
const ULID = /^[0-9a-z]{26}$/;

export function mediaUrl(id: string, version: string): string {
	if (!ULID.test(id) || !/^[A-Za-z0-9._-]{1,128}$/.test(version)) throw new OtioRefusal("media-not-referenced", `${id}@${version} is not a OneOS file and version`);
	return `oneos:file/${id}?version=${version}`;
}
export function parseMediaUrl(url: unknown): MediaRef | null {
	const m = typeof url === "string" ? URL_RE.exec(url) : null;
	return m ? { id: m[1], version: m[2] } : null;
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function decodeOtio(name: string, bytes: Uint8Array): OtioDocument {
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	if (ext !== OTIO_EXT) throw new OtioRefusal("format-not-editable", `Cut edits OpenTimelineIO projects (.otio); ${name} is an import, not a project it saves back`);
	if (bytes.byteLength > OTIO_MAX_BYTES) throw new OtioRefusal("file-too-large", `${name} is over ${OTIO_MAX_BYTES} bytes`);
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (e) {
		throw new OtioRefusal("file-unreadable", `${name} is not OpenTimelineIO JSON: ${(e as Error).message}`);
	}
	if (!isObj(raw)) throw new OtioRefusal("file-unreadable", `${name} is not an OpenTimelineIO object`);
	const roots: Json[] = raw.OTIO_SCHEMA === "Timeline.1" ? [raw] : raw.OTIO_SCHEMA === "SerializableCollection.1" && Array.isArray(raw.children) ? raw.children.filter((c: unknown) => isObj(c) && c.OTIO_SCHEMA === "Timeline.1") : [];
	if (!roots.length) throw new OtioRefusal("format-not-editable", `${name} is a ${String(raw.OTIO_SCHEMA)} holding no Timeline.1`);
	const doc: OtioDocument = { raw, timelines: roots.map((tl) => timeline(tl)) };
	if (!sameValue(JSON.parse(new TextDecoder().decode(encodeOtio(doc))), raw)) {
		throw new OtioRefusal("format-not-round-trip", `${name} would not be written back as it is; it is not opened for editing`);
	}
	return doc;
}

function timeline(tl: Json): Timeline {
	const stack = tl.tracks;
	const tracks = isObj(stack) && Array.isArray(stack.children) ? stack.children.map((t: unknown, i: number) => track(t, i)) : [];
	return { name: typeof tl.name === "string" ? tl.name : "", tracks, raw: tl };
}

function track(t: unknown, i: number): Track {
	if (!isObj(t)) return { kind: "", name: `track ${i + 1}`, locked: "it is not an object", items: [], raw: t as Json };
	const name = typeof t.name === "string" ? t.name : `track ${i + 1}`;
	const lockedTrack = (why: string): Track => ({ kind: String(t.kind ?? ""), name, locked: why, items: [], raw: t });
	if (t.OTIO_SCHEMA !== "Track.1") return lockedTrack(`it is a ${String(t.OTIO_SCHEMA)} (a nested stack), which Cut carries but does not edit`);
	if (t.kind !== "Video" && t.kind !== "Audio") return lockedTrack(`it is of kind ${String(t.kind)}`);
	if ((Array.isArray(t.effects) && t.effects.length) || (Array.isArray(t.markers) && t.markers.length)) return lockedTrack("it has effects or markers of its own");
	const items: Item[] = [];
	for (const c of Array.isArray(t.children) ? t.children : []) {
		const why = editable(c);
		if (why) return lockedTrack(why);
		const source = { start: c.source_range.start_time.value, duration: c.source_range.duration.value, rate: c.source_range.duration.rate };
		const common = { name: typeof c.name === "string" ? c.name : "", enabled: c.enabled !== false, source, metadata: isObj(c.metadata) ? c.metadata : {}, raw: c };
		items.push(c.OTIO_SCHEMA === "Gap.1" ? { type: "gap", ...common } : { type: "clip", media: parseMediaUrl(c.media_references.DEFAULT_MEDIA.target_url)!, ...common });
	}
	return { kind: t.kind, name, locked: null, items, raw: t };
}

/** Why a track item is not something Cut edits (null: it is). */
function editable(c: unknown): string | null {
	if (!isObj(c)) return "it holds a non-object";
	const label = `${String(c.OTIO_SCHEMA)} ${typeof c.name === "string" && c.name ? `"${c.name}"` : ""}`.trim();
	if (c.OTIO_SCHEMA !== "Clip.2" && c.OTIO_SCHEMA !== "Gap.1") return `it holds a ${label}, which Cut carries but does not edit`;
	if ((Array.isArray(c.effects) && c.effects.length) || (Array.isArray(c.markers) && c.markers.length)) return `${label} has effects or markers`;
	const r = c.source_range;
	if (!isObj(r) || !isObj(r.start_time) || !isObj(r.duration) || typeof r.start_time.value !== "number" || typeof r.duration.value !== "number" || r.start_time.rate !== r.duration.rate) return `${label} has no plain source range`;
	if (c.OTIO_SCHEMA === "Gap.1") return null;
	const refs = c.media_references;
	if (!isObj(refs) || Object.keys(refs).length !== 1 || c.active_media_reference_key !== "DEFAULT_MEDIA" || !isObj(refs.DEFAULT_MEDIA)) return `${label} has more than one media reference`;
	if (refs.DEFAULT_MEDIA.OTIO_SCHEMA !== "ExternalReference.1" || !parseMediaUrl(refs.DEFAULT_MEDIA.target_url)) return `${label}'s media is not a OneOS file`;
	return null;
}

export function encodeOtio(doc: OtioDocument): Uint8Array {
	const raw = clone(doc.raw);
	const roots: Json[] = raw.OTIO_SCHEMA === "Timeline.1" ? [raw] : raw.children.filter((c: unknown) => isObj(c) && c.OTIO_SCHEMA === "Timeline.1");
	doc.timelines.forEach((tl, ti) => {
		const out = roots[ti];
		out.name = tl.name;
		tl.tracks.forEach((t, i) => {
			if (t.locked) return; // carried exactly as read
			const rt = out.tracks.children[i];
			rt.name = t.name;
			rt.children = t.items.map((it) => {
				const r = clone(it.raw);
				r.name = it.name;
				r.enabled = it.enabled;
				r.metadata = clone(it.metadata);
				r.source_range.start_time.value = it.source.start;
				r.source_range.duration.value = it.source.duration;
				r.source_range.start_time.rate = r.source_range.duration.rate = it.source.rate;
				if (it.type === "clip") r.media_references.DEFAULT_MEDIA.target_url = mediaUrl(it.media.id, it.media.version);
				return r;
			});
		});
	});
	return new TextEncoder().encode(`${JSON.stringify(raw, null, 4)}\n`);
}

/** The Create blank: an empty timeline at 30 fps with one video and one audio track. */
export function blankOtio(name: string): Uint8Array {
	const track = (kind: "Video" | "Audio", n: string) => ({ OTIO_SCHEMA: "Track.1", name: n, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [] });
	const raw = { OTIO_SCHEMA: "Timeline.1", name, global_start_time: null, metadata: {}, tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [track("Video", "V1"), track("Audio", "A1")] } };
	return new TextEncoder().encode(`${JSON.stringify(raw, null, 4)}\n`);
}

/** Two JSON documents hold the same values. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
	if (isObj(a) && isObj(b)) {
		const ka = Object.keys(a), kb = Object.keys(b);
		return ka.length === kb.length && ka.every((k) => k in b && sameValue(a[k], b[k]));
	}
	return a === b;
}
