/**
 * A whole Cut (OpenCut) project as OpenTimelineIO (OneOS doctrine files/989): the proof that .otio can SAVE everything Cut holds
 * (Mona 2026-11-08: "if otio cannot save then we need our own format that can encompass everything of both").
 *
 * The mapping, core OTIO schema first and Cut's own metadata namespace (`metadata.opencut`) only where OTIO has no core type:
 *   project (metadata, settings, current scene, version, view state, the media list)  -> SerializableCollection.1 + metadata.opencut.project
 *   scene                                    -> Timeline.1 (name), metadata.opencut.scene (id, isMain, created/updated)
 *   bookmark                                 -> Marker.2 on the timeline's Stack (marked_range = time, duration), metadata.opencut.bookmark (note, colour)
 *   track (main / overlay / audio)           -> Track.1 (name; kind Video or Audio), metadata.opencut.track (id, type, muted, hidden, slot)
 *   element on a track                       -> Clip.2 (name; position by Gap.1; source_range = trimStart + duration in ticks)
 *     video / image / uploaded audio media   -> ExternalReference.1, target_url oneos:file/<id>?version=<v>
 *     text / sticker / graphic / effect      -> GeneratorReference.1 (generator_kind OpenCut.<type>)
 *     everything else of the element         -> metadata.opencut.element (transform, opacity, blend, effects, masks, animations, retime,
 *                                               text style, volume, trimEnd, sourceDuration ...)
 * Times are integer ticks: RationalTime { rate: 120000, value: ticks }, exact.
 * Overlapping elements: OpenCut's placement and moves refuse an overlap, but a resize does not check (timeline/controllers/resize-controller.ts),
 * so a track can hold one. An OTIO Track.1 is a sequence, so such a track is saved as a Stack.1 of lanes (Track.1 each, the fewest that
 * hold its elements without overlap) carrying the track's metadata; reading merges the lanes back in the track's own element order.
 * Refused by name: a library sound (`library-sound-off`: Freesound is off in OneOS, so no sound is ever imported from it; a sound is used
 * only once it is a OneOS file), and an element whose medium is not in the project's media list.
 */

import { CaptionRefusal, isCaptionTrack, readCaptionTrack, writeCaptionTrack } from "./captions.ts";
import { transitionChild, transitionsAmong } from "./transitions.ts";

export const TICKS = 120_000;

export class CutOtioRefusal extends Error {
	readonly code: "transition-not-carried" | "media-not-referenced" | "format-not-round-trip" | "file-unreadable" | "library-sound-off" | "caption-look-not-in-film" | "caption-overlap";
	constructor(code: CutOtioRefusal["code"], reason: string) {
		super(`${code}: ${reason}`);
		this.code = code;
	}
}

type J = Record<string, any>;
export interface CutMedia {
	id: string;
	name: string;
	type: string;
	file: { id: string; version: string };
	[k: string]: unknown;
}
export interface CutProject {
	project: J;
	media: CutMedia[];
}

const rt = (ticks: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: TICKS, value: ticks });
const tr = (start: number, dur: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start), duration: rt(dur) });
const MEDIA_TYPES = new Set(["video", "image", "audio"]);
const ELEMENT_CORE = ["name", "startTime", "duration", "trimStart"];
const omit = (o: J, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const ticksOf = (t: J, what: string) => {
	if (!t || t.rate !== TICKS || !Number.isInteger(t.value)) throw new CutOtioRefusal("format-not-round-trip", `${what} is not in Cut's ticks (rate ${TICKS})`);
	return t.value as number;
};

/** The canvas a Cut project draws on (its settings), else Cut's default. */
const canvasOf = (p: J) => (p?.settings?.canvasSize && typeof p.settings.canvasSize.width === "number" ? p.settings.canvasSize : { width: 1920, height: 1080 });

export function cutToOtio(cut: CutProject): J {
	const mediaById = new Map(cut.media.map((m) => [m.id, m]));
	const canvas = canvasOf(cut.project);
	for (const m of cut.media) if (!/^[0-9a-z]{26}$/.test(m.file?.id ?? "") || !m.file?.version) throw new CutOtioRefusal("media-not-referenced", `the medium ${m.name} is not a OneOS file and version`);
	const p = cut.project;
	return {
		OTIO_SCHEMA: "SerializableCollection.1",
		name: p.metadata?.name ?? "",
		metadata: { opencut: { project: omit(p, ["scenes"]), media: cut.media } },
		children: (p.scenes as J[]).map((scene) => {
			const tracks: Array<[J, string]> = [[scene.tracks.main, "main"], ...scene.tracks.overlay.map((t: J) => [t, "overlay"] as [J, string]), ...scene.tracks.audio.map((t: J) => [t, "audio"] as [J, string])];
			return {
				OTIO_SCHEMA: "Timeline.1",
				name: scene.name,
				global_start_time: null,
				metadata: { opencut: { scene: omit(scene, ["name", "tracks", "bookmarks"]) } },
				tracks: {
					OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], enabled: true, metadata: {},
					markers: (scene.bookmarks as J[]).map((b) => ({ OTIO_SCHEMA: "Marker.2", name: b.note ?? "", marked_range: tr(b.time, b.duration ?? 0), color: "RED", comment: "", metadata: { opencut: { bookmark: omit(b, ["time"]) } } })),
					children: tracks.map(([t, slot]) => (t.type === "caption" ? captionTrack(t, slot, canvas) : track(t, slot, mediaById))),
				},
			};
		}),
	};
}

