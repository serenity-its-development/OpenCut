// Cut draws EVERY mask of an element, combined as Film combines its masks (OneOS doctrine files/989, "Masks, both ways"; measured
// 2026-11-09: the compositor's frame descriptor drew `masks[0]` alone, so an element's other masks were saved but never drawn). On the
// editor-built fixture, with the editor's own mask registry: which masks are drawn and how each is planned (`masks/draw-plan.ts`), and how
// their coverages combine (`masks/combine.ts`, Film's `MaskMode`, filmcraft `project/src/mask.rs`).
// Run: node --import ./apps/web/oneos-tests/editor/alias-hooks.mjs --test apps/web/oneos-tests/editor/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILT } from "./build-fixture.ts";

const { drawnMasks, planMask, expandedSplit } = await import("../../src/masks/draw-plan.ts");
const { combineMode, startOf, combineCoverages, isPlainMask, MASK_MODES } = await import("../../src/masks/combine.ts");
const { masksRegistry } = await import("../../src/masks/index.ts");

type J = Record<string, any>;
const beach: J = (BUILT as J).project.scenes[0].tracks.main.elements[0];

test("every mask of the editor-built element is drawn, in order (an open custom path, which the editor calls inactive, is not)", () => {
	assert.deepEqual(
		drawnMasks(beach.masks).map((m: J) => m.type),
		["split", "cinematic-bars", "rectangle", "ellipse", "heart", "diamond", "star", "text"],
	);
	const off = beach.masks.map((m: J) => ({ ...m, params: { ...m.params, mode: "none" } }));
	assert.deepEqual(drawnMasks(off), [], "a mask whose mode is none is kept, not drawn");
});

test("a mask saved before modes, opacity and expansion draws as Cut drew its one mask (plain, planned by the old rule)", () => {
	for (const m of beach.masks as J[]) {
		assert.ok(isPlainMask(m.params), `${m.type} is plain`);
		const d = masksRegistry.get(m.type);
		const direct = Boolean(d.renderer.renderMask) && (!d.renderer.buildPath || (m.params.feather > 0 && Boolean(d.renderer.renderMaskHandlesFeather)));
		const feather = direct && d.renderer.renderMaskHandlesFeather ? 0 : m.params.feather;
		assert.deepEqual(planMask(m as never), { direct, feather }, m.type);
		const feathered = { ...m, params: { ...m.params, feather: 12 } };
		const fd = Boolean(d.renderer.renderMask) && (!d.renderer.buildPath || Boolean(d.renderer.renderMaskHandlesFeather));
		assert.deepEqual(planMask(feathered as never), { direct: fd, feather: fd && d.renderer.renderMaskHandlesFeather ? 0 : 12 }, `${m.type} feathered`);
	}
});

test("an expanded mask with a path is drawn as its path (stroked to grow or shrink it), and a split grows by moving its line", () => {
	const split = beach.masks.find((m: J) => m.type === "split");
	const featheredSplit = { ...split, params: { ...split.params, feather: 10 } };
	assert.deepEqual(planMask(featheredSplit), { direct: true, feather: 0 }, "a split feathers itself");
	assert.deepEqual(planMask({ ...featheredSplit, params: { ...featheredSplit.params, expansion: 8 } }), { direct: true, feather: 0 }, "its expansion moves the line");
	const rotated = { ...split.params, rotation: 90, expansion: 54 };
	const moved = expandedSplit(rotated, 1920, 1080);
	assert.ok(Math.abs(moved.centerX - split.params.centerX) < 1e-12);
	assert.ok(Math.abs(moved.centerY - (split.params.centerY - 54 / 1080)) < 1e-12, "the kept side (along the normal) grows by 54 px");
	const text = beach.masks.find((m: J) => m.type === "text");
	assert.deepEqual(planMask({ ...text, params: { ...text.params, expansion: 3, feather: 4 } }), { direct: true, feather: 4 }, "a text mask is drawn by its renderer, its outline stroked");
});

test("masks combine as Film's MaskMode::combine and start (filmcraft project/src/mask.rs)", () => {
	assert.deepEqual([...MASK_MODES], ["none", "add", "subtract", "intersect", "lighten", "darken", "difference"]);
	const [a, m] = [0.25, 0.5];
	assert.deepEqual(
		MASK_MODES.map((mode) => combineMode(mode, a, m)),
		[a, a + m - a * m, a * (1 - m), a * m, Math.max(a, m), Math.min(a, m), a + m - 2 * a * m],
	);
	assert.deepEqual(MASK_MODES.map(startOf), [0, 0, 1, 1, 0, 1, 0]);
});

test("coverages combine top to bottom: opacity and inversion first, the first mask from its mode's start, none skipped", () => {
	const box = [1, 1, 0, 0];
	const right = [0, 1, 1, 0];
	const near = (x: Float32Array | null, y: number[]) => assert.ok(x && x.length === y.length && [...x].every((v, i) => Math.abs(v - y[i]) < 1e-6), `${x} is ${y}`);
	near(combineCoverages([{ coverage: box, mode: "add", opacity: 1, inverted: false }, { coverage: right, mode: "add", opacity: 1, inverted: false }], 4), [1, 1, 1, 0]);
	near(combineCoverages([{ coverage: box, mode: "add", opacity: 1, inverted: false }, { coverage: right, mode: "subtract", opacity: 1, inverted: false }], 4), [1, 0, 0, 0]);
	near(combineCoverages([{ coverage: box, mode: "subtract", opacity: 1, inverted: false }], 4), [0, 0, 1, 1]);
	near(combineCoverages([{ coverage: box, mode: "add", opacity: 0.5, inverted: true }], 4), [0, 0, 0.5, 0.5]);
	near(combineCoverages([{ coverage: right, mode: "none", opacity: 1, inverted: false }, { coverage: box, mode: "intersect", opacity: 1, inverted: false }], 4), [1, 1, 0, 0]);
	assert.equal(combineCoverages([{ coverage: box, mode: "none", opacity: 1, inverted: false }], 4), null, "no mask drawn: not masked");
});

test("a mask measured in clip pixels (Film's) is feathered at the element's own pixels, so it is not the compositor's plain mask", () => {
	const rect = beach.masks.find((m: J) => m.type === "rectangle");
	assert.ok(isPlainMask({ ...rect.params, units: "clip" }), "unfeathered, where it is measured does not matter");
	assert.ok(!isPlainMask({ ...rect.params, units: "clip", feather: 6 }), "feathered in clip pixels: drawn and feathered before the element's scale");
	assert.ok(isPlainMask({ ...rect.params, units: "canvas", feather: 6 }), "feathered in the canvas's pixels: the compositor feathers it");
});
