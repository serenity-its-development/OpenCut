/**
 * Film's look on its own clip, edited in Cut and written back in FILM'S shape (OneOS doctrine files/989, step 2; Mona 2026-11-09: "yes, so
 * this becomes a tool choice not a file type choicer"). Film keeps a clip's look as effect instances under `metadata.filmcraft.effects`
 * (filmcraft `project/src/effect.rs`): Motion (position in the sequence's pixels, scale and scale width in percent, uniform scale, rotation
 * in degrees), Opacity (percent), Gaussian Blur (blurriness) and an audio clip's Volume (level, dB over the clip's gain), each parameter a
 * value and, when animated, keyframes (`keys.ts`). Cut opens them as its element's own fields and channels:
 *
 * | Film | Cut |
 * |---|---|
 * | Motion position (x, y) | `transform.position` (from the frame's centre), channels `transform.positionX`, `transform.positionY` |
 * | Motion scale, scale width, uniform scale (percent) | `transform.scaleX`, `transform.scaleY` (and their channels) |
 * | Motion rotation | `transform.rotate` |
 * | Opacity opacity (percent) | `opacity` (0..1) |
 * | each Gaussian Blur (blurriness) | a blur effect (`intensity`, the blur Film's cut map uses) and its `effects.<id>.params.intensity` channel |
 * | an audio clip's Volume level keyframes (dB over its gain) | the `volume` channel (dB) |
 *
 * A save writes back ONLY what Cut changed (the element now against the element as it opened), in Film's shape: a value as Film's value,
 * a channel as Film's keyframes. What Film's keyframes cannot hold is refused by name, nothing written (`keyframes-not-in-film`). Every
 * other effect, parameter and field of Film's on the clip is carried untouched. Pure: no DOM, no storage, no network.
 */
import { type CutKey, type FilmKey, cutToFilm, filmToCut, sameCurve } from "./keys.ts";

type J = Record<string, any>;

/** The frame Film's clip is placed on (its sequence's width and height). */
export interface Frame { w: number; h: number }

/** Cut's blur `intensity` as Film's Gaussian Blur `blurriness` (filmcraft `otio/cut.rs` `blur_k`). */
export const blurK = (f: Frame) => (0.4 * f.w) / 1920;

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const json = (v: unknown) => JSON.stringify(v);
const round9 = (x: number) => Math.round(x * 1e9) / 1e9;

/** Film's effects on a clip, or null when the clip is not Film's. */
export function filmEffects(clip: J): J[] | null {
	const e = clip?.metadata?.filmcraft?.effects;
	return Array.isArray(e) ? e : null;
}

const fx = (effects: J[], name: string): J | undefined => effects.find((e) => isObj(e) && e.effect === name);
const blurs = (effects: J[]): J[] => effects.filter((e) => isObj(e) && e.effect === "gaussian_blur");
const num = (p: J | undefined, d: number): number => (typeof p?.value?.Float === "number" ? p.value.Float : d);
const keysOf = (p: J | undefined): FilmKey[] => (Array.isArray(p?.keyframes) ? p.keyframes : []);
const auto = (x: unknown) => (typeof x === "number" ? x : Number.NaN);

/** One of Film's parameters as Cut holds it: its Cut channel paths, its components in Cut's units, and back. */
interface Mapping {
	effect: J;
	param: string;
	paths: string[];
	parts: (v: J) => number[];
	value: (c: number[]) => J;
	/** Film's units in one of Cut's, per component (a sloped handle's rise is converted by it). */
	perCut: number[];
}

