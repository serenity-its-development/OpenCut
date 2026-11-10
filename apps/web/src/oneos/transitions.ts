/**
 * Film's simple transitions in the .otio, both ways (OneOS doctrine files/989, Mona 2026-11-10: "Simple ones only"). A transition is a
 * `Transition.1` among its track's children, in FILM'S OWN SHAPE (filmcraft `crates/interchange/src/otio.rs` `transition_json`): between the
 * clip ending at its cut and the clip starting there (a gap or the track's edge on a side: a fade from or to nothing), `in_offset` before the
 * cut and `out_offset` after it, its `name` Film's, `transition_type` `SMPTE_Dissolve` for the dissolves and crossfades else
 * `Custom_Transition`, and `metadata.filmcraft` {effect: Film's effect instance, align, reverse}.
 *
 * Cut edits exactly the kinds it draws (`timeline/transitions.ts`); any other transition (another of Film's 94, one that is switched off or
 * has settings of its own, another tool's) LOCKS its track, named, and is carried untouched. Pure: no DOM, no editor state.
 */
import { FILM_TRANSITION_EFFECT, TRANSITION_NAME, isSoundKind, kindOfFilmEffect, type TrackTransition, type TransitionKind } from "../timeline/transitions.ts";

type J = Record<string, any>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

/** Cut's clock (ticks per second; `cut-otio.ts` `TICKS`). */
const TICKS = 120_000;

/** What Cut reads of a `Transition.1`: its kind and window in Cut's ticks. */
export interface ReadTransition { kind: TransitionKind; before: number; after: number }

const ticksOf = (t: unknown): number | null => {
	if (!isObj(t) || typeof t.value !== "number" || typeof t.rate !== "number" || !(t.rate > 0) || !Number.isFinite(t.value)) return null;
	const v = (t.value * TICKS) / t.rate;
	const r = Math.round(v);
	return Math.abs(v - r) < 1e-6 ? r : null;
};

const TRANSITION_KEYS = new Set(["OTIO_SCHEMA", "name", "transition_type", "in_offset", "out_offset", "metadata"]);

/** A `Transition.1` on a track of `kind` as Cut edits it, or why Cut cannot (the track is then locked, named, and carried untouched). */
export function readTransition(c: J, audio: boolean): ReadTransition | string {
	const label = `Transition.1 ${typeof c.name === "string" && c.name ? `"${c.name}"` : ""}`.trim();
	const fc = isObj(c.metadata) && isObj(c.metadata.filmcraft) ? c.metadata.filmcraft : null;
	const effect = fc && isObj(fc.effect) ? fc.effect : null;
	if (!effect || typeof effect.effect !== "string") return `it holds a ${label} that is not Film's, which Cut carries untouched and does not edit`;
	const kind = kindOfFilmEffect(effect.effect);
	if (!kind) return `it holds Film's ${label} (${effect.effect}), which Cut carries untouched and does not edit: Cut edits only Film's simple transitions`;
	if (isSoundKind(kind) !== audio) return `it holds Film's ${label} on a track of the other kind, which Cut carries untouched and does not edit`;
	if (effect.enabled === false) return `it holds Film's ${label} switched off, which Cut has no switch for`;
	if (isObj(effect.params) && Object.keys(effect.params).length) return `it holds Film's ${label} with settings of its own, which Cut does not show`;
	if (Object.keys(c).some((k) => !TRANSITION_KEYS.has(k))) return `${label} has fields Cut does not know`;
	const before = ticksOf(c.in_offset), after = ticksOf(c.out_offset);
	if (before === null || after === null) return `${label} has offsets that are not whole ticks of Cut's clock (${TICKS}/s)`;
	return { kind, before, after };
}

/** OTIO time at `rate` when the ticks are whole there, else in Cut's exact ticks. */
const timeAt = (ticks: number, rate: number) => {
	const v = (ticks * rate) / TICKS;
	return Math.abs(v - Math.round(v)) < 1e-9 ? { OTIO_SCHEMA: "RationalTime.1", rate, value: Math.round(v) } : { OTIO_SCHEMA: "RationalTime.1", rate: TICKS, value: ticks };
};

/** Film's align for a window (its own when it still fits: a start-aligned one has nothing before the cut, an end-aligned nothing after). */
function alignOf(x: Pick<TrackTransition, "before" | "after">, was: unknown): string {
	if (x.before === 0) return "StartAtCut";
	if (x.after === 0) return "EndAtCut";
	return was === "CenterAtCut" ? was : "CenterAtCut";
}

/**
 * A transition as its `Transition.1`, in Film's shape. `raw`: the child the file held for it (kept exactly when Cut changed nothing of it;
 * otherwise only what Cut changed is rewritten, every other field of Film's kept). `rate`: the track's own rate.
 */
export function transitionChild(x: TrackTransition, rate: number, raw: J | null): J {
	if (raw) {
		const read = readTransition(raw, isSoundKind(x.kind));
		if (typeof read !== "string" && read.kind === x.kind && read.before === x.before && read.after === x.after) return raw;
	}
	const out: J = raw ? JSON.parse(JSON.stringify(raw)) : {};
	const fc: J = isObj(out.metadata?.filmcraft) ? out.metadata.filmcraft : {};
	const effect = FILM_TRANSITION_EFFECT[x.kind];
	const dissolve = effect === "cross_dissolve" || effect === "constant_power" || effect === "constant_gain";
	const was = raw ? readTransition(raw, isSoundKind(x.kind)) : null;
	const r = raw && isObj(raw.in_offset) && typeof raw.in_offset.rate === "number" ? raw.in_offset.rate : rate;
	return {
		OTIO_SCHEMA: "Transition.1",
		in_offset: was && typeof was !== "string" && was.before === x.before ? out.in_offset : timeAt(x.before, r),
		metadata: {
			...(isObj(out.metadata) ? out.metadata : {}),
			filmcraft: {
				...fc,
				align: alignOf(x, fc.align),
				effect: isObj(fc.effect) ? { ...fc.effect, effect } : { effect, enabled: true, params: {} },
				reverse: typeof fc.reverse === "boolean" ? fc.reverse : false,
			},
		},
		name: TRANSITION_NAME[x.kind],
		out_offset: was && typeof was !== "string" && was.after === x.after ? out.out_offset : timeAt(x.after, r),
		transition_type: dissolve ? "SMPTE_Dissolve" : "Custom_Transition",
	};
}

/**
 * The transitions among a sequence's children (clips, gaps and `Transition.1`s), each between the item before it and the item after it:
 * a clip there is its side (the id `idOf` gives it), a gap or the track's edge none. Or why Cut cannot
 * edit one (named).
 */
export function transitionsAmong(children: J[], audio: boolean, idOf: (clip: J) => string, transitionId: (n: number) => string): Array<{ x: TrackTransition; raw: J }> | string {
	const out: Array<{ x: TrackTransition; raw: J }> = [];
	let prevClip: string | null = null;
	let waiting: TrackTransition[] = [];
	for (const c of children) {
		if (isObj(c) && c.OTIO_SCHEMA === "Transition.1") {
			const read = readTransition(c, audio);
			if (typeof read === "string") return read;
			const x: TrackTransition = { id: transitionId(out.length), kind: read.kind, fromId: prevClip, toId: null, before: read.before, after: read.after };
			out.push({ x, raw: c });
			waiting.push(x);
			continue;
		}
		const isClip = isObj(c) && c.OTIO_SCHEMA === "Clip.2";
		const id = isClip ? idOf(c) : null;
		for (const w of waiting) w.toId = id;
		waiting = [];
		prevClip = id;
	}
	return out;
}
