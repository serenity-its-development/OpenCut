/**
 * OneOS (files/989, Mona 2026-11-10: "Simple ones only"): Cut's transitions. Cut edits Film's SIMPLE transitions and no others: a cross
 * dissolve, a dip to black and a dip to white between pictures, and the two audio crossfades (constant power, constant gain). Each sits at a
 * cut of one track, between the element that ends there (`fromId`) and the one that starts there (`toId`); either may be absent (a fade from
 * or to nothing at an element's edge). Its window is `before` ticks before the cut and `after` ticks after it, as OpenTimelineIO's
 * `in_offset`/`out_offset` say it. Inside the window both sides play, each into its handle (the medium past its trim), as Film plays them.
 *
 * Cut draws them EXACTLY as Film does (filmcraft `render/src/plan.rs`, `render/src/transitions/legacy.rs`, `render/src/audio.rs`), at
 * progress p = (t - start) / (before + after):
 * - cross dissolve: the outgoing picture at full (at 1 - p when nothing comes in), the incoming one over it at p;
 * - dip to black / white: the colour over the whole frame, the outgoing picture over it at 1 - 2p in the first half, the incoming at 2p - 1
 *   in the second;
 * - constant power: the outgoing sound at cos(p·π/2), the incoming at sin(p·π/2); constant gain: 1 - p and p.
 * Film's other transition kinds lock their track in Cut, named (`oneos/otio.ts`), and are carried untouched.
 * Pure: no DOM, no editor state.
 */
import type { SceneTracks, TimelineTrack } from "./types";

export type PictureTransitionKind = "cross-dissolve" | "dip-to-black" | "dip-to-white";
export type SoundTransitionKind = "constant-power" | "constant-gain";
export type TransitionKind = PictureTransitionKind | SoundTransitionKind;

export interface TrackTransition {
	id: string;
	kind: TransitionKind;
	/** The element that ends at the cut (outgoing); null: the transition fades in from nothing. */
	fromId: string | null;
	/** The element that starts at the cut (incoming); null: it fades out to nothing. */
	toId: string | null;
	/** Ticks of the window before the cut (OpenTimelineIO's `in_offset`). */
	before: number;
	/** Ticks of the window after the cut (`out_offset`). */
	after: number;
}

export const PICTURE_TRANSITIONS: readonly PictureTransitionKind[] = ["cross-dissolve", "dip-to-black", "dip-to-white"];
export const SOUND_TRANSITIONS: readonly SoundTransitionKind[] = ["constant-power", "constant-gain"];

/** Film's effect id for each kind Cut draws (filmcraft `project/src/vtransition.rs`, `project/src/effect.rs`). */
export const FILM_TRANSITION_EFFECT: Readonly<Record<TransitionKind, string>> = {
	"cross-dissolve": "cross_dissolve",
	"dip-to-black": "dip_to_black",
	"dip-to-white": "dip_to_white",
	"constant-power": "constant_power",
	"constant-gain": "constant_gain",
};
/** Film's name for each (its Effects panel, written as the transition's OTIO `name`). */
export const TRANSITION_NAME: Readonly<Record<TransitionKind, string>> = {
	"cross-dissolve": "Cross Dissolve",
	"dip-to-black": "Dip to Black",
	"dip-to-white": "Dip to White",
	"constant-power": "Constant Power",
	"constant-gain": "Constant Gain",
};

/** The kind Cut draws for Film's effect id, or null when Cut does not draw it (the track stays locked, named). */
export function kindOfFilmEffect(effect: unknown): TransitionKind | null {
	for (const [k, v] of Object.entries(FILM_TRANSITION_EFFECT)) if (v === effect) return k as TransitionKind;
	return null;
}

export const isSoundKind = (k: TransitionKind): k is SoundTransitionKind => (SOUND_TRANSITIONS as readonly string[]).includes(k);

type Placed = { id: string; startTime: number; duration: number };

/** The tracks that hold transitions: a video track (its pictures) and an audio track (its sounds). */
export function holdsTransitions(track: TimelineTrack): track is Extract<TimelineTrack, { type: "video" | "audio" }> {
	return track.type === "video" || track.type === "audio";
}
export function transitionsOf(track: TimelineTrack): TrackTransition[] {
	return holdsTransitions(track) ? (track.transitions ?? []) : [];
}

