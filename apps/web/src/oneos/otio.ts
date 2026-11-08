/**
 * The ONE video project format of Cut and Film (OneOS doctrine files/989; Mona 2026-11-08: "OpenTimelineIO .otio").
 *
 * Cut reads an OpenTimelineIO timeline and writes it back UNCHANGED, value for value. It represents: one `Timeline.1` whose `tracks` is a
 * `Stack.1` of `Track.1` (Video or Audio), each a row of `Clip.2` and `Gap.1`, a clip's media one `ExternalReference.1` that is a OneOS file
 * (`oneos:file/<file id>?version=<version>`), and every object's `metadata` (Cut's own under `metadata.opencut`; any other tool's, Film's
 * `filmcraft` included, carried untouched). Anything else - a transition, a nested stack, an effect or marker on an item, a field it does not
 * know, a path or an address as media - is refused BY NAME, naming the part, before anything opens, so a save can never drop it. The final
 * guard: what Cut would write is compared with what it read, and a difference refuses the file (`format-not-round-trip`).
 * Pure: no DOM, no storage, no network.
 */

export const OTIO_EXT = "otio";
/** The type OneOS stores an .otio under (OpenTimelineIO registers none). */
export const OTIO_MIME = "application/x-otio+json";
export const OTIO_MAX_BYTES = 32 * 1024 * 1024;

export type OtioRefusalCode = "file-unreadable" | "format-not-editable" | "format-not-round-trip" | "media-not-referenced" | "file-too-large";

export class OtioRefusal extends Error {
	readonly code: OtioRefusalCode;
	constructor(code: OtioRefusalCode, reason: string) {
		super(`${code}: ${reason}`);
		this.code = code;
		this.name = "OtioRefusal";
	}
}

export interface MediaRef {
	id: string;
	version: string;
}
export interface Span {
	start: number;
	duration: number;
	rate: number;
}
export type Item =
	| { type: "clip"; name: string; enabled: boolean; source: Span; media: MediaRef; metadata: Json; raw: Json }
	| { type: "gap"; name: string; enabled: boolean; source: Span; metadata: Json; raw: Json };
export interface Track {
	kind: "Video" | "Audio";
	name: string;
	enabled: boolean;
	metadata: Json;
	items: Item[];
	raw: Json;
}
export interface OtioDocument {
	name: string;
	metadata: Json;
	tracks: Track[];
	raw: Json;
}
type Json = Record<string, any>;

const ULID = /^[0-9a-z]{26}$/;
const URL_RE = /^oneos:file\/([0-9a-z]{26})\?version=([A-Za-z0-9._-]{1,128})$/;
const KEYS: Record<string, string[]> = {
	"Timeline.1": ["OTIO_SCHEMA", "name", "global_start_time", "metadata", "tracks"],
	"Stack.1": ["OTIO_SCHEMA", "name", "source_range", "effects", "markers", "enabled", "metadata", "children"],
	"Track.1": ["OTIO_SCHEMA", "name", "kind", "source_range", "effects", "markers", "enabled", "metadata", "children"],
	"Clip.2": ["OTIO_SCHEMA", "name", "source_range", "effects", "markers", "enabled", "media_references", "active_media_reference_key", "metadata"],
	"Gap.1": ["OTIO_SCHEMA", "name", "source_range", "effects", "markers", "enabled", "metadata"],
	"ExternalReference.1": ["OTIO_SCHEMA", "name", "target_url", "available_range", "available_image_bounds", "metadata"],
};

/** The URL a OneOS medium is referenced by. */
export function mediaUrl(id: string, version: string): string {
	if (!ULID.test(id) || !/^[A-Za-z0-9._-]{1,128}$/.test(version)) throw new OtioRefusal("media-not-referenced", `${id}@${version} is not a OneOS file and version`);
	return `oneos:file/${id}?version=${version}`;
}
export function parseMediaUrl(url: unknown): MediaRef | null {
	const m = typeof url === "string" ? URL_RE.exec(url) : null;
	return m ? { id: m[1], version: m[2] } : null;
}

