// files/989 step 2 (Mona 2026-11-09: "yes, so this becomes a tool choice not a file type choicer"): Cut EDITS Film's look and keyframes in
// FILM'S OWN SHAPE. `fixtures/film-keyed.otio` is byte for byte filmcraft's `crates/interchange/tests/it/oneos/film-keyed.otio` (its test
// `oneos_film_writes_its_keyframes_for_cut` pins Film's writer to it): a video clip whose Motion position, scale, Opacity and a Gaussian
// Blur are keyframed, and an audio clip whose Volume level is. Cut opens them as its element's transform, opacity, blur and channels, saves
// unedited as the very bytes, and writes an edit back as Film's values and keyframes (`fixtures/cut-keyed.otio`, the file filmcraft's host
// test opens in Film next). `CUT_BLESS=1` writes that golden file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { sameValue } from "../src/oneos/otio.ts";
import { PER_CUT_TICK } from "../src/oneos/keys.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-keyed.otio")));
const raw = () => JSON.parse(new TextDecoder().decode(film));
type J = Record<string, any>;

function load(s: CutSession) {
	const p = JSON.parse(JSON.stringify(s.project));
	s.baseline(p, s.media);
	return p;
}
const element = (p: J, name: string): J => {
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) if (e.name === name) return e;
	throw new Error(`no element ${name}`);
};
const channel = (e: J, path: string): J[] => e.animations.channels[e.animations.bindings[path].components[0].channelId].keys;
const clipOf = (doc: J, name: string): J => {
	for (const t of doc.children[0].tracks.children) for (const c of t.children) if (c.name === name) return c;
	throw new Error(`no clip ${name}`);
};
const fxOf = (c: J, effect: string) => c.metadata.filmcraft.effects.find((e: J) => e.effect === effect);

test("Cut opens Film's look and keyframes as its element's own: transform, opacity, blur and their channels; the volume over the clip's gain", () => {
	const s = CutSession.open("Keys.otio", film);
	assert.deepEqual(s.locked, []);
	const p = load(s);
	const v = element(p, "Keyed");
	assert.deepEqual(v.transform, { scaleX: 1, scaleY: 1, position: { x: 100, y: 0 }, rotate: 15 });
	assert.equal(v.opacity, 1);
	assert.deepEqual(v.effects, [{ id: "film-fx-0", type: "blur", params: { intensity: 25 }, enabled: true }]);
	assert.deepEqual(channel(v, "transform.positionX").map((k: J) => [k.time, k.value, k.segmentToNext]), [[0, 100, "linear"], [60000, 40, "bezier"], [120000, 0, "linear"]]);
	assert.deepEqual(channel(v, "transform.positionX")[1].rightHandle, { dt: 30000, dv: 0 }, "Film's Ease Out: a flat handle reaching half the segment");
	assert.deepEqual(channel(v, "transform.positionY").map((k: J) => k.value), [0, -40, 0]);
	assert.deepEqual(channel(v, "transform.scaleX").map((k: J) => [k.value, k.segmentToNext, k.rightHandle ?? null, k.leftHandle ?? null]), [[1, "bezier", { dt: 30000, dv: 0 }, null], [1.5, "linear", null, { dt: -90000, dv: 0 }]]);
	assert.deepEqual(channel(v, "opacity").map((k: J) => [k.time, k.value, k.segmentToNext]), [[0, 0, "step"], [30000, 0.5, "linear"], [90000, 1, "linear"]]);
	assert.deepEqual(channel(v, "effects.film-fx-0.params.intensity").map((k: J) => k.value), [0, 50]);
	const a = element(p, "Keyed sound");
	assert.equal(a.volume, -3, "Cut's volume is Film's gain");
	assert.deepEqual(channel(a, "volume").map((k: J) => [k.time, k.value]), [[0, -3], [120000, -9]], "Film's level over the gain");
	assert.deepEqual(s.save(p, s.media), film, "unedited, the very bytes");
});

