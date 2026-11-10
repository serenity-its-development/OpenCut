/**
 * The ONE video project format of Cut and Film (OneOS doctrine files/989; Mona 2026-11-08: "OpenTimelineIO .otio", "Stay on .otio, fix
 * writers"). Cut opens any OpenTimelineIO document (a Timeline.1, or Film's SerializableCollection.1 of a whole project), shows what it can
 * edit and CARRIES THE REST THROUGH UNTOUCHED: the document is kept as read, and a save writes it back with only Cut's edits applied.
 *
 * Editable: a Track.1 (Video or Audio) whose children are all plain `Clip.2` and `Gap.1`; a clip's one DEFAULT_MEDIA is an `ExternalReference.1`
 * that is a OneOS file (`oneos:file/<id>?version=<v>`), or Cut's OWN generator (`GeneratorReference.1` of kind `OpenCut.<text|sticker|graphic|
 * effect>` whose clip carries `metadata.opencut.element`); no effects but a speed; a clip's own markers are carried untouched on it. Cut's own stacked lanes (a `Stack.1` with
 * `metadata.opencut.track` of `Track.1` lanes each marked `metadata.opencut.lane`) are one editable track. Anything else on a track - a
 * transition other than Film's simple ones (files/989, "Simple ones only"), an effect, a marker, another tool's stack or generator, media that is not a OneOS file - LOCKS that track (shown, not editable,
 * written back exactly), with the reason named.
 * Everything outside the tracks (Film's metadata.filmcraft.project, other tools' metadata, the stack's own markers) is never touched.
 * Refused by name only what Cut would damage: bytes that are not OpenTimelineIO, and a document its own write-back would change.
 * Pure: no DOM, no storage, no network.
 */

import { readTransition } from "./transitions.ts";
import type { TransitionKind } from "../timeline/transitions.ts";

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
	| { type: "generator"; name: string; enabled: boolean; source: Span; kind: string; metadata: Json; raw: Json }
	| { type: "gap"; name: string; enabled: boolean; source: Span; metadata: Json; raw: Json }
	/** files/989 ("Simple ones only"): one of Film's simple transitions, between the items either side of it (`oneos/transitions.ts`). */
	| { type: "transition"; name: string; kind: TransitionKind; before: number; after: number; raw: Json };
export interface Track {
	kind: string;
	name: string;
	/** Null when Cut may edit it; else why it is locked (carried through untouched). */
	locked: string | null;
	/** A plain track's items; empty for Cut's stacked lanes, whose items are `lanes`. */
	items: Item[];
	/** Cut's own stacked lanes (a track a resize made overlap), each a sequence; null for a plain track. */
	lanes: Item[][] | null;
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
	if (!isObj(t)) return { kind: "", name: `track ${i + 1}`, locked: "it is not an object", items: [], lanes: null, raw: t as Json };
	const name = typeof t.name === "string" ? t.name : `track ${i + 1}`;
	const lockedTrack = (why: string): Track => ({ kind: String(t.kind ?? ""), name, locked: why, items: [], lanes: null, raw: t });
	if (t.OTIO_SCHEMA === "Stack.1" && isObj(t.metadata?.opencut?.track)) return laneStack(t, name, lockedTrack);
	if (t.OTIO_SCHEMA !== "Track.1") return lockedTrack(`it is a ${String(t.OTIO_SCHEMA)} (a nested stack), which Cut carries but does not edit`);
	const seq = sequence(t);
	if (typeof seq === "string") return lockedTrack(seq);
	return { kind: t.kind, name, locked: null, items: seq, lanes: null, raw: t };
}

