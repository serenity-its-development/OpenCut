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

// Mona 2026-11-09 (files/989): "Film eases linear too". The frames each tool draws between colour keys are the same: filmcraft's
// `host_open::film_and_cut_draw_every_colour_alike_between_keys` keys the title's colour (Cut's own, linear light) and its background (a
// colour Film keys anew, Cut's `srgb` channel), pins the file as `fixtures/film-coloured-cut.otio` and the frames Film draws as
// `fixtures/colour-frames.json`. Cut opens that file and draws every one of those frames with its own code; each matches to the 8 bits
// a frame holds.
test("every colour frame Film draws between keys is the frame Cut draws (film-coloured-cut.otio, colour-frames.json)", async () => {
	const { readFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { CutSession } = await import("../../src/oneos/cut-session.ts");
	const FIX = join(import.meta.dirname, "..", "fixtures");
	const s = CutSession.open("trip.otio", new Uint8Array(readFileSync(join(FIX, "film-coloured-cut.otio"))));
	assert.equal(s.mode, "cut");
	const t = (s.project as J).scenes[0].tracks.overlay[0].elements.find((e: J) => e.id === "t1");
	const frames: Array<{ time: number; color: number[]; "background.color": number[] }> = JSON.parse(readFileSync(join(FIX, "colour-frames.json"), "utf8"));
	assert.equal(frames.length, 11);
	assert.equal(t.animations.bindings.color.colorSpace, "srgb-linear");
	assert.equal(t.animations.bindings["background.color"].colorSpace, "srgb");
	const byte = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
	for (const f of frames) {
		for (const path of ["color", "background.color"] as const) {
			const cut = byte(resolveColorAtTime({ baseColor: path === "color" ? t.color : t.background.color, animations: t.animations, propertyPath: path, localTime: f.time }));
			const film = f[path].slice(0, 3).map((x) => Math.round(x * 255));
			assert.ok(cut.every((c, i) => Math.abs(c - film[i]) <= 1), `${path} at ${f.time}: Cut ${cut}, Film ${film}`);
		}
	}
	// Between the keys the two easings differ visibly, so the match above measures something: halfway, linear light is not sRGB.
	const srgbMid = frames[0].color.slice(0, 3).map((a, i) => Math.round(((a + frames[10].color[i]) / 2) * 255));
	const mid = frames[5].color.slice(0, 3).map((x) => Math.round(x * 255));
	assert.ok(mid.some((c, i) => Math.abs(c - srgbMid[i]) > 8), `the title's frame halfway (${mid}) is linear light's, not sRGB's (${srgbMid})`);
});