function lane(els: J[], media: Map<string, CutMedia>, transitions: J[] = []): J[] {
	const children: J[] = [];
	const placedAt = new Map<string, number>();
	let at = 0;
	for (const e of els) {
		if (e.startTime > at) children.push({ OTIO_SCHEMA: "Gap.1", name: "", source_range: tr(0, e.startTime - at), effects: [], markers: [], enabled: true, metadata: {} });
		placedAt.set(e.id, children.length);
		children.push(clip(e, media));
		at = e.startTime + e.duration;
	}
	// files/989 ("Simple ones only"): the track's transitions in Film's own shape, after the clip ending at the cut, else before the one
	// starting there.
	const inserts = transitions.map((x) => ({ i: x.fromId !== null ? (placedAt.get(x.fromId) as number) + 1 : (placedAt.get(x.toId) as number), x }));
	for (const { i, x } of inserts.sort((a, b) => b.i - a.i)) {
		if (!Number.isInteger(i)) throw new CutOtioRefusal("transition-not-carried", `a transition names an element its track does not hold`);
		children.splice(i, 0, transitionChild(x as never, TICKS, null));
	}
	return children;
}

function track(t: J, slot: string, media: Map<string, CutMedia>): J {
	const els = [...t.elements].sort((a: J, b: J) => a.startTime - b.startTime);
	// The fewest lanes that hold the elements without overlap (one, unless a resize made two overlap).
	const lanes: J[][] = [];
	for (const e of els) {
		const free = lanes.find((l) => { const last = l[l.length - 1]; return last.startTime + last.duration <= e.startTime; });
		if (free) free.push(e);
		else lanes.push([e]);
	}
	const kind = slot === "audio" ? "Audio" : "Video";
	const meta = { opencut: { track: omit(t, ["name", "elements", "transitions"]), slot, order: t.elements.map((e: J) => e.id) } };
	const transitions: J[] = Array.isArray(t.transitions) ? t.transitions : [];
	if (lanes.length <= 1) {
		return { OTIO_SCHEMA: "Track.1", name: t.name, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: meta, children: lane(lanes[0] ?? [], media, transitions) };
	}
	if (transitions.length) throw new CutOtioRefusal("transition-not-carried", `the track "${t.name}" holds a transition and elements that overlap, which an OpenTimelineIO track (a sequence) cannot hold together`);
	return {
		OTIO_SCHEMA: "Stack.1", name: t.name, source_range: null, effects: [], markers: [], enabled: true, metadata: meta,
		children: lanes.map((l, i) => ({ OTIO_SCHEMA: "Track.1", name: `${t.name} (lane ${i + 1})`, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: { opencut: { lane: i } }, children: lane(l, media) })),
	};
}

/**
 * A caption track (files/989, Mona 2026-11-10: "Caption track in the .otio") in Film's shape, as both tools write it; Cut's own beside it: the
 * track's id and type, its slot and order, each caption's id (and its name, when it is not its text).
 */
function captionTrack(t: J, slot: string, canvas: { width: number; height: number }): J {
	try {
		return writeCaptionTrack(t, null, TICKS, canvas, new Map(), {
			track: { track: { id: t.id, type: t.type }, slot, order: t.elements.map((e: J) => e.id) },
			element: (e) => ({ id: e.id, ...(e.name !== e.content ? { name: e.name } : {}) }),
		});
	} catch (e) {
		if (e instanceof CaptionRefusal) throw new CutOtioRefusal(e.code, e.message.replace(/^[a-z-]+: /, ""));
		throw e;
	}
}