export interface TransitionWindow { start: number; end: number; cut: number; from: Placed | null; to: Placed | null }

/**
 * Where a transition is on its track, or why it cannot be there (a string): its sides exist and meet at one cut, its window lies within
 * each side it covers, its kind is the track's (a picture's on a video track, a sound's on an audio track), and it is not empty.
 */
export function transitionWindow(track: TimelineTrack, x: TrackTransition): TransitionWindow | string {
	if (!holdsTransitions(track)) return `a ${track.type} track holds no transitions`;
	if (isSoundKind(x.kind) !== (track.type === "audio")) return `a ${TRANSITION_NAME[x.kind]} is not a ${track.type === "audio" ? "sound's" : "picture's"} transition`;
	const els = track.elements as Placed[];
	const from = x.fromId === null ? null : (els.find((e) => e.id === x.fromId) ?? null);
	const to = x.toId === null ? null : (els.find((e) => e.id === x.toId) ?? null);
	if (!from && !to) return "neither side of it is on the track";
	if ((x.fromId !== null && !from) || (x.toId !== null && !to)) return "a side of it is no longer on the track";
	if (!Number.isSafeInteger(x.before) || !Number.isSafeInteger(x.after) || x.before < 0 || x.after < 0 || x.before + x.after <= 0) return "its window is not a whole, positive number of ticks";
	const cut = from ? from.startTime + from.duration : (to as Placed).startTime;
	if (from && to && to.startTime !== cut) return "its two sides no longer meet at a cut";
	if (from && x.before > from.duration) return "its window reaches past the start of the outgoing element";
	if (to && x.after > to.duration) return "its window reaches past the end of the incoming element";
	return { start: cut - x.before, end: cut + x.after, cut, from, to };
}

/** Each transition still placed (the track's own order kept); others go, as Film's go when their clips are moved apart or removed. */
function placedTransitions(track: TimelineTrack): Array<{ x: TrackTransition; w: TransitionWindow }> {
	const out: Array<{ x: TrackTransition; w: TransitionWindow }> = [];
	for (const x of transitionsOf(track)) {
		const w = transitionWindow(track, x);
		if (typeof w === "string") continue;
		// Two windows on one element must not overlap (the first kept).
		if (out.some((o) => o.w.start < w.end && w.start < o.w.end)) continue;
		out.push({ x, w });
	}
	return out;
}

/**
 * The tracks with every transition an edit has left without its place removed (its side deleted, moved apart, or trimmed shorter than its
 * window): the editor's one door for tracks (`TimelineManager.updateTracks`) runs it, so no command leaves one dangling. The same object
 * when nothing went.
 */
export function settleTransitions(tracks: SceneTracks): SceneTracks {
	let changed = false;
	const settle = <T extends TimelineTrack>(t: T): T => {
		if (!holdsTransitions(t) || !t.transitions) return t;
		const kept = placedTransitions(t).map((p) => p.x);
		if (kept.length === t.transitions.length) return t;
		changed = true;
		return { ...t, transitions: kept };
	};
	const out = { main: settle(tracks.main), overlay: tracks.overlay.map(settle), audio: tracks.audio.map(settle) };
	return changed ? out : tracks;
}

/** One element's part in its track's transitions: how far it plays into its handles, and its weight (picture) or gain (sound) at a time. */
export interface TransitionShare {
	/** Ticks it plays before its own start (its head handle). */
	head: number;
	/** Ticks it plays after its own end (its tail handle). */
	tail: number;
	/** Its weight at timeline time `t` (ticks), or null where it is not drawn or heard; 1 inside its own span outside every window. */
	at: (t: number) => number | null;
}

/** A dip's colour layer: over the whole frame, beneath the track's pictures, for the window. */
export interface DipLayer { start: number; end: number; color: "#000000" | "#ffffff"; beneath: string }

