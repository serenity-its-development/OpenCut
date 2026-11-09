// files/989 (2026-11-10, "A copy of Film's clip is Film's clip"): the gap that line left, measured here. A Film clip whose look is keyed,
// split, duplicated or pasted in Cut, is written from Film's clip with its keyframes kept at their moment of the medium. The split is the
// EDITOR'S own (`splitAnimationsAtTime`, as `SplitElementsCommand` runs it), so the keys each half holds are the ones a person's split
// makes; the saved file is reopened in Cut and every channel of every copy is drawn, with the editor's own evaluator, at the same moments
// of the medium as the clip it came from. `CUT_BLESS=1` writes `cut-split-keyed.otio`, which filmcraft's host test opens next
// (`a_film_clip_cut_split_keeps_its_keyframes_at_their_moment`).
// Run where the editor's node_modules are installed: node --import ./apps/web/oneos-tests/editor/alias-hooks.mjs --test ...
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
const { splitAnimationsAtTime } = await import("../../src/animation/keyframes.ts");
const { getChannelValueAtTime } = await import("../../src/animation/interpolation.ts");
const { CutSession } = await import("../../src/oneos/cut-session.ts");
const { TICKS } = await import("../../src/oneos/cut-otio.ts");
const { PER_CUT_TICK } = await import("../../src/oneos/keys.ts");
type J = Record<string, any>;

const AT = (TICKS * 3) / 8;
const FIX = join(import.meta.dirname, "..", "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-keyed.otio")));

function load(s: ReturnType<typeof CutSession.open>): J {
	const p = JSON.parse(JSON.stringify(s.project));
	s.baseline(p, s.media);
	return p;
}
const tracksOf = (sc: J): J[] => [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio];
const trackOf = (p: J, name: string): J => {
	for (const t of tracksOf(p.scenes[0])) if (t.elements.some((e: J) => e.name === name)) return t;
	throw new Error(`no track holds ${name}`);
};
const clipsOf = (v: any): J[] => (Array.isArray(v) ? v.flatMap(clipsOf) : v && typeof v === "object" ? [...(v.OTIO_SCHEMA === "Clip.2" ? [v] : []), ...Object.values(v).flatMap(clipsOf)] : []);

/** The editor's split of `e` at `at` ticks into it, as `SplitElementsCommand` makes it (no retime on these elements). */
function split(e: J, at: number): [J, J] {
	const { leftAnimations, rightAnimations } = splitAnimationsAtTime({ animations: e.animations, splitTime: at as never, shouldIncludeSplitBoundary: true });
	const left = { ...e, duration: at, trimEnd: e.trimEnd + (e.duration - at), animations: leftAnimations };
	const right = { ...JSON.parse(JSON.stringify(e)), id: `${e.id}-right`, startTime: e.startTime + at, trimStart: e.trimStart + at, duration: e.duration - at, animations: rightAnimations };
	return [left, right];
}

/**
 * Every channel of `from` drawn at nine moments of the medium `to` covers equals `to`'s own channel there, to `tol` of the channel's range:
 * the copy keeps every key at its moment. No channel holds two keys at one time.
 */
function sameAtTheirMoments(from: J, to: J, what: string, tol: number) {
	const ids = Object.keys(from.animations?.channels ?? {});
	assert.ok(ids.length > 0, `${what}: the clip it came from is keyed`);
	for (const id of ids) {
		const ch = to.animations?.channels?.[id];
		assert.ok(ch, `${what}: channel ${id} is kept`);
		const times = ch.keys.map((k: J) => k.time);
		assert.equal(new Set(times).size, times.length, `${what}: ${id} holds one key at each time (${times})`);
		const values = from.animations.channels[id].keys.map((k: J) => k.value as number);
		const range = Math.max(1, Math.max(...values) - Math.min(...values));
		for (let i = 0; i <= 8; i++) {
			const local = Math.round((to.duration * i) / 8);
			const medium = to.trimStart + local;
			const want = getChannelValueAtTime({ channel: from.animations.channels[id], time: medium - from.trimStart, fallbackValue: 0 }) as number;
			const got = getChannelValueAtTime({ channel: ch, time: local, fallbackValue: 0 }) as number;
			assert.ok(Math.abs(got - want) <= tol * range, `${what}: ${id} at ${medium} ticks of the medium is ${got}, ${want} before`);
		}
	}
}
// The editor keeps a handle's reach in whole ticks of its clock (MediaTime), so its split of a bezier segment rounds the new handles to a
// tick: the halves draw the curve to a few millionths of the channel's range, not exactly. Film keeps what Cut's split made exactly.
const SPLIT_ROUNDING = 1e-5;
const EXACT = 1e-9;