function clip(e: J, media: Map<string, CutMedia>): J {
	let ref: J;
	if (MEDIA_TYPES.has(e.type)) {
		if (e.type === "audio" && e.sourceType === "library") throw new CutOtioRefusal("library-sound-off", `the library sound ${e.name} comes from Freesound, which is off in OneOS; a sound is used only once it is a OneOS file`);
		const m = media.get(e.mediaId);
		if (!m) throw new CutOtioRefusal("media-not-referenced", `${e.name} names the medium ${e.mediaId}, which the project does not hold`);
		ref = { OTIO_SCHEMA: "ExternalReference.1", name: m.name, target_url: `oneos:file/${m.file.id}?version=${m.file.version}`, available_range: null, available_image_bounds: null, metadata: {} };
	} else {
		ref = { OTIO_SCHEMA: "GeneratorReference.1", name: e.name, generator_kind: `OpenCut.${e.type}`, parameters: {}, available_range: null, metadata: {} };
	}
	return {
		OTIO_SCHEMA: "Clip.2", name: e.name, source_range: tr(e.trimStart, e.duration), effects: [], markers: [], enabled: true,
		media_references: { DEFAULT_MEDIA: ref }, active_media_reference_key: "DEFAULT_MEDIA",
		metadata: { opencut: { element: omit(e, ELEMENT_CORE) } },
	};
}

export function otioToCut(doc: J): CutProject {
	if (doc?.OTIO_SCHEMA !== "SerializableCollection.1" || !doc.metadata?.opencut?.project) throw new CutOtioRefusal("file-unreadable", "not a Cut project collection");
	const oc = doc.metadata.opencut;
	const media: CutMedia[] = oc.media;
	const project: J = { ...oc.project };
	project.scenes = (doc.children as J[]).map((tl) => {
		const tracks = { main: null as J | null, overlay: [] as J[], audio: [] as J[] };
		for (const t of tl.tracks.children as J[]) {
			const meta = t.metadata.opencut;
			if (isCaptionTrack(t)) {
				const read = readCaptionTrack(t, meta.track.id, canvasOf(project), (c) => c.metadata.opencut.element.id);
				if (typeof read === "string") throw new CutOtioRefusal("format-not-round-trip", `the caption track "${t.name}" ${read}`);
				const byClip = (t.children as J[]).filter((c) => c.OTIO_SCHEMA === "Clip.2").map((c) => c.metadata.opencut.element);
				read.track.elements.forEach((e: J, i: number) => { if (typeof byClip[i]?.name === "string") e.name = byClip[i].name; });
				const byId = new Map((read.track.elements as J[]).map((e) => [e.id, e]));
				const track = { ...read.track, elements: (meta.order as string[]).map((id) => byId.get(id)) };
				(meta.slot === "audio" ? tracks.audio : tracks.overlay).push(track);
				continue;
			}
			const elements: J[] = [];
			const lanes: J[] = t.OTIO_SCHEMA === "Stack.1" ? t.children : [t];
			// files/989 ("Simple ones only"): the track's transitions, read from Film's shape among its children.
			let transitions: J[] = [];
			if (lanes.length === 1) {
				const read = transitionsAmong(t.children as J[], t.kind === "Audio", (c) => c.metadata?.opencut?.element?.id, (n) => `${meta.track.id}-x${n}`);
				if (typeof read === "string") throw new CutOtioRefusal("format-not-round-trip", `the track "${t.name}": ${read}`);
				transitions = read.map((r) => r.x);
			}
			for (const l of lanes) {
				let at = 0;
				for (const c of l.children as J[]) {
					if (c.OTIO_SCHEMA === "Transition.1") continue;
					if (c.OTIO_SCHEMA === "Gap.1") { at += ticksOf(c.source_range.duration, "a gap"); continue; }
					const duration = ticksOf(c.source_range.duration, c.name);
					elements.push({ ...c.metadata.opencut.element, name: c.name, startTime: at, duration, trimStart: ticksOf(c.source_range.start_time, c.name) });
					at += duration;
				}
			}
			const byId = new Map(elements.map((e) => [e.id, e]));
			const ordered = (meta.order as string[]).map((id) => byId.get(id));
			const track = { ...meta.track, name: t.name, elements: ordered, ...(transitions.length ? { transitions } : {}) };
			if (meta.slot === "main") tracks.main = track;
			else (meta.slot === "overlay" ? tracks.overlay : tracks.audio).push(track);
		}
		const bookmarks = (tl.tracks.markers as J[]).map((m) => {
			const b: J = { time: ticksOf(m.marked_range.start_time, "a bookmark"), ...m.metadata.opencut.bookmark };
			return b;
		});
		return { ...tl.metadata.opencut.scene, name: tl.name, tracks, bookmarks };
	});
	return { project, media };
}