/** A Track.1's items when Cut may edit it, else why not. */
function sequence(t: Json): Item[] | string {
	if (t.kind !== "Video" && t.kind !== "Audio") return `it is of kind ${String(t.kind)}`;
	if ((Array.isArray(t.effects) && t.effects.length) || (Array.isArray(t.markers) && t.markers.length)) return "it has effects or markers of its own";
	const items: Item[] = [];
	for (const c of Array.isArray(t.children) ? t.children : []) {
		// Film's simple transitions Cut edits (files/989, Mona 2026-11-10: "Simple ones only"); any other locks the track, named.
		if (isObj(c) && c.OTIO_SCHEMA === "Transition.1") {
			const read = readTransition(c, t.kind === "Audio");
			if (typeof read === "string") return read;
			items.push({ type: "transition", name: typeof c.name === "string" ? c.name : "", ...read, raw: c });
			continue;
		}
		const why = editable(c);
		if (why) return why;
		const source = { start: c.source_range.start_time.value, duration: c.source_range.duration.value, rate: c.source_range.duration.rate };
		const common = { name: typeof c.name === "string" ? c.name : "", enabled: c.enabled !== false, source, metadata: isObj(c.metadata) ? c.metadata : {}, raw: c };
		if (c.OTIO_SCHEMA === "Gap.1") items.push({ type: "gap", ...common });
		else if (c.media_references.DEFAULT_MEDIA.OTIO_SCHEMA === "GeneratorReference.1") items.push({ type: "generator", kind: c.media_references.DEFAULT_MEDIA.generator_kind, ...common });
		else items.push({ type: "clip", media: parseMediaUrl(c.media_references.DEFAULT_MEDIA.target_url)!, ...common });
	}
	return items;
}

/** Cut's own stacked lanes as one editable track, or locked with the reason. */
function laneStack(t: Json, name: string, lockedTrack: (why: string) => Track): Track {
	if ((Array.isArray(t.effects) && t.effects.length) || (Array.isArray(t.markers) && t.markers.length)) return lockedTrack("its stack has effects or markers of its own");
	const kids: unknown[] = Array.isArray(t.children) ? t.children : [];
	if (!kids.length) return lockedTrack("it is a stack of no lanes");
	const lanes: Item[][] = [];
	let kind = "";
	for (const [li, l] of kids.entries()) {
		if (!isObj(l) || l.OTIO_SCHEMA !== "Track.1" || l.metadata?.opencut?.lane !== li) return lockedTrack(`it is a ${String(t.OTIO_SCHEMA)} (a nested stack) whose lane ${li + 1} is not one of Cut's`);
		if (kind && l.kind !== kind) return lockedTrack("its lanes are of different kinds");
		kind = l.kind;
		const seq = sequence(l);
		if (typeof seq === "string") return lockedTrack(`lane ${li + 1}: ${seq}`);
		if (seq.some((it) => it.type === "transition")) return lockedTrack(`lane ${li + 1} holds a transition, which Cut's stacked lanes do not`);
		lanes.push(seq);
	}
	return { kind, name, locked: null, items: [], lanes, raw: t };
}

/** Cut's own generated elements (a text, sticker, graphic or effect), as Cut writes them. */
export const OWN_GENERATOR = /^OpenCut\.(text|sticker|graphic|effect)$/;

/**
 * files/989 (Mona 2026-11-10: "Build linked audio, lock multicam"): Film's multi-camera clip (a nested stack whose source names its cameras,
 * `metadata.filmcraft.multicam`, or whose clip names its angle, `metadata.filmcraft.clip.multicam`) is locked in Cut, named, and carried
 * untouched; Cut builds no multicam. The reason, or null when `c` is not one.
 */
function filmMulticam(c: Json): string | null {
	const fc = isObj(c.metadata) && isObj(c.metadata.filmcraft) ? c.metadata.filmcraft : null;
	if (!fc || (!isObj(fc.multicam) && !(isObj(fc.clip) && isObj(fc.clip.multicam)))) return null;
	const cams = isObj(fc.multicam) && Array.isArray(fc.multicam.cameras) ? fc.multicam.cameras.map((x: unknown) => (isObj(x) && typeof x.name === "string" ? x.name : "")).filter(Boolean) : [];
	const angle = isObj(fc.clip) && isObj(fc.clip.multicam) && typeof fc.clip.multicam.angle === "number" ? fc.clip.multicam.angle : null;
	const shows = angle !== null && cams[angle] ? `, showing ${cams[angle]}` : "";
	const name = typeof c.name === "string" && c.name ? ` "${c.name}"` : "";
	return `it holds Film's multicam clip${name}${cams.length ? ` (cameras: ${cams.join(", ")}${shows})` : ""}, which Cut carries untouched and does not edit`;
}

