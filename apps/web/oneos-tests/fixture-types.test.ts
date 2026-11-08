// The maximal fixture is the editor's own data (files/989; measured 2026-11-09: a hand-written fixture had invented an effect, its params,
// masks and keyframes Cut does not have). It is built by the editor's builders and registries and typed against the editor's types; this
// test runs the type check, so a field the editor does not have fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { EFFECT_TYPES, GRAPHIC_IDS, MASK_TYPES, maximal } from "./cut-fixture.ts";

test("the fixture type-checks against the editor's own types (tsc -p oneos-tests/tsconfig.json)", () => {
	const tsc = join(import.meta.dirname, "..", "..", "..", "node_modules", ".bin", "tsc");
	const r = spawnSync(tsc, ["-p", join(import.meta.dirname, "tsconfig.json")], { encoding: "utf8" });
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("the fixture holds every effect, mask and graphic the editor's registries hold", () => {
	assert.deepEqual(EFFECT_TYPES, ["blur"], "Cut has one effect, blur (measured from effects/definitions)");
	const beach = maximal().project.scenes[0].tracks.main.elements[0];
	assert.deepEqual(beach.effects.map((e: { type: string }) => e.type), EFFECT_TYPES);
	assert.deepEqual(beach.masks.map((m: { type: string }) => m.type), MASK_TYPES);
	assert.equal(MASK_TYPES.length, 9);
	const gfx = maximal().project.scenes[0].tracks.overlay[1].elements;
	assert.deepEqual(gfx.filter((e: { type: string }) => e.type === "graphic").map((e: { definitionId: string }) => e.definitionId), GRAPHIC_IDS);
	assert.ok(Object.keys(beach.animations.bindings).some((p) => p.startsWith("effects.")), "an effect param is keyframed");
});
