// files/989 part 2 ("Masks, both ways"; tool choice: each tool edits the other's parts): Cut EDITS the masks on Film's OWN clips, in FILM'S
// shape. `fixtures/film-masked.otio` is byte for byte filmcraft's `crates/interchange/tests/it/oneos/film-masked.otio` (its test
// `oneos_film_writes_its_masks_for_cut` pins Film's writer to it): a clip of a 1920 x 1080 medium whose Opacity holds an ellipse, an
// inverted, half-opaque polygon that subtracts with its feather in the canvas's pixels, an open path that is off and a text. Cut opens them as
// its element's masks (custom paths and a text mask, `src/oneos/film-masks.ts`), saves unedited as the very bytes, and writes an edit back as
// Film's masks, only what Cut changed (`fixtures/cut-masked-film.otio`, the file filmcraft's host test opens in Film next). A mask Cut adds
// is the path Cut's own definition draws: the port is pinned here to the editor's own `buildPath` (`fixtures/mask-paths.json`, written by
// `oneos-tests/editor/mask-paths.test.ts`). `CUT_BLESS=1` writes the golden file. Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession, CutSaveRefusal } from "../src/oneos/cut-session.ts";
import { cutMaskPath } from "../src/oneos/film-masks.ts";
import { sameValue } from "../src/oneos/otio.ts";

type J = Record<string, any>;
const FIX = join(import.meta.dirname, "fixtures");

test("Cut's mask paths, as Film's, are the paths the editor's own buildPath draws (every case of mask-paths.json)", () => {
	const { cases } = JSON.parse(readFileSync(join(FIX, "mask-paths.json"), "utf8")) as { cases: J[] };
	let n = 0;
	for (const c of cases) {
		const path = cutMaskPath({ type: c.type, params: c.params }, c.width, c.height);
		if (c.type === "text") { assert.equal(typeof path, "string", "a text mask has no path"); continue; }
		assert.notEqual(typeof path, "string", `${c.type}: ${path}`);
		const got = (path as J).vertices as J[];
		assert.equal(got.length, c.vertices.length, `${c.type}: as many vertices`);
		got.forEach((v, i) => {
			const w = c.vertices[i];
			for (const [k, a] of [["p", v.p], ["t_in", v.t_in], ["t_out", v.t_out]] as const) {
				assert.ok(Math.abs(a.x - w[k][0]) < 1e-6 && Math.abs(a.y - w[k][1]) < 1e-6, `${c.type} vertex ${i} ${k}: ${a.x},${a.y} vs ${w[k]}`);
			}
		});
		n++;
	}
	assert.ok(n >= 30, `every path case measured (${n})`);
});

const film = () => new Uint8Array(readFileSync(join(FIX, "film-masked.otio")));
const raw = (b: Uint8Array = film()): J => JSON.parse(new TextDecoder().decode(b));
const bytesOf = (doc: J) => new TextEncoder().encode(JSON.stringify(doc));
function load(s: CutSession) {
	const p = JSON.parse(JSON.stringify(s.project));
	s.baseline(p, s.media);
	return p;
}
const element = (p: J, name: string): J => {
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) if (e.name === name) return e;
	throw new Error(`no element ${name}`);
};
const clipOf = (doc: J, name: string): J => {
	for (const tl of doc.OTIO_SCHEMA === "Timeline.1" ? [doc] : doc.children.filter((c: J) => c.OTIO_SCHEMA === "Timeline.1")) {
		for (const t of tl.tracks.children) for (const c of t.children) if (c.name === name) return c;
	}
	throw new Error(`no clip ${name}`);
};
const opacityOf = (c: J): J => c.metadata.filmcraft.effects.find((e: J) => e.effect === "opacity");

