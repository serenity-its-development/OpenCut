// Mona 2026-11-09 (files/989): "Build text animation in Cut" and "Add sRGB channel to Cut". The editor's OWN code draws them: a text's
// size and tracking ease, its font, content, alignment, weight, style and decoration are held from key to key (as Film's text layer keys
// them), and a colour channel in sRGB eases its sRGB components (as Film eases a colour), where Cut's own channels ease in linear light.
// Run where the editor's node_modules are installed: node --test apps/web/oneos-tests/editor/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { BUILT } from "./build-fixture.ts";

register("./alias-hooks.mjs", import.meta.url);
const { resolveTextAtTime } = await import("../../src/text/measure-element.ts");
const { resolveColorAtTime } = await import("../../src/animation/values.ts");
type J = Record<string, any>;

const title = (): J => (BUILT.project.scenes[0].tracks.overlay[0].elements as J[]).find((e) => e.id === "t1") as J;

test("the editor-built title's typography is drawn as its channels key it: size eased over a sloped handle, the rest held", () => {
	const t = title();
	const at = (sec: number) => resolveTextAtTime({ element: t as never, localTime: sec * 120_000 });
	const start = at(0), mid = at(0.5), end = at(1);
	// Before a held channel's first key the text is its own (Cut's discrete channels); Film's mapping keys that at the clip's start.
	assert.deepEqual([start.fontSize, start.content, start.textDecoration, start.fontFamily, start.textAlign], [64, "Hello 日本語", "underline", "Inter", "center"], "before a held channel's first key, the element's own");
	assert.deepEqual([end.fontSize, end.content, end.textDecoration, end.fontFamily, end.textAlign, end.fontWeight, end.fontStyle], [96, "Goodbye", "line-through", "Roboto", "left", "normal", "normal"]);
	assert.deepEqual([mid.content, mid.textDecoration], ["Hello 日本語", "underline"], "held until the next key");
	// The size's segment leaves on a handle reaching a quarter of it and rising 12: the curve the editor solves, not a straight line.
	assert.ok(mid.fontSize > 80 + 1, `the sloped handle lifts the middle (${mid.fontSize})`);
	assert.equal(at(0.5).letterSpacing, 4);
});

const ramp = (colorSpace: "srgb" | "srgb-linear", lo: number, hi: number): J => {
	const ch = (v0: number, v1: number) => ({ kind: "scalar", keys: [{ id: "a", time: 0, value: v0, segmentToNext: "linear", tangentMode: "flat" }, { id: "b", time: 120_000, value: v1, segmentToNext: "linear", tangentMode: "flat" }] });
	return {
		bindings: { color: { path: "color", kind: "color", colorSpace, components: ["r", "g", "b", "a"].map((key) => ({ key, channelId: `color:${key}` })) } },
		channels: { "color:r": ch(lo, hi), "color:g": ch(lo, hi), "color:b": ch(lo, hi), "color:a": ch(1, 1) },
	};
};

test("a colour channel in sRGB eases its sRGB components, as Film does; Cut's own linear-light channel eases in linear light", () => {
	const half = (animations: J) => resolveColorAtTime({ baseColor: "#000000", animations: animations as never, propertyPath: "color", localTime: 60_000 });
	assert.equal(half(ramp("srgb", 0, 1)), "#808080", "black to white, halfway in sRGB");
	assert.equal(half(ramp("srgb-linear", 0, 1)), "#bcbcbc", "black to white, halfway in linear light");
	assert.equal(resolveColorAtTime({ baseColor: "#000000", animations: ramp("srgb", 0, 1) as never, propertyPath: "color", localTime: 120_000 }), "#ffffff");
});