function mappings(effects: J[], kind: string, f: Frame, gain: number, ids: string[]): Mapping[] | string {
	const out: Mapping[] = [];
	if (kind === "audio") {
		const vol = fx(effects, "volume");
		if (vol) out.push({ effect: vol, param: "level", paths: ["volume"], parts: (v) => [round9(gain + (v.Float ?? 0))], value: (c) => ({ Float: round9(c[0] - gain) }), perCut: [1] });
		return out;
	}
	const motion = fx(effects, "motion");
	if (motion) {
		out.push({
			effect: motion, param: "position", paths: ["transform.positionX", "transform.positionY"],
			parts: (v) => { const x = auto(v.Vec2?.x), y = auto(v.Vec2?.y); return [Number.isNaN(x) ? 0 : round9(x - f.w / 2), Number.isNaN(y) ? 0 : round9(y - f.h / 2)]; },
			value: (c) => ({ Vec2: { x: c[0] + f.w / 2, y: c[1] + f.h / 2 } }),
			perCut: [1, 1],
		});
		out.push({ effect: motion, param: "rotation", paths: ["transform.rotate"], parts: (v) => [v.Float], value: (c) => ({ Float: c[0] }), perCut: [1] });
	}
	const op = fx(effects, "opacity");
	if (op) out.push({ effect: op, param: "opacity", paths: ["opacity"], parts: (v) => [round9(v.Float / 100)], value: (c) => ({ Float: round9(c[0] * 100) }), perCut: [100] });
	blurs(effects).forEach((b, i) => {
		out.push({ effect: b, param: "blurriness", paths: [`effects.${ids[i]}.params.intensity`], parts: (v) => [round9(v.Float / blurK(f))], value: (c) => ({ Float: round9(c[0] * blurK(f)) }), perCut: [blurK(f)] });
	});
	return out;
}

/** The scale of Film's Motion: uniform scales both axes by `scale`; else `scale_width` is X and `scale` is Y (percent). */
function scaleOf(motion: J): { uniform: boolean; x: J; y: J } {
	const uniform = motion.params?.uniform_scale?.value?.Bool !== false;
	return { uniform, x: uniform ? motion.params.scale : motion.params.scale_width, y: motion.params.scale };
}

const channelOf = (anim: J | undefined, path: string): CutKey[] | null => {
	const b = anim?.bindings?.[path];
	const id = b?.components?.[0]?.channelId;
	const ch = id ? anim?.channels?.[id] : undefined;
	return ch && ch.kind === "scalar" && Array.isArray(ch.keys) && ch.keys.length ? ch.keys : null;
};

function putChannel(anim: J, path: string, keys: CutKey[] | null): void {
	const was = anim.bindings?.[path]?.components?.[0]?.channelId;
	if (!keys || !keys.length) {
		if (anim.bindings) delete anim.bindings[path];
		if (was && anim.channels) delete anim.channels[was];
		return;
	}
	const id = was ?? `${path}:value`;
	anim.bindings = { ...(anim.bindings ?? {}), [path]: { path, kind: "number", components: [{ key: "value", channelId: id }] } };
	anim.channels = { ...(anim.channels ?? {}), [id]: { kind: "scalar", keys } };
}

/**
 * Film's look on its clip as Cut's element fields (merged over the element by the caller), or why Cut cannot show it without damage (the
 * track is then locked, named). `kind` is the element's (`video`, `image`, `audio`); `gain` the clip's gain (dB), Cut's static volume.
 */
export function filmLook(clip: J, kind: string, f: Frame, gain: number): J | string {
	const effects = filmEffects(clip);
	if (!effects) return {};
	const look: J = {};
	const anim: J = { bindings: {}, channels: {} };
	const ids = blurs(effects).map((_, i) => `film-fx-${i}`);
	const maps = mappings(effects, kind, f, gain, ids);
	if (typeof maps === "string") return maps;
	const name = typeof clip.name === "string" ? clip.name : "";
	for (const m of maps) {
		const p = m.effect.params?.[m.param];
		if (!p) continue;
		const keys = keysOf(p);
		if (!keys.length) continue;
		const chans = filmToCut(keys, m.parts, m.paths.map(() => null), `film-${m.param}`, m.perCut);
		if (typeof chans === "string") return `Film's ${m.effect.effect} ${m.param} on "${name}": ${chans}`;
		m.paths.forEach((path, i) => putChannel(anim, path, chans[i]));
	}
	if (kind !== "audio") {
		const motion = fx(effects, "motion");
		if (motion) {
			const pos = motion.params?.position?.value?.Vec2 ?? {};
			const [x, y] = [auto(pos.x), auto(pos.y)];
			const s = scaleOf(motion);
			look.transform = {
				scaleX: round9(num(s.x, 100) / 100), scaleY: round9(num(s.y, 100) / 100),
				position: { x: Number.isNaN(x) ? 0 : round9(x - f.w / 2), y: Number.isNaN(y) ? 0 : round9(y - f.h / 2) },
				rotate: num(motion.params?.rotation, 0),
			};
			const xk = keysOf(s.x), yk = keysOf(s.y);
			const parts = (v: J) => [round9(v.Float / 100)];
			if (xk.length) {
				const c = filmToCut(xk, parts, [null], "film-scale-x", [100]);
				if (typeof c === "string") return `Film's Motion scale on "${name}": ${c}`;
				putChannel(anim, "transform.scaleX", c[0]);
			}
			if (yk.length) {
				const c = filmToCut(yk, parts, [null], "film-scale-y", [100]);
				if (typeof c === "string") return `Film's Motion scale on "${name}": ${c}`;
				putChannel(anim, "transform.scaleY", c[0]);
			}
		}
		const op = fx(effects, "opacity");
		if (op) look.opacity = round9(num(op.params?.opacity, 100) / 100);
		look.effects = blurs(effects).map((b, i) => ({ id: ids[i], type: "blur", params: { intensity: round9(num(b.params?.blurriness, 0) / blurK(f)) }, enabled: b.enabled !== false }));
	}
	if (Object.keys(anim.bindings).length) look.animations = anim;
	return look;
}