test("Cut opens the masks on Film's own clip as its element's masks, and an unedited save is the very bytes", () => {
	const s = CutSession.open("Masks.otio", film());
	assert.deepEqual(s.locked, []);
	const p = load(s);
	const m = element(p, "Masked").masks as J[];
	assert.deepEqual(m.map((x) => [x.id, x.type, x.name, x.track, x.params.mode, x.params.units ?? "canvas"]), [
		["film-mask-0", "custom", "Oval", "position-scale-rotation", "add", "clip"],
		["film-mask-1", "custom", "Cut out", "position", "subtract", "canvas"],
		["film-mask-2", "custom", "Line", "position-scale-rotation", "none", "clip"],
		["film-mask-3", "text", "Title", "position-scale-rotation", "add", "clip"],
	]);
	// Film's ellipse about the frame's centre, 480 x 300 pixels of radius: its top vertex half the height up, its tangent Film's circle tangent.
	assert.deepEqual([m[0].params.path[0].x, m[0].params.path[0].y, m[0].params.closed, m[0].params.feather], [0, -0.277777778, true, 10]);
	assert.equal(m[0].params.path[0].outX, 0.138071187);
	assert.deepEqual([m[1].params.inverted, m[1].params.opacity, m[1].params.expansion, m[1].params.feather, m[1].params.path.length], [true, 0.5, 8, 20, 3]);
	assert.equal(m[2].params.closed, false, "an open path that is off stays open (Cut draws it as Film does: not at all)");
	assert.deepEqual([m[3].params.content, m[3].params.fontSize, m[3].params.fontWeight, m[3].params.centerX, m[3].params.centerY], ["FILM", 30, "bold", 0.1, -0.2]);
	assert.deepEqual(s.save(p, s.media), film(), "unedited, the very bytes");
});

