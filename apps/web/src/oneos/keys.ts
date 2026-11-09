/**
 * Keyframes as both tools hold them (OneOS doctrine files/989, step 2; Mona 2026-11-09: "yes, so this becomes a tool choice not a file type
 * choicer"). Cut animates a value as channels of scalar keys (`animation/types.ts`: a key's time is Cut's ticks from the element's start, its
 * segment to the next is `step`, `linear` or `bezier` with time/value handles `{dt, dv}`, defaulting to a third of the segment). Film animates
 * a parameter as keyframes (filmcraft `project/src/keyframe.rs`: a key's time is Film's ticks from the clip's start; its `interp` and the
 * next key's decide the segment: held, linear, or eased with flat handles whose reach is the key's influence). Both are the same curve when:
 *
 * - Film's segment from key a to key b is HELD when a is `Hold`; else its out side is eased (a flat handle reaching `a.out_influence` of the
 *   segment) when a is Bezier, Auto Bezier, Continuous Bezier or Ease Out, and its in side (reaching `b.in_influence`) when b is Bezier, Auto
 *   Bezier, Continuous Bezier or Ease In, or a is Bezier or Continuous Bezier; a side not eased is a straight third (Cut's default handle).
 * - An eased side may be SLOPED (Mona 2026-11-09: "Add slopes to Film"): Film's key then holds the handle's rise per component
 *   (`out_rise`, `in_rise`, in Film's units; the in side's rise is added to the next key's value, as Cut's left handle's `dv`), and its
 *   reach is 0% to 100% of the segment. A side with no rise is flat, reaching 1% to 100%, as before.
 * - So every Film segment IS a Cut segment (`step`, `linear`, or `bezier` with those handles), and every Cut segment is a Film segment:
 *   each side is a straight third, a flat handle, or a sloped one (Cut clamps a handle's reach to the segment, and so does this bridge).
 *   What Film still cannot hold is components keyed at different times or curving differently (Film keys a value's components together);
 *   `cutToFilm` finds Film's `interp` for each key, preferring what the key was.
 *
 * Pure: no DOM, no storage, no network.
 */

type J = Record<string, any>;

/** Film's clock: ticks per second (filmcraft `time/src/lib.rs`). */
export const FILM_TICKS = 254_016_000_000;
/** Cut's clock: ticks per second. */
export const CUT_TICKS = 120_000;
/** Film ticks in one of Cut's. */
export const PER_CUT_TICK = FILM_TICKS / CUT_TICKS;

export type Interp = "Linear" | "Hold" | "Bezier" | "AutoBezier" | "ContinuousBezier" | "EaseIn" | "EaseOut";
/** One of Film's keyframes, as Film serialises it (`value` is Film's tagged value, e.g. `{Float: 1}`). */
export interface FilmKey { time: number; value: J; interp: Interp; out_influence: number; in_influence: number; out_rise?: number[]; in_rise?: number[] }
export interface Handle { dt: number; dv: number }
/** One of Cut's scalar keys. */
export interface CutKey { id: string; time: number; value: number; segmentToNext: "step" | "linear" | "bezier"; tangentMode: string; leftHandle?: Handle; rightHandle?: Handle }