test("Cut's edits of Film's keyframes are written back as Film's keyframes, and nothing else of Film's changes (cut-keyed.otio)", () => {
	const s = CutSession.open("Keys.otio", film);
	const p = load(s);
	const v = element(p, "Keyed");
	channel(v, "transform.positionX")[1].value = 60;
	channel(v, "opacity")[2].value = 0.8;
	channel(v, "effects.film-fx-0.params.intensity").push({ id: "k-new", time: 60000, value: 10, segmentToNext: "step", tangentMode: "flat" });
	channel(v, "effects.film-fx-0.params.intensity").sort((x: J, y: J) => x.time - y.time);
	v.transform.rotate = 20;
	const a = element(p, "Keyed sound");
	a.volume = -1;
	const out = s.save(p, s.media);
	const golden = join(FIX, "cut-keyed.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(existsSync(golden), "the golden Cut-keyed file (CUT_BLESS=1 writes it)");
	const saved = JSON.parse(new TextDecoder().decode(out));
	assert.ok(sameValue(saved, JSON.parse(readFileSync(golden, "utf8"))), "Cut writes the edit as it is pinned");
	const want = raw();
	const wc = clipOf(want, "Keyed");
	fxOf(wc, "motion").params.position.keyframes[1].value.Vec2.x = 1020;
	fxOf(wc, "motion").params.rotation.value.Float = 20;
	fxOf(wc, "opacity").params.opacity.keyframes[2].value.Float = 80;
	const blur = fxOf(wc, "gaussian_blur").params.blurriness.keyframes;
	blur.splice(1, 0, { time: 60000 * PER_CUT_TICK, value: { Float: 4 }, interp: "Hold", out_influence: 1 / 3, in_influence: 1 / 3 });
	blur[0].interp = "Linear";
	const ws = clipOf(want, "Keyed sound");
	ws.metadata.filmcraft.gain_db = -1;
	fxOf(ws, "volume").params.level.keyframes[0].value.Float = -2;
	fxOf(ws, "volume").params.level.keyframes[1].value.Float = -8;
	assert.ok(sameValue(clipOf(saved, "Keyed").metadata.filmcraft, wc.metadata.filmcraft), JSON.stringify(clipOf(saved, "Keyed").metadata.filmcraft.effects).slice(0, 4000));
	assert.ok(sameValue(clipOf(saved, "Keyed sound").metadata.filmcraft, ws.metadata.filmcraft), JSON.stringify(clipOf(saved, "Keyed sound").metadata.filmcraft));
	assert.deepEqual(clipOf(saved, "Keyed").metadata.opencut, { element: {} }, "no second copy of Film's look as Cut's");
	const again = load(CutSession.open("Keys.otio", out));
	assert.equal(channel(element(again, "Keyed"), "transform.positionX")[1].value, 60, "Cut reopens its edit");
	assert.deepEqual(channel(element(again, "Keyed sound"), "volume").map((k: J) => k.value), [-3, -9], "the sound Cut set stays as the gain moves");
});

test("a curve Film's keyframes cannot hold is refused by name at save, and nothing is written", () => {
	const s = CutSession.open("Keys.otio", film);
	const p = load(s);
	const k = channel(element(p, "Keyed"), "opacity");
	k[1].segmentToNext = "bezier";
	k[1].rightHandle = { dt: 10000, dv: 0.2 };
	assert.throws(() => s.save(p, s.media), (e: Error & { code?: string }) => e.code === "keyframes-not-in-film" && /opacity/.test(e.message) && /Keyed/.test(e.message));
});

// files/989 step 2 (Mona: "film should be able to edit cut though"): Film's edit of CUT's keyframes (filmcraft
// `host_open::film_edits_cut_s_keyframes_and_writes_them_as_cut_s_channels`: Beach's second opacity key to 50%, its rotation to 30, saved
// as Cut's channel and field) is pinned as `fixtures/film-keyed-cut.otio`. It opens in Cut's PROJECT mode, Film's edit read as Cut's own.
test("Film's edit of Cut's keyframes (film-keyed-cut.otio) opens in Cut's project mode, read as Cut's channel and field", () => {
	const bytes = new Uint8Array(readFileSync(join(FIX, "film-keyed-cut.otio")));
	const s = CutSession.open("trip.otio", bytes);
	assert.equal(s.mode, "cut");
	const p = load(s);
	const beach = p.scenes[0].tracks.main.elements.find((e: J) => e.name === "Beach");
	assert.deepEqual(channel(beach, "opacity").map((k: J) => [k.time, k.value, k.id]), [[0, 0, "id-011"], [120000, 0.5, "id-012"]]);
	assert.equal(beach.transform.rotate, 30);
	assert.deepEqual(s.save(p, s.media), bytes, "unedited, the very bytes");
});