test("Cut's edits of Film's masks are written back as Film's masks, only what Cut changed (cut-masked-film.otio)", () => {
	const s = CutSession.open("Masks.otio", film());
	const p = load(s);
	const v = element(p, "Masked");
	v.masks[0].params.feather = 30;
	v.masks[3].params.content = "CUT";
	v.masks.splice(2, 1);
	v.masks.push({ id: "cut-rect", type: "rectangle", params: { feather: 6, inverted: false, strokeColor: "#ffffff", strokeWidth: 0, strokeAlign: "center", centerX: 0.25, centerY: 0, width: 0.25, height: 0.5, rotation: 0, scale: 1 } });
	const out = s.save(p, s.media);
	const golden = join(FIX, "cut-masked-film.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(existsSync(golden), "the golden Cut-masked file (CUT_BLESS=1 writes it)");
	const saved = JSON.parse(new TextDecoder().decode(out));
	assert.ok(sameValue(saved, JSON.parse(readFileSync(golden, "utf8"))), "Cut writes the edit as it is pinned");
	const want = raw();
	const wm = opacityOf(clipOf(want, "Masked")).masks;
	wm[0].feather.value.Float = 30;
	wm[3].text.content = "CUT";
	wm.splice(2, 1);
	wm.push({
		name: "Rectangle", feather: { value: { Float: 6 } }, opacity: { value: { Float: 100 } }, expansion: { value: { Float: 0 } }, inverted: false, mode: "Add",
		track_method: "PositionScaleRotation", units: "Canvas",
		path: { value: { Path: { vertices: [{ p: { x: 1200, y: 270 } }, { p: { x: 1680, y: 270 } }, { p: { x: 1680, y: 810 } }, { p: { x: 1200, y: 810 } }], closed: true } } },
	});
	clipOf(want, "Masked").metadata.opencut = { element: {} };
	assert.ok(sameValue(saved, want), "Film's file with only Cut's edits in Film's shape");
	// Cut reopens its own save as it left it.
	s.committed(out, p, s.media);
	const again = CutSession.open("Masks.otio", out);
	assert.deepEqual(again.locked, []);
	const back = element(load(again), "Masked").masks as J[];
	assert.deepEqual(back.map((x) => [x.type, x.name, x.params.units ?? "canvas"]), [["custom", "Oval", "clip"], ["custom", "Cut out", "canvas"], ["text", "Title", "clip"], ["custom", "Rectangle", "canvas"]]);
	assert.deepEqual(back[3].params.path.map((q: J) => [q.x, q.y]), [[0.125, -0.25], [0.375, -0.25], [0.375, 0.25], [0.125, 0.25]], "the rectangle Cut drew, as Film's path and back");
	// A second save on the committed file keeps mask for mask: a change of the rectangle's opacity alone.
	element(p, "Masked").masks[3].params.opacity = 0.5;
	const second = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const sm = opacityOf(clipOf(second, "Masked")).masks;
	assert.deepEqual(sm.slice(0, 3), opacityOf(clipOf(saved, "Masked")).masks.slice(0, 3), "the masks Cut did not touch, exactly");
	assert.deepEqual([sm[3].opacity, sm[3].path], [{ value: { Float: 50 } }, opacityOf(clipOf(saved, "Masked")).masks[3].path]);
});

test("Cut's masks on Film's clip are never written as Cut's own beside Film's", () => {
	const s = CutSession.open("Masks.otio", film());
	const p = load(s);
	element(p, "Masked").masks[0].params.inverted = true;
	const saved = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const c = clipOf(saved, "Masked");
	assert.equal(c.metadata.opencut?.element?.masks, undefined);
	assert.equal(opacityOf(c).masks[0].inverted, true);
});

test("What Film's masks have no place for is refused by name at save, nothing written: a stroke", () => {
	const s = CutSession.open("Masks.otio", film());
	const p = load(s);
	element(p, "Masked").masks[1].params.strokeWidth = 4;
	assert.throws(() => s.save(p, s.media), (e: unknown) => e instanceof CutSaveRefusal && e.code === "mask-not-in-film" && /no stroke/.test(e.message));
});

test("What Cut's masks have no place for locks the track, named: a keyed mask, a mask on an effect, a medium of unknown size", () => {
	const lockOf = (edit: (c: J) => void): string => {
		const doc = raw();
		edit(clipOf(doc, "Masked"));
		const s = CutSession.open("Masks.otio", bytesOf(doc));
		assert.equal(s.locked.length, 1);
		return s.locked[0].reason;
	};
	assert.match(lockOf((c) => { opacityOf(c).masks[0].feather.keyframes = [{ time: 0, value: { Float: 1 }, interp: "Linear", out_influence: 1 / 3, in_influence: 1 / 3 }, { time: 254016000000, value: { Float: 9 }, interp: "Linear", out_influence: 1 / 3, in_influence: 1 / 3 }]; }), /^mask-keyframes-not-in-cut: Film animates the feather of the mask "Oval"/);
	assert.match(lockOf((c) => { c.metadata.filmcraft.effects.push({ effect: "gaussian_blur", enabled: true, params: { blurriness: { value: { Float: 5 } } }, masks: [opacityOf(c).masks[0]] }); }), /^effect-mask-not-in-cut: Film masks its gaussian_blur/);
	assert.match(lockOf((c) => { delete c.media_references.DEFAULT_MEDIA.metadata.filmcraft.info.video; }), /^mask-size-unknown/);
});

test("Film's text laid in a box of its own opens on the element's box, and Cut's move writes the box with the text's place", () => {
	const doc = raw();
	const t = opacityOf(clipOf(doc, "Masked")).masks[3].text;
	t.frame = [0, 0, 960, 540];
	t.center = { x: 0, y: 0 };
	const s = CutSession.open("Masks.otio", bytesOf(doc));
	const p = load(s);
	const title = element(p, "Masked").masks[3];
	assert.deepEqual([title.params.centerX, title.params.centerY, title.params.fontSize], [-0.25, -0.25, 15], "the box's centre and its font's clip pixels kept");
	title.params.content = "MOVED";
	let saved = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	assert.deepEqual(opacityOf(clipOf(saved, "Masked")).masks[3].text, { ...t, content: "MOVED" }, "the text alone changed: Film's box kept");
	title.params.centerX = 0;
	saved = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const moved = opacityOf(clipOf(saved, "Masked")).masks[3].text;
	assert.deepEqual([moved.frame, moved.center, moved.size, moved.content], [[0, 0, 1920, 1080], { x: 0, y: -0.25 }, 15, "MOVED"]);
});