export function encodeOtio(doc: OtioDocument): Uint8Array {
	const root = clone(doc.raw);
	root.name = doc.name;
	root.metadata = clone(doc.metadata);
	root.tracks.children = doc.tracks.map((t) => {
		const raw = clone(t.raw);
		Object.assign(raw, { name: t.name, kind: t.kind, enabled: t.enabled, metadata: clone(t.metadata) });
		raw.children = t.items.map((it) => {
			const r = clone(it.raw);
			Object.assign(r, { name: it.name, enabled: it.enabled, metadata: clone(it.metadata) });
			r.source_range.start_time.value = it.source.start;
			r.source_range.duration.value = it.source.duration;
			r.source_range.start_time.rate = r.source_range.duration.rate = it.source.rate;
			if (it.type === "clip") r.media_references.DEFAULT_MEDIA.target_url = mediaUrl(it.media.id, it.media.version);
			return r;
		});
		return raw;
	});
	return new TextEncoder().encode(`${JSON.stringify(root, null, 4)}\n`);
}

export function decodeOtio(name: string, bytes: Uint8Array): OtioDocument {
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
	if (ext !== OTIO_EXT) throw new OtioRefusal("format-not-editable", `Cut edits OpenTimelineIO timelines (.otio); ${name} is an import, not a project it saves back`);
	if (bytes.byteLength > OTIO_MAX_BYTES) throw new OtioRefusal("file-too-large", `${name} is over ${OTIO_MAX_BYTES} bytes`);
	let root: unknown;
	try {
		root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (e) {
		throw new OtioRefusal("file-unreadable", `${name} is not OpenTimelineIO JSON: ${(e as Error).message}`);
	}
	if (!isObj(root)) throw new OtioRefusal("file-unreadable", `${name} is not an OpenTimelineIO object`);
	if (root.OTIO_SCHEMA !== "Timeline.1") throw new OtioRefusal("format-not-editable", `${name} is a ${String(root.OTIO_SCHEMA)}; Cut opens one Timeline.1`);
	known(root, "the timeline");
	const stack = root.tracks;
	if (!isObj(stack) || stack.OTIO_SCHEMA !== "Stack.1") throw new OtioRefusal("format-not-round-trip", "the timeline's tracks are not a Stack.1");
	known(stack, "the track stack");
	plain(stack, "the track stack");
	if (!Array.isArray(stack.children)) throw new OtioRefusal("file-unreadable", "the track stack states no children");
	const tracks = stack.children.map((t: unknown, ti: number): Track => {
		if (!isObj(t) || t.OTIO_SCHEMA !== "Track.1") throw new OtioRefusal("format-not-round-trip", `track ${ti + 1} is a ${isObj(t) ? String(t.OTIO_SCHEMA) : "non-object"}, which Cut cannot represent`);
		const label = `track ${String(t.name || ti + 1)}`;
		known(t, label);
		plain(t, label);
		if (t.kind !== "Video" && t.kind !== "Audio") throw new OtioRefusal("format-not-round-trip", `${label} is of kind ${String(t.kind)}`);
		if (!Array.isArray(t.children)) throw new OtioRefusal("file-unreadable", `${label} states no children`);
		const items = t.children.map((c: unknown): Item => item(c, label));
		return { kind: t.kind, name: str(t.name), enabled: t.enabled !== false, metadata: obj(t.metadata), items, raw: t };
	});
	const doc: OtioDocument = { name: str(root.name), metadata: obj(root.metadata), tracks, raw: root };
	if (!deepEqual(JSON.parse(new TextDecoder().decode(encodeOtio(doc))), root)) {
		throw new OtioRefusal("format-not-round-trip", `${name} would not be written back as it is; it is not opened for editing`);
	}
	return doc;
}

/** The Create blank: an empty timeline at 30 fps with one video and one audio track. */
export function blankOtio(name: string): Uint8Array {
	const track = (kind: "Video" | "Audio", n: string) => ({ OTIO_SCHEMA: "Track.1", name: n, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [] });
	const raw = { OTIO_SCHEMA: "Timeline.1", name, global_start_time: null, metadata: {}, tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [track("Video", "V1"), track("Audio", "A1")] } };
	return new TextEncoder().encode(`${JSON.stringify(raw, null, 4)}\n`);
}