/** Film's weights at progress p for the side `role` (plan.rs, audio.rs). Null: the side is not drawn then. */
function weight(kind: TransitionKind, role: "from" | "to", p: number, otherSide: boolean): number | null {
	switch (kind) {
		case "cross-dissolve":
			return role === "from" ? (otherSide ? 1 : 1 - p) : p;
		case "dip-to-black":
		case "dip-to-white":
			if (role === "from") return p < 0.5 ? 1 - p * 2 : null;
			return p < 0.5 ? null : (p - 0.5) * 2;
		case "constant-power":
			return role === "from" ? Math.cos((p * Math.PI) / 2) : Math.sin((p * Math.PI) / 2);
		case "constant-gain":
			return role === "from" ? 1 - p : p;
	}
}

/** Film's progress (`Transition::progress`): (t - start) / duration, within 0..1. */
export const progressAt = (w: TransitionWindow, t: number) => Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start)));

/** Every element of a track that a transition touches, with its share; elements no transition touches are absent. */
export function transitionShares(track: TimelineTrack): Map<string, TransitionShare> {
	const placed = placedTransitions(track);
	const out = new Map<string, TransitionShare>();
	const byElement = new Map<string, Array<{ x: TrackTransition; w: TransitionWindow; role: "from" | "to" }>>();
	for (const p of placed) {
		if (p.w.from) byElement.set(p.w.from.id, [...(byElement.get(p.w.from.id) ?? []), { ...p, role: "from" }]);
		if (p.w.to) byElement.set(p.w.to.id, [...(byElement.get(p.w.to.id) ?? []), { ...p, role: "to" }]);
	}
	for (const [id, parts] of byElement) {
		const e = (track.elements as Placed[]).find((x) => x.id === id) as Placed;
		const head = Math.max(0, ...parts.filter((q) => q.role === "to").map((q) => e.startTime - q.w.start));
		const tail = Math.max(0, ...parts.filter((q) => q.role === "from").map((q) => q.w.end - (e.startTime + e.duration)));
		out.set(id, {
			head,
			tail,
			at: (t) => {
				for (const q of parts) {
					if (t >= q.w.start && t < q.w.end) return weight(q.x.kind, q.role, progressAt(q.w, t), q.role === "from" ? !!q.w.to : !!q.w.from);
				}
				return t >= e.startTime && t < e.startTime + e.duration ? 1 : null;
			},
		});
	}
	return out;
}

/** A video track's dip layers (each beneath the first side of its dip that the track draws). */
export function dipLayers(track: TimelineTrack): DipLayer[] {
	if (track.type !== "video") return [];
	return placedTransitions(track)
		.filter((p) => p.x.kind === "dip-to-black" || p.x.kind === "dip-to-white")
		.map((p) => ({ start: p.w.start, end: p.w.end, color: p.x.kind === "dip-to-black" ? "#000000" : "#ffffff", beneath: ((p.w.from ?? p.w.to) as Placed).id }));
}

/**
 * How far an element's medium reaches past its trims, in timeline ticks (its handles), so a share plays only medium there is (Film plays
 * silence or nothing where the source has none). An image has no end.
 */
export function handleRoom(e: { type: string; trimStart: number; trimEnd: number; retime?: { rate?: number; reverse?: boolean } }): { head: number; tail: number } {
	if (e.type === "image") return { head: Number.POSITIVE_INFINITY, tail: Number.POSITIVE_INFINITY };
	const rate = e.retime?.rate && e.retime.rate > 0 ? e.retime.rate : 1;
	const before = Math.floor(e.trimStart / rate), after = Math.floor(e.trimEnd / rate);
	// A reversed clip plays its span backwards: its head is the medium after the span, its tail the medium before it.
	return e.retime?.reverse === true ? { head: after, tail: before } : { head: before, tail: after };
}

/** A new transition's window for `duration` ticks at its place: centred on a cut, inside the element at an edge with nothing beyond. */
export function windowFor({ fromId, toId, duration }: { fromId: string | null; toId: string | null; duration: number }): { before: number; after: number } {
	if (fromId !== null && toId !== null) {
		const before = Math.floor(duration / 2);
		return { before, after: duration - before };
	}
	return fromId !== null ? { before: duration, after: 0 } : { before: 0, after: duration };
}

/** Film's default transition length is one second; Cut's is the same. */
export const DEFAULT_TRANSITION_TICKS = 120_000;

