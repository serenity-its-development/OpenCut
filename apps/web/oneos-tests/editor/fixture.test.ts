// The maximal fixture is the editor's own data (files/989; measured 2026-11-09: a hand-written fixture had invented an effect, its params,
// masks, keyframes and a transform Cut does not have). Here, where the editor's node_modules are installed: the build type-checks
// against the editor's types, holds every effect, mask and graphic of its registries, and `fixtures/maximal-project.json` IS that build.
// Run: node --test apps/web/oneos-tests/editor/*.test.ts   (CUT_BLESS=1 writes the JSON)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT, EFFECT_TYPES, GRAPHIC_IDS, MASK_TYPES } from "./build-fixture.ts";
import { MAXIMAL_JSON } from "../cut-fixture.ts";

const text = `${JSON.stringify(BUILT, null, "\t")}\n`;

test("the build type-checks against the editor's own types (tsc -p oneos-tests/editor/tsconfig.json)", () => {
	const tsc = join(import.meta.dirname, "..", "..", "..", "..", "node_modules", ".bin", "tsc");
	const r = spawnSync(tsc, ["-p", join(import.meta.dirname, "tsconfig.json")], { encoding: "utf8" });
	assert.equal(r.status, 0, `${r.error ?? ""}${r.stdout}${r.stderr}`);
});

test("fixtures/maximal-project.json IS the editor's build, byte for byte", () => {
	if (process.env.CUT_BLESS) writeFileSync(MAXIMAL_JSON, text);
	assert.ok(readFileSync(MAXIMAL_JSON, "utf8") === text, "the shared fixture is the editor's build (CUT_BLESS=1 writes it)");
});

test("the build holds every effect, mask and graphic of the editor's registries", () => {
	assert.deepEqual(EFFECT_TYPES, ["blur"], "Cut has one effect, blur (effects/definitions)");
	assert.equal(MASK_TYPES.length, 9);
	assert.deepEqual(GRAPHIC_IDS, ["rectangle", "ellipse", "polygon", "star"]);
	const p = JSON.parse(text).project;
	const beach = p.scenes[0].tracks.main.elements[0];
	assert.deepEqual(beach.effects.map((e: { type: string }) => e.type), EFFECT_TYPES);
	assert.deepEqual(beach.masks.map((m: { type: string }) => m.type), MASK_TYPES);
	const gfx = p.scenes[0].tracks.overlay[1].elements;
	assert.deepEqual(gfx.filter((e: { type: string }) => e.type === "graphic").map((e: { definitionId: string }) => e.definitionId), GRAPHIC_IDS);
	assert.ok(Object.keys(beach.animations.bindings).some((k) => k.startsWith("effects.")), "an effect param is keyframed");
	assert.ok(Object.keys(gfx.find((e: { id: string }) => e.id === "g2").animations.bindings).some((k) => k.startsWith("params.")), "a graphic param is keyframed");
});