function item(c: unknown, track: string): Item {
	if (!isObj(c)) throw new OtioRefusal("file-unreadable", `${track} holds a non-object`);
	const schema = String(c.OTIO_SCHEMA);
	if (schema !== "Clip.2" && schema !== "Gap.1") throw new OtioRefusal("format-not-round-trip", `${track} holds a ${schema}, which Cut cannot represent`);
	const label = `${schema === "Clip.2" ? "clip" : "gap"} ${str(c.name) || "(unnamed)"}`;
	known(c, label);
	plain(c, label);
	const source = span(c.source_range, label);
	if (schema === "Gap.1") return { type: "gap", name: str(c.name), enabled: c.enabled !== false, source, metadata: obj(c.metadata), raw: c };
	const refs = c.media_references;
	if (!isObj(refs) || Object.keys(refs).length !== 1 || !isObj(refs.DEFAULT_MEDIA) || c.active_media_reference_key !== "DEFAULT_MEDIA") {
		throw new OtioRefusal("format-not-round-trip", `${label} has media references other than one DEFAULT_MEDIA`);
	}
	const ref = refs.DEFAULT_MEDIA;
	if (ref.OTIO_SCHEMA !== "ExternalReference.1") throw new OtioRefusal("media-not-referenced", `${label}'s media is a ${String(ref.OTIO_SCHEMA)}, not a OneOS file`);
	known(ref, `the media of ${label}`);
	const media = parseMediaUrl(ref.target_url);
	if (!media) throw new OtioRefusal("media-not-referenced", `${label}'s media (${String(ref.target_url).slice(0, 80)}) is not a OneOS file and version`);
	return { type: "clip", name: str(c.name), enabled: c.enabled !== false, source, media, metadata: obj(c.metadata), raw: c };
}

function span(r: unknown, label: string): Span {
	if (!isObj(r) || r.OTIO_SCHEMA !== "TimeRange.1" || !isObj(r.start_time) || !isObj(r.duration)) throw new OtioRefusal("file-unreadable", `${label} states no source range`);
	const { start_time: s, duration: d } = r;
	if (typeof s.value !== "number" || typeof d.value !== "number" || typeof s.rate !== "number" || s.rate <= 0) throw new OtioRefusal("file-unreadable", `${label}'s source range is not numbers`);
	if (s.rate !== d.rate) throw new OtioRefusal("format-not-round-trip", `${label}'s source range mixes rate ${s.rate} and rate ${d.rate}`);
	return { start: s.value, duration: d.value, rate: s.rate };
}

function known(o: Json, label: string) {
	const allowed = KEYS[o.OTIO_SCHEMA];
	const extra = Object.keys(o).filter((k) => !allowed.includes(k));
	if (extra.length) throw new OtioRefusal("format-not-round-trip", `${label} holds ${extra.join(", ")}, which Cut cannot represent`);
}

/** Effects and markers on an item, a track or the stack are not represented by Cut: refused, naming whose. */
function plain(o: Json, label: string) {
	for (const k of ["effects", "markers"]) {
		if (o[k] !== undefined && (!Array.isArray(o[k]) || o[k].length)) throw new OtioRefusal("format-not-round-trip", `the ${k} of ${label} cannot be represented by Cut`);
	}
	if (o.source_range !== undefined && o.source_range !== null && o.OTIO_SCHEMA !== "Clip.2" && o.OTIO_SCHEMA !== "Gap.1") {
		throw new OtioRefusal("format-not-round-trip", `the trim of ${label} cannot be represented by Cut`);
	}
}

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Json => (isObj(v) ? v : {});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(sortKeys);
	if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
	return v;
}
