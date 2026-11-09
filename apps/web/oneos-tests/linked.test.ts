// files/989 (Mona 2026-11-10, relayed: "Build linked audio, lock multicam"): Cut learns Film's link of a clip's picture and sound. Elements
// sharing a `link` are partners (`timeline/linked.ts`): selecting one selects them all (so a move, a trim or a delete takes them together),
// a split or a duplicate pairs the copies under a link of their own. Film's linked pair (`metadata.filmcraft.link`) opens in Cut as two linked
// elements, Film's picture playing no sound of its own; a save writes the link as Film's own number, and a label Cut made as a new number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { relinker, withLinked } from "../src/timeline/linked.ts";
import { CutSaveRefusal, CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-written.otio")));

const tracks = (main: object[], audio: object[]) => ({ main: { id: "v", elements: main }, overlay: [], audio: [{ id: "a", elements: audio }] }) as never;

test("selecting an element selects its linked partners, on any track, and nothing else", () => {
	const t = tracks([{ id: "pic", link: "L" }, { id: "other" }], [{ id: "snd", link: "L" }, { id: "solo", link: "M" }]);
	assert.deepEqual(withLinked({ tracks: t, refs: [{ trackId: "a", elementId: "snd" }] }), [{ trackId: "a", elementId: "snd" }, { trackId: "v", elementId: "pic" }]);
	assert.deepEqual(withLinked({ tracks: t, refs: [{ trackId: "v", elementId: "other" }] }), [{ trackId: "v", elementId: "other" }]);
	assert.deepEqual(withLinked({ tracks: t, refs: [{ trackId: "v", elementId: "pic" }, { trackId: "a", elementId: "snd" }] }).length, 2, "each once");
});

test("copies of partners (a split's right halves, a duplicate, a paste) share ONE new link, their own", () => {
	let n = 0;
	const relink = relinker(() => `new-${++n}`);
	const [a, b, c, d] = [{ id: "pic", link: "L" }, { id: "snd", link: "L" }, { id: "x", link: "M" }, { id: "y" }].map(relink);
	assert.deepEqual([a.link, b.link, c.link, d.link], ["new-1", "new-1", "new-2", undefined]);
});

/** What the browser loader does to a fresh project: the editor's defaults on each element. */
function load(s: CutSession) {
	const p = JSON.parse(JSON.stringify(s.project));
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type === "audio") e.volume ??= 0;
		else Object.assign(e, { transform: e.transform ?? { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: e.opacity ?? 1 });
	}
	s.baseline(p, s.media);
	return p;
}
const clipsOf = (v: any): any[] => (Array.isArray(v) ? v.flatMap(clipsOf) : v && typeof v === "object" ? [...(v.OTIO_SCHEMA === "Clip.2" ? [v] : []), ...Object.values(v).flatMap(clipsOf)] : []);

test("Film's linked picture and sound open in Cut as two linked elements, the picture silent, and move together as Film's own link", () => {
	const s = CutSession.open("Trip.otio", film);
	const p = load(s);
	const edit = p.scenes[0];
	const pic = edit.tracks.main.elements[0];
	const snd = edit.tracks.audio[0].elements[0];
	assert.deepEqual([pic.type, pic.link, pic.isSourceAudioEnabled, snd.type, snd.link], ["video", "13", false, "audio", "13"]);
	assert.equal(edit.tracks.main.elements[1].link, undefined, "an unlinked clip has no link");
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
	// Selecting the sound selects the picture: the move is applied to both.
	const sel = withLinked({ tracks: edit.tracks, refs: [{ trackId: edit.tracks.audio[0].id, elementId: snd.id }] });
	assert.deepEqual(sel.map((r) => r.elementId).sort(), [pic.id, snd.id].sort());
	for (const e of [pic, snd]) e.trimStart += TICKS / 10;
	const out = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const linked = clipsOf(out.children[0]).filter((c) => c.metadata?.filmcraft?.link === 13);
	assert.equal(linked.length, 2, "both stay Film's linked pair");
	for (const c of linked) {
		assert.equal(c.metadata.opencut?.element?.link, undefined, "no second link of Cut's beside Film's");
		assert.equal(c.metadata.opencut?.element?.isSourceAudioEnabled, undefined, "the picture's silence is Film's shape, not a switch of Cut's");
	}
});