/** The name Film gives one of its generators (filmcraft `media/src/generators.rs` `Generator::label`), from the serde shape Film writes. */
function filmGeneratorName(g: unknown): string {
	const tag = typeof g === "string" ? g : isObj(g) ? Object.keys(g)[0] ?? "" : "";
	const names: Record<string, string> = { BarsAndTone: "Bars and Tone", ColorMatte: "Color Matte", BlackVideo: "Black Video", TransparentVideo: "Transparent Video", CountingLeader: "Universal Counting Leader", Demo: "demo scene", Tone: "Tone" };
	return names[tag] ?? (tag || "unnamed");
}

/** Cut's speed range (the editor's `retime/rate.ts`: `MIN_RETIME_RATE`, `MAX_RETIME_RATE`; pinned equal by `editor/retime.test.ts`). */
export const CUT_RATE = { min: 0.01, max: 5 } as const;

/** A clip's speed as OpenTimelineIO says it: its one `LinearTimeWarp.1` (a negative scalar is reverse, as Film writes it). */
export interface TimeWarp { rate: number; reverse: boolean }

const WARP_KEYS = ["OTIO_SCHEMA", "effect_name", "metadata", "name", "time_scalar"];

/**
 * files/989 (2c, speed and reverse): the clip's speed, when its effects are exactly one `LinearTimeWarp.1` as Film writes it (no name, no
 * metadata), within Cut's range; null when it has no effects; else why Cut cannot show it (a frame hold, a speed outside Cut's, another
 * effect), named.
 */
export function readTimeWarp(c: Json): TimeWarp | null | string {
	const effects: unknown[] = Array.isArray(c.effects) ? c.effects : [];
	if (!effects.length) return null;
	const name = typeof c.name === "string" && c.name ? ` "${c.name}"` : "";
	const w = effects[0];
	if (effects.length === 1 && isObj(w) && w.OTIO_SCHEMA === "FreezeFrame.1") return `the clip${name} holds a frame, which Cut has no hold for`;
	const plain = effects.length === 1 && isObj(w) && w.OTIO_SCHEMA === "LinearTimeWarp.1" && w.effect_name === "LinearTimeWarp" && (w.name ?? "") === ""
		&& Object.keys(w).every((k) => WARP_KEYS.includes(k)) && (w.metadata === undefined || (isObj(w.metadata) && Object.keys(w.metadata).length === 0));
	if (!plain) return `the clip${name} has effects Cut does not show`;
	const s = w.time_scalar;
	if (typeof s !== "number" || !Number.isFinite(s) || s === 0) return `the clip${name} has a speed Cut cannot read`;
	if (Math.abs(s) < CUT_RATE.min || Math.abs(s) > CUT_RATE.max) return `the clip${name} plays at ${+(Math.abs(s) * 100).toFixed(6)}%, outside Cut's speed (${CUT_RATE.min * 100}% to ${CUT_RATE.max * 100}%)`;
	return { rate: Math.abs(s), reverse: s < 0 };
}

/** The clip's effects for a speed (Film's own shape: one `LinearTimeWarp.1`, its scalar negative when reversed); none at 100% forwards. */
export function timeWarpEffects(w: TimeWarp | null): Json[] {
	if (!w || (w.rate === 1 && !w.reverse)) return [];
	return [{ OTIO_SCHEMA: "LinearTimeWarp.1", name: "", effect_name: "LinearTimeWarp", time_scalar: w.reverse ? -w.rate : w.rate, metadata: {} }];
}