const OUT_EASED = new Set<Interp>(["Bezier", "AutoBezier", "ContinuousBezier", "EaseOut"]);
const IN_EASED_BY_NEXT = new Set<Interp>(["Bezier", "AutoBezier", "ContinuousBezier", "EaseIn"]);
const IN_EASED_BY_SELF = new Set<Interp>(["Bezier", "ContinuousBezier"]);
const INTERPS: Interp[] = ["Linear", "Hold", "EaseOut", "EaseIn", "AutoBezier", "Bezier", "ContinuousBezier"];
const THIRD = 1 / 3;
const clampInfluence = (x: number) => Math.min(1, Math.max(0.01, x));
/** A sloped handle's reach: 0% to 100% of the segment (Cut clamps a handle's dt to the segment). */
const reach = (x: number) => Math.min(1, Math.max(0, x));
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** A Film time (ticks from the clip's start) in Cut's ticks, or null when it is not a whole one. */
export function cutTime(filmTicks: number): number | null {
	const t = filmTicks / PER_CUT_TICK;
	return Number.isInteger(t) ? t : null;
}

/**
 * Film's keyframes of one value, as one channel of Cut's per component (`parts(v)` gives the components of Film's value `v`, each already in
 * Cut's units; `perCut[c]` is Film's units in one of Cut's for component c, so a handle's rise is read in Cut's units). `prior` are the
 * channels the file held (their keys' ids and tangent modes are kept where a key stays at its time). A reason (a string) when a key's time
 * is not a whole tick of Cut's clock.
 */
export function filmToCut(keys: FilmKey[], parts: (v: J) => number[], prior: Array<CutKey[] | null>, idBase: string, perCut: number[]): CutKey[][] | string {
	const values = keys.map((k) => parts(k.value));
	const n = values[0]?.length ?? 0;
	if (keys.length && perCut.length !== n) return `its ${n} components have ${perCut.length} unit factors`;
	const out: CutKey[][] = Array.from({ length: n }, () => []);
	const times: number[] = [];
	for (const k of keys) {
		const t = cutTime(k.time);
		if (t === null) return `a keyframe at Film tick ${k.time} is not a whole tick of Cut's clock (${CUT_TICKS}/s)`;
		times.push(t);
	}
	for (let c = 0; c < n; c++) {
		const was = prior[c] ?? [];
		for (let i = 0; i < keys.length; i++) {
			const at = was.find((w) => w.time === times[i]);
			out[c].push({ id: at?.id ?? `${idBase}-${c}-${i}`, time: times[i], value: values[i][c], segmentToNext: "linear", tangentMode: at?.tangentMode ?? "flat" });
		}
		for (let i = 0; i + 1 < keys.length; i++) {
			const a = keys[i], b = keys[i + 1];
			const ka = out[c][i], kb = out[c][i + 1];
			if (a.interp === "Hold") { ka.segmentToNext = "step"; continue; }
			const outEased = OUT_EASED.has(a.interp);
			const inEased = IN_EASED_BY_NEXT.has(b.interp) || IN_EASED_BY_SELF.has(a.interp);
			if (!outEased && !inEased) continue;
			const span = kb.time - ka.time;
			ka.segmentToNext = "bezier";
			// A side Film does not ease is Cut's default handle (a straight third), left unset so it follows the keys as they move, as Film's does.
			const k = perCut[c];
			// A handle's reach is a whole number of Cut's ticks (the editor's MediaTime), so Film's fraction of the segment is read to the
			// nearest tick (measured 2026-11-10: a reach of 14946/75000 read back as 14946.000000000002 ticks, which the editor refuses).
			if (outEased) ka.rightHandle = a.out_rise ? { dt: Math.round(reach(a.out_influence) * span), dv: (a.out_rise[c] ?? 0) / k } : { dt: Math.round(clampInfluence(a.out_influence) * span), dv: 0 };
			if (inEased) kb.leftHandle = b.in_rise ? { dt: -Math.round(reach(b.in_influence) * span), dv: (b.in_rise[c] ?? 0) / k } : { dt: -Math.round(clampInfluence(b.in_influence) * span), dv: 0 };
		}
		const last = out[c][keys.length - 1];
		const lastWas = last ? was.find((w) => w.time === last.time) : undefined;
		if (last && lastWas) last.segmentToNext = lastWas.segmentToNext;
	}
	return out;
}

/**
 * One side of a Cut segment as Film can hold it: a straight third (`lin`), a flat handle reaching `flat` of the segment, and always a
 * sloped handle reaching `r` of it with a rise of `dv` per component (in Cut's units).
 */
interface Side { lin: boolean; flat: number | null; r: number; dv: number[] }
type Seg = { step: true } | { step: false; out: Side; in: Side };

function side(h: Handle, span: number, delta: number, sign: 1 | -1): Side {
	const r = reach((sign * h.dt) / span);
	const lin = near(h.dt, sign * span * THIRD) && near(h.dv, sign * delta * THIRD);
	const flat = Math.abs(h.dv) <= 1e-12 && r >= 0.01 - 1e-12 ? Math.min(1, Math.max(0.01, r)) : null;
	return { lin, flat, r, dv: [h.dv] };
}

/** A Cut segment as Film's sides. */
function segment(a: CutKey, b: CutKey): Seg {
	if (a.segmentToNext === "step") return { step: true };
	const span = b.time - a.time, delta = b.value - a.value;
	if (a.segmentToNext === "linear" || span === 0) {
		const flat = delta === 0 ? THIRD : null;
		return { step: false, out: { lin: true, flat, r: THIRD, dv: [delta * THIRD] }, in: { lin: true, flat, r: THIRD, dv: [-delta * THIRD] } };
	}
	const out = side(a.rightHandle ?? { dt: span * THIRD, dv: delta * THIRD }, span, delta, 1);
	const inn = side(b.leftHandle ?? { dt: -span * THIRD, dv: -delta * THIRD }, span, delta, -1);
	return { step: false, out, in: inn };
}

/** Two components' sides as one side of Film's (Film eases a value's components together), or null when they reach differently. */
function both(x: Side, y: Side): Side | null {
	if (!near(x.r, y.r)) return null;
	const lin = x.lin && y.lin;
	const flat = x.flat !== null && y.flat !== null && near(x.flat, y.flat) ? x.flat : null;
	return { lin, flat, r: x.r, dv: [...x.dv, ...y.dv] };
}

/**
 * Cut's channels for one of Film's values (one per component, as `filmToCut` gives them) as Film's keyframes: `value(comps)` makes Film's
 * value from the components (in Film's units), `prior` are Film's keyframes the file held (a key's interp is kept where it still fits),
 * `perCut[c]` Film's units in one of Cut's for component c (a sloped handle's rise is written in Film's units). A reason (a string) when
 * Film cannot hold the curve: components keyed at different times, or curving differently.
 */
export function cutToFilm(channels: CutKey[][], value: (comps: number[]) => J, prior: FilmKey[], perCut: number[]): FilmKey[] | string {
	const first = channels[0] ?? [];
	if (perCut.length !== channels.length) return `its ${channels.length} components have ${perCut.length} unit factors`;
	for (const ch of channels) {
		if (ch.length !== first.length || ch.some((k, i) => k.time !== first[i].time)) return "its components are keyed at different times, where Film keys them together";
	}
	const n = first.length;
	if (!n) return [];
	// Each segment's sides, agreed by every component.
	const segs: Seg[] = [];
	for (let i = 0; i + 1 < n; i++) {
		let s: Seg | null = null;
		for (const ch of channels) {
			const x = segment(ch[i], ch[i + 1]);
			if (!s) { s = x; continue; }
			if (s.step !== x.step) return `its components step and move differently from ${ch[i].time}`;
			if (!s.step && !x.step) {
				const o = both(s.out, x.out), m = both(s.in, x.in);
				if (!o || !m) return `its components curve differently from ${ch[i].time}, where Film eases them together`;
				s = { step: false, out: o, in: m };
			}
		}
		segs.push(s as Seg);
	}
	const fits = (prev: Interp | null, cur: Interp, i: number): boolean => {
		// Key i's own (out) side of segment i.
		if (i < n - 1) {
			const s = segs[i];
			if (s.step !== (cur === "Hold")) return false;
			if (!s.step) {
				// An eased side is flat or sloped, so it always fits; a side not eased must be a straight third.
				if (!OUT_EASED.has(cur) && !s.out.lin) return false;
			}
		}
		// Segment i-1's in side, decided by key i and key i-1.
		if (i > 0 && prev !== null) {
			const s = segs[i - 1];
			if (!s.step) {
				const eased = IN_EASED_BY_NEXT.has(cur) || IN_EASED_BY_SELF.has(prev);
				if (!eased && !s.in.lin) return false;
			}
		}
		return true;
	};
	const priorAt = (t: number) => prior.find((k) => cutTime(k.time) === t);
	// The keys' interps, a key keeping its own where it fits (a small search: seven choices a key).
	const order = (i: number): Interp[] => {
		const was = priorAt(first[i].time)?.interp;
		return was ? [was, ...INTERPS.filter((x) => x !== was)] : INTERPS;
	};
	const choose = (i: number, prev: Interp | null): Interp[] | null => {
		if (i === n) return [];
		for (const cur of order(i)) {
			if (!fits(prev, cur, i)) continue;
			const rest = choose(i + 1, cur);
			if (rest) return [cur, ...rest];
		}
		return null;
	};
	const interps = choose(0, null);
	if (!interps) return "its curve's sides do not pair up as Film's keyframes ease them";
	return first.map((k, i) => {
		const was = priorAt(k.time);
		const s = i < n - 1 ? segs[i] : null;
		const p = i > 0 ? segs[i - 1] : null;
		const outSide = s && !s.step && OUT_EASED.has(interps[i]) ? s.out : null;
		const inEased = p && !p.step && (IN_EASED_BY_NEXT.has(interps[i]) || IN_EASED_BY_SELF.has(interps[i - 1]));
		const inSide = inEased && p && !p.step ? p.in : null;
		const rise = (x: Side) => x.dv.map((d, c) => Math.round(d * perCut[c] * 1e9) / 1e9);
		// Cut reads Film's reach to its whole tick, so a flat side that reads as Film's own key's keeps Film's number exactly.
		const keep = (mine: number, film: number | undefined, sloped: boolean, span: number) =>
			film !== undefined && !sloped && Math.round(clampInfluence(film) * span) === Math.round(mine * span) ? film : mine;
		const spanOut = i < n - 1 ? first[i + 1].time - k.time : 0;
		const spanIn = i > 0 ? k.time - first[i - 1].time : 0;
		const key: FilmKey = {
			time: k.time * PER_CUT_TICK,
			value: value(channels.map((ch) => ch[i].value)),
			interp: interps[i],
			out_influence: outSide ? (outSide.flat !== null ? keep(outSide.flat, was?.out_influence, !!was?.out_rise, spanOut) : outSide.r) : (was?.out_influence ?? THIRD),
			in_influence: inSide ? (inSide.flat !== null ? keep(inSide.flat, was?.in_influence, !!was?.in_rise, spanIn) : inSide.r) : (was?.in_influence ?? THIRD),
		};
		// A side Film eases flat holds no rise; a sloped one holds its rise per component.
		if (outSide && outSide.flat === null) key.out_rise = rise(outSide);
		if (inSide && inSide.flat === null) key.in_rise = rise(inSide);
		return key;
	});
}

/** Two of Cut's channels hold the same curve (ids, tangent modes and handles a segment does not use aside). */
export function sameCurve(a: CutKey[] | null | undefined, b: CutKey[] | null | undefined): boolean {
	const x = a ?? [], y = b ?? [];
	if (x.length !== y.length) return false;
	for (let i = 0; i < x.length; i++) {
		if (x[i].time !== y[i].time || !near(x[i].value, y[i].value)) return false;
		if (i + 1 === x.length) break;
		const sx = segment(x[i], x[i + 1]), sy = segment(y[i], y[i + 1]);
		if (sx.step !== sy.step) return false;
		if (!sx.step && !sy.step && !(sideSame(sx.out, sy.out) && sideSame(sx.in, sy.in))) return false;
	}
	return true;
}

const sideSame = (a: Side, b: Side) => (a.lin && b.lin) || (a.flat !== null && b.flat !== null && near(a.flat, b.flat)) || (near(a.r, b.r) && a.dv.length === b.dv.length && a.dv.every((d, i) => near(d, b.dv[i])));