test("a link Cut makes between Film's clips is written as a new Film number, and a picture's own sound is refused by name", () => {
	const s = CutSession.open("Trip.otio", film);
	const p = load(s);
	const edit = p.scenes[0];
	const other = edit.tracks.main.elements[1];
	const solo = p.scenes[1].tracks.main.elements[0];
	other.link = "cut-made";
	solo.link = "cut-made";
	other.duration -= TICKS / 10;
	const out = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const numbers = clipsOf(out).map((c) => c.metadata?.filmcraft?.link).filter((l) => typeof l === "number");
	assert.deepEqual(numbers.sort((a, b) => a - b), [13, 13, 14, 14], "Cut's label is numbered above Film's");
	const q = load(CutSession.open("Trip.otio", film));
	q.scenes[0].tracks.main.elements[1].isSourceAudioEnabled = true;
	const s2 = CutSession.open("Trip.otio", film);
	s2.baseline(load(s2), s2.media);
	assert.throws(() => s2.save(q, s2.media), (e: unknown) => e instanceof CutSaveRefusal && e.code === "sound-not-in-film");
});

// files/989 (measured 2026-11-10): Cut wrote the right half of a Film clip it split as a new element of Cut's (no metadata.filmcraft), so
// Film read it as a bare clip, its look, gain, label and link lost. A copy of Film's clip (a split's right half, a duplicate, a paste) is
// Film's clip: written from it in Film's shape, its keyframes kept at their moment of the medium, its link a new number of Film's shared by
// the copies. `CUT_BLESS=1` writes `cut-split-film.otio`, which filmcraft's host test opens (`a_film_clip_cut_split_keeps_film_s_look_and_link`).
test("a Film clip Cut splits stays Film's on both halves: Film's look, gain and label, the halves' link a new Film number", () => {
	const s = CutSession.open("Trip.otio", film);
	const p = load(s);
	const edit = p.scenes[0];
	let n = 0;
	const relink = relinker(() => `split-${++n}`);
	const halves: Array<[any, any]> = [];
	for (const t of [edit.tracks.main, edit.tracks.audio[0]]) {
		const e = t.elements[0];
		const half = TICKS;
		const r = relink({ ...JSON.parse(JSON.stringify(e)), id: `${e.id}-right`, startTime: e.startTime + half, trimStart: e.trimStart + half, duration: e.duration - half });
		e.duration = half;
		t.elements.splice(1, 0, r);
		halves.push([e, r]);
	}
	const bytes = s.save(p, s.media);
	const out = JSON.parse(new TextDecoder().decode(bytes));
	const before = JSON.parse(new TextDecoder().decode(film));
	const was = clipsOf(before.children[0]).filter((c) => c.metadata?.filmcraft?.link === 13);
	const linked = (l: number) => clipsOf(out.children[0]).filter((c) => c.metadata?.filmcraft?.link === l);
	assert.equal(linked(13).length, 2, "the left halves stay Film's pair");
	const right = linked(14);
	assert.equal(right.length, 2, "the right halves are Film's clips, linked under a new number of Film's");
	for (const [i, c] of right.entries()) {
		const w = was[i].metadata.filmcraft;
		const fc = c.metadata.filmcraft;
		for (const k of ["gain_db", "label", "custom_label_color", "group", "scale_to_frame"]) assert.deepEqual(fc[k], w[k], `Film's ${k} is kept`);
		const unkeyed = (fx: any[]) => JSON.stringify(fx.map((e: any) => ({ ...e, params: Object.fromEntries(Object.entries(e.params).map(([k, v]: any) => [k, { ...v, keyframes: (v.keyframes ?? []).length }])) })));
		assert.equal(unkeyed(fc.effects), unkeyed(w.effects), "Film's look is kept");
		assert.deepEqual(Object.keys(c.metadata.opencut?.element ?? {}).filter((k) => !["trimEnd", "sourceDuration", "muted", "hidden"].includes(k)), [], "nothing of Film's look written as Cut's");
	}
	const golden = join(FIX, "cut-split-film.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, bytes);
	assert.deepEqual(new Uint8Array(readFileSync(golden)), bytes, "the golden file (CUT_BLESS=1 writes it)");
});