/** Why a track item is not something Cut edits (null: it is). */
function editable(c: unknown): string | null {
	if (!isObj(c)) return "it holds a non-object";
	const label = `${String(c.OTIO_SCHEMA)} ${typeof c.name === "string" && c.name ? `"${c.name}"` : ""}`.trim();
	const multicam = filmMulticam(c);
	if (multicam) return multicam;
	// Film's nested sequence (files/989, 2c nested sequences, under the rule of thumb): Cut has no nesting, so it is named, carried, locked.
	if (c.OTIO_SCHEMA === "Stack.1" && isObj(c.metadata?.filmcraft) && isObj(c.metadata.filmcraft.clip)) return `it holds Film's nested sequence${typeof c.name === "string" && c.name ? ` "${c.name}"` : ""}, which Cut carries untouched and does not edit (Cut has no nested sequences)`;
	if (c.OTIO_SCHEMA !== "Clip.2" && c.OTIO_SCHEMA !== "Gap.1") return `it holds a ${label}, which Cut carries but does not edit`;
	// A clip's own markers (files/989, 2c clip markers; the rule of thumb) Cut carries untouched on the clip, which stays editable; Cut has no
	// clip-marker type of its own. A gap's markers, or anything in a clip's markers that is not a marker, still locks the track.
	if (Array.isArray(c.markers) && c.markers.length) {
		if (c.OTIO_SCHEMA !== "Clip.2") return `${label} has markers of its own, which Cut carries but does not edit`;
		if (!c.markers.every((m: unknown) => isObj(m) && (m.OTIO_SCHEMA === "Marker.2" || m.OTIO_SCHEMA === "Marker.1") && isObj(m.marked_range) && isObj(m.marked_range.start_time) && typeof m.marked_range.start_time.value === "number" && typeof m.marked_range.start_time.rate === "number" && m.marked_range.start_time.rate > 0)) return `${label} holds markers Cut cannot read`;
	}
	// A clip's speed and reverse (files/989, 2c) Cut edits; any other effect locks the track, named.
	const warp = c.OTIO_SCHEMA === "Clip.2" ? readTimeWarp(c) : Array.isArray(c.effects) && c.effects.length ? `${label} has effects or markers` : null;
	if (typeof warp === "string") return warp;
	const r = c.source_range;
	if (!isObj(r) || !isObj(r.start_time) || !isObj(r.duration) || typeof r.start_time.value !== "number" || typeof r.duration.value !== "number" || r.start_time.rate !== r.duration.rate) return `${label} has no plain source range`;
	if (c.OTIO_SCHEMA === "Gap.1") return null;
	const refs = c.media_references;
	if (!isObj(refs) || Object.keys(refs).length !== 1 || c.active_media_reference_key !== "DEFAULT_MEDIA" || !isObj(refs.DEFAULT_MEDIA)) return `${label} has more than one media reference`;
	if (refs.DEFAULT_MEDIA.OTIO_SCHEMA === "GeneratorReference.1" && OWN_GENERATOR.test(String(refs.DEFAULT_MEDIA.generator_kind)) && isObj(c.metadata?.opencut?.element)) {
		return warp ? `${label} has a speed, which Cut's ${String(refs.DEFAULT_MEDIA.generator_kind).slice("OpenCut.".length)} has none of` : null;
	}
	// Film's generators (files/989, 2c generators, under the rule of thumb): Cut draws none of them, so each is named, carried, locked.
	const g = refs.DEFAULT_MEDIA.OTIO_SCHEMA === "GeneratorReference.1" && isObj(refs.DEFAULT_MEDIA.metadata?.filmcraft) ? refs.DEFAULT_MEDIA.metadata.filmcraft.generator : undefined;
	if (g !== undefined) return `${label} is Film's ${filmGeneratorName(g)} generator, which Cut carries untouched and does not draw or edit`;
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
			if (t.lanes) t.lanes.forEach((lane, li) => { rt.children[li].children = lane.map(writeItem); });
			else rt.children = t.items.map(writeItem);
		});
	});
	return new TextEncoder().encode(`${JSON.stringify(raw, null, 4)}\n`);
}

function writeItem(it: Item): Json {
	const r = clone(it.raw);
	if (it.type === "transition") return r;
	r.name = it.name;
	r.enabled = it.enabled;
	r.metadata = clone(it.metadata);
	r.source_range.start_time.value = it.source.start;
	r.source_range.duration.value = it.source.duration;
	r.source_range.start_time.rate = r.source_range.duration.rate = it.source.rate;
	if (it.type === "clip") r.media_references.DEFAULT_MEDIA.target_url = mediaUrl(it.media.id, it.media.version);
	return r;
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