/** Why a track cannot hold `x` beside its other transitions (null: it can). */
export function transitionRefusal(track: TimelineTrack, x: TrackTransition, others: TrackTransition[]): string | null {
	const w = transitionWindow(track, x);
	if (typeof w === "string") return w;
	const e = (track.elements as Array<Placed & { type: string; trimStart: number; trimEnd: number; retime?: { rate?: number; reverse?: boolean } }>);
	for (const side of [w.from, w.to]) {
		if (!side) continue;
		const el = e.find((y) => y.id === side.id);
		if (!el) continue;
		const room = handleRoom(el);
		const need = side === w.from ? w.end - (side.startTime + side.duration) : side.startTime - w.start;
		if (need > (side === w.from ? room.tail : room.head)) return `the ${side === w.from ? "outgoing" : "incoming"} element has too little of its medium ${side === w.from ? "after its end" : "before its start"} for the window`;
	}
	for (const o of others) {
		if (o.id === x.id) continue;
		const v = transitionWindow(track, o);
		if (typeof v !== "string" && v.start < w.end && w.start < v.end) return "its window overlaps another transition on the track";
	}
	return null;
}

/**
 * The track with a new transition at the cut between `fromId` and `toId` (either null: a fade at the other's edge), `duration` ticks long
 * (Film's one second when unstated), centred on a cut, inside the element at an edge with nothing beyond. Throws, naming why, when it cannot
 * be placed there.
 */
export function withTransitionAdded<T extends TimelineTrack>(track: T, add: { id: string; kind: TransitionKind; fromId: string | null; toId: string | null; duration?: number }): T {
	if (!holdsTransitions(track)) throw new Error(`a ${track.type} track holds no transitions`);
	const others = transitionsOf(track);
	if (others.some((o) => o.fromId === add.fromId && o.toId === add.toId)) throw new Error("that cut already has a transition");
	const x: TrackTransition = { id: add.id, kind: add.kind, fromId: add.fromId, toId: add.toId, ...windowFor({ fromId: add.fromId, toId: add.toId, duration: add.duration ?? DEFAULT_TRANSITION_TICKS }) };
	const why = transitionRefusal(track, x, others);
	if (why) throw new Error(`a ${TRANSITION_NAME[add.kind]} cannot go there: ${why}`);
	return { ...track, transitions: [...others, x] };
}

/** The track with transition `id` changed: its kind, or its window (a new `duration` keeps its place: centred, or at its edge). Throws, named. */
export function withTransitionChanged<T extends TimelineTrack>(track: T, id: string, patch: { kind?: TransitionKind; duration?: number; before?: number; after?: number }): T {
	const all = transitionsOf(track);
	const was = all.find((x) => x.id === id);
	if (!was) throw new Error(`the track holds no transition ${id}`);
	let next: TrackTransition = { ...was, ...(patch.kind ? { kind: patch.kind } : {}) };
	if (patch.duration !== undefined) {
		if (!Number.isSafeInteger(patch.duration) || patch.duration <= 0) throw new Error("a transition's length is a whole, positive number of ticks");
		const centred = was.before > 0 && was.after > 0;
		next = { ...next, ...(centred ? windowFor({ fromId: "a", toId: "b", duration: patch.duration }) : was.before > 0 ? { before: patch.duration, after: 0 } : { before: 0, after: patch.duration }) };
	}
	if (patch.before !== undefined) next.before = patch.before;
	if (patch.after !== undefined) next.after = patch.after;
	const why = transitionRefusal(track, next, all);
	if (why) throw new Error(`the ${TRANSITION_NAME[next.kind]} cannot be so: ${why}`);
	return { ...track, transitions: all.map((x) => (x.id === id ? next : x)) };
}

/** The track without transition `id` (throws, named, when it holds none). */
export function withTransitionRemoved<T extends TimelineTrack>(track: T, id: string): T {
	const all = transitionsOf(track);
	if (!all.some((x) => x.id === id)) throw new Error(`the track holds no transition ${id}`);
	return { ...track, transitions: all.filter((x) => x.id !== id) };
}

/** The kind a new transition takes on a track when none is named: Film's defaults (Cross Dissolve; Constant Power). */
export const defaultTransitionKind = (track: TimelineTrack): TransitionKind => (track.type === "audio" ? "constant-power" : "cross-dissolve");