test("a keyed Film clip Cut splits, duplicates and pastes is Film's clip with every key at its moment of the medium (cut-split-keyed.otio)", () => {
	const s = CutSession.open("Keys.otio", film);
	assert.deepEqual(s.locked, []);
	const p = load(s);
	const was: Record<string, J> = {};
	const made: Record<string, [J, J]> = {};
	// The editor's split of the keyed picture and the keyed sound, 0.375 s (nine frames) into each: between keys, inside a bezier segment
	// (scale) and linear ones (position, opacity, blur, the sound's level).
	for (const name of ["Keyed", "Keyed sound"]) {
		const t = trackOf(p, name);
		const i = t.elements.findIndex((e: J) => e.name === name);
		const e = t.elements[i];
		was[name] = JSON.parse(JSON.stringify(e));
		assert.equal(typeof e.filmClip, "string", `${name} opened from Film's clip`);
		const [l, r] = split(e, AT);
		t.elements.splice(i, 1, l, r);
		made[name] = JSON.parse(JSON.stringify([l, r]));
	}
	// A duplicate of the keyed picture (offset 0) on another of Film's tracks, after the original's end, and a paste further on.
	const v = was.Keyed;
	const other = tracksOf(p.scenes[0]).find((t) => t.type === v.type && t.elements.length === 0 && t !== trackOf(p, "Keyed"));
	assert.ok(other, "an empty Film video track to copy onto");
	const end = v.startTime + v.duration;
	other.elements.push({ ...JSON.parse(JSON.stringify(v)), id: "dup", startTime: end });
	other.elements.push({ ...JSON.parse(JSON.stringify(v)), id: "paste", startTime: end + 2 * v.duration });

	const bytes = s.save(p, s.media);
	const out = JSON.parse(new TextDecoder().decode(bytes));
	// Every copy is Film's clip in Film's shape: its keyframes under metadata.filmcraft, none of Cut's channels beside them.
	const keyed = clipsOf(out).filter((c) => c.name === "Keyed" || c.name === "Keyed sound");
	assert.equal(keyed.length, 6, "two halves of each, a duplicate and a paste");
	for (const c of keyed) {
		assert.ok(Array.isArray(c.metadata?.filmcraft?.effects), `${c.name} is Film's clip`);
		assert.equal(c.metadata.opencut?.element?.animations, undefined, `${c.name}: no channels of Cut's beside Film's keys`);
	}
	// Film's right half of the picture: its first Motion key is the split's boundary, at the half's start.
	const rightPic = clipsOf(out).filter((c) => c.name === "Keyed").find((c) => c.source_range.start_time.value === 24 + 9);
	assert.ok(rightPic, "the right half starts nine frames further into the medium");
	const pos = rightPic.metadata.filmcraft.effects.find((e: J) => e.effect === "motion").params.position.keyframes;
	assert.equal(pos[0].time, 0, "the boundary key at the right half's start");
	assert.equal(pos.at(-1).time, (TICKS - AT) * PER_CUT_TICK, "Film's last key (1 s into the clip), moved back by the split's 0.375 s");

	// Reopened in Cut, each copy draws every channel as its clip did at the same moment of the medium.
	const s2 = CutSession.open("Keys.otio", bytes);
	assert.deepEqual(s2.locked, [], "nothing locked");
	const q = load(s2);
	for (const name of ["Keyed", "Keyed sound"]) {
		const t = trackOf(q, name);
		const copies = t.elements.filter((e: J) => e.name === name).sort((a: J, b: J) => a.startTime - b.startTime);
		assert.equal(copies.length, 2);
		for (const [k, side] of ["left", "right"].entries()) {
			sameAtTheirMoments(made[name][k], copies[k], `${name} (${side}) as Cut's split made it`, EXACT);
			sameAtTheirMoments(was[name], copies[k], `${name} (${side}) against the clip it came from`, SPLIT_ROUNDING);
		}
	}
	const copies = tracksOf(q.scenes[0]).flatMap((t) => t.elements).filter((e: J) => e.name === "Keyed" && e.startTime >= end);
	assert.equal(copies.length, 2);
	for (const c of copies) sameAtTheirMoments(v, c, `Keyed (copy at ${c.startTime})`, EXACT);
	assert.deepEqual(s2.save(q, s2.media), bytes, "Cut's reopened save is the very bytes");

	const golden = join(FIX, "cut-split-keyed.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, bytes);
	assert.deepEqual(new Uint8Array(readFileSync(golden)), bytes, "the golden file (CUT_BLESS=1 writes it)");
});