/** The fields of Cut's element that are Film's on Film's clip (written back by `writeFilmLook`, never as Cut's own beside them). */
export const FILM_OWNED = (kind: string) => (kind === "audio" ? ["animations"] : ["transform", "opacity", "effects", "animations"]);

/**
 * Film's effects on its clip with Cut's edits written in, in Film's shape: `was` is the element as it opened (or was last saved), `now` as
 * the person left it. Only a value or channel that changed is rewritten; the rest of Film's effects come back exactly. A string is why
 * Film cannot hold an edit (the save is refused by name, `keyframes-not-in-film`).
 */
export function writeFilmLook(clip: J, kind: string, f: Frame, gain: number, was: J, now: J): J[] | string {
	const effects = clone(filmEffects(clip) ?? []);
	const name = typeof now.name === "string" ? now.name : "";
	// Cut's blur effects, matched to Film's Gaussian Blurs by order; one Cut added is Film's new Gaussian Blur, one Cut removed is removed.
	if (kind !== "audio" && json(was.effects ?? []) !== json(now.effects ?? [])) {
		const mine = blurs(effects);
		const nowFx: J[] = (now.effects ?? []).filter((e: J) => e.type === "blur");
		const kept: J[] = [];
		nowFx.forEach((e, i) => {
			const b = mine[i] ? mine[i] : { effect: "gaussian_blur", enabled: true, params: { blurriness: { value: { Float: 0 } }, blur_dimensions: { value: { Choice: 0 } }, repeat_edge_pixels: { value: { Bool: false } } } };
			b.enabled = e.enabled !== false;
			b.params.blurriness = { ...b.params.blurriness, value: { Float: round9(e.params.intensity * blurK(f)) } };
			kept.push(b);
		});
		const others = effects.filter((e) => !(isObj(e) && e.effect === "gaussian_blur"));
		effects.length = 0;
		effects.push(...others, ...kept);
	}
	const ids = (now.effects ?? []).filter((e: J) => e.type === "blur").map((e: J) => e.id as string);
	const wasIds = (was.effects ?? []).filter((e: J) => e.type === "blur").map((e: J) => e.id as string);
	const maps = mappings(effects, kind, f, gain, ids);
	if (typeof maps === "string") return maps;
	// A channel Cut keeps on Film's clip that Film has no parameter for is refused, never dropped.
	const held = new Set([...maps.flatMap((m) => m.paths), ...(kind === "audio" ? [] : ["transform.scaleX", "transform.scaleY"])]);
	for (const path of Object.keys(now.animations?.bindings ?? {})) {
		if (!held.has(path) && channelOf(now.animations, path)) return `keyframes-not-in-film: Cut animates the ${path} of "${name}", which Film's ${kind} clip has no keyframes for`;
	}
	for (const m of maps) {
		const wasPaths = m.paths.map((p) => p.replace(/^effects\.([^.]+)\./, (_, id) => `effects.${wasIds[ids.indexOf(id)] ?? id}.`));
		const before = wasPaths.map((p) => channelOf(was.animations, p));
		const after = m.paths.map((p) => channelOf(now.animations, p));
		if (before.every((b, i) => sameCurve(b, after[i]))) continue;
		const p = m.effect.params[m.param] ?? { value: m.value(m.paths.map(() => 0)) };
		const statics = m.param === "position" ? [now.transform?.position?.x ?? 0, now.transform?.position?.y ?? 0] : m.parts(p.value);
		const keyed = keysFor(after, m, p, statics, name);
		if (typeof keyed === "string") return keyed;
		m.effect.params[m.param] = keyed.length ? { ...p, keyframes: keyed } : { value: p.value };
	}
	if (kind !== "audio") {
		const motion = fx(effects, "motion");
		const wt = was.transform ?? {}, nt = now.transform ?? {};
		if (motion) {
			if (json(wt.position) !== json(nt.position)) {
				const x = nt.position?.x ?? 0, y = nt.position?.y ?? 0;
				// The frame's centre is Film's automatic position.
				motion.params.position = { ...motion.params.position, value: { Vec2: x === 0 && y === 0 ? { x: null, y: null } : { x: x + f.w / 2, y: y + f.h / 2 } } };
			}
			if (wt.rotate !== nt.rotate) motion.params.rotation = { ...motion.params.rotation, value: { Float: nt.rotate ?? 0 } };
			const sx = channelOf(now.animations, "transform.scaleX"), sy = channelOf(now.animations, "transform.scaleY");
			const scaleChanged = wt.scaleX !== nt.scaleX || wt.scaleY !== nt.scaleY || !sameCurve(channelOf(was.animations, "transform.scaleX"), sx) || !sameCurve(channelOf(was.animations, "transform.scaleY"), sy);
			if (scaleChanged) {
				const s = scaleOf(motion);
				const uniform = nt.scaleX === nt.scaleY && sameCurve(sx, sy);
				const toFilm = (ch: CutKey[] | null, prior: J | undefined, axis: string): J[] | string => {
					if (!ch) return [];
					const k = cutToFilm([ch], (c) => ({ Float: round9(c[0] * 100) }), keysOf(prior), [100]);
					return typeof k === "string" ? `keyframes-not-in-film: Cut's ${axis} scale on "${name}" ${k}` : k;
				};
				const yk = toFilm(sy, s.y, "vertical");
				if (typeof yk === "string") return yk;
				motion.params.scale = withKeys({ ...motion.params.scale, value: { Float: round9((nt.scaleY ?? 1) * 100) } }, yk);
				if (uniform) {
					motion.params.uniform_scale = { ...motion.params.uniform_scale, value: { Bool: true } };
				} else {
					const xk = toFilm(sx, s.uniform ? motion.params.scale_width : s.x, "horizontal");
					if (typeof xk === "string") return xk;
					motion.params.scale_width = withKeys({ ...motion.params.scale_width, value: { Float: round9((nt.scaleX ?? 1) * 100) } }, xk);
					motion.params.uniform_scale = { ...motion.params.uniform_scale, value: { Bool: false } };
				}
			}
		}
		const op = fx(effects, "opacity");
		if (op && was.opacity !== now.opacity) op.params.opacity = { ...op.params.opacity, value: { Float: round9((now.opacity ?? 1) * 100) } };
	}
	return effects;
}

const withKeys = (p: J, keys: J[]): J => {
	const { keyframes: _k, ...rest } = p;
	return keys.length ? { ...rest, keyframes: keys } : rest;
};

/** Cut's channels for a mapping as Film's keyframes; a component Cut does not animate is held at its value through the other's keys. */
function keysFor(after: Array<CutKey[] | null>, m: Mapping, p: J, statics: number[], name: string): J[] | string {
	const lead = after.find((c) => c);
	if (!lead) return [];
	const chans = after.map((c, i) => c ?? lead.map((k) => ({ ...k, value: statics[i], ...(k.rightHandle ? { rightHandle: { dt: k.rightHandle.dt, dv: 0 } } : {}), ...(k.leftHandle ? { leftHandle: { dt: k.leftHandle.dt, dv: 0 } } : {}) })));
	const k = cutToFilm(chans, m.value, keysOf(p), m.perCut);
	return typeof k === "string" ? `keyframes-not-in-film: Cut's ${m.paths.join(" and ")} on "${name}" ${k}` : k;
}
