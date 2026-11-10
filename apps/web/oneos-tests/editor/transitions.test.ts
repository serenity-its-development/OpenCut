// files/989 (Mona 2026-11-10: "Simple ones only"): the editor draws and plays Film's simple transitions with its own code. Its scene puts a
// dip's colour beneath the track's pictures for the window and each picture in a transition into its handles at Film's weights; its sound
// in a crossfade is lengthened into its handles as Film's `with_handles` lengthens it, at Film's gains, its own volume keys kept at their
// moment. Run: node --import ./apps/web/oneos-tests/editor/alias-hooks.mjs --test ...
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
const { buildScene } = await import("../../src/services/renderer/scene-builder.ts");
const { ColorNode } = await import("../../src/services/renderer/nodes/color-node.ts");
const { VideoNode } = await import("../../src/services/renderer/nodes/video-node.ts");
const { withTransitionFade, audioTransitionShares } = await import("../../src/media/audio.ts");
const T = 120_000;

const video = (id: string, startTime: number, more: object = {}) => ({
	id, type: "video", name: id, mediaId: "m", startTime, duration: 2 * T, trimStart: T, trimEnd: T, sourceDuration: 4 * T,
	transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: 1, ...more,
});

test("a dip: the editor's scene draws the colour beneath the track's pictures for the window, and each picture into its handle at Film's weight", () => {
	const main = { id: "v", name: "V1", type: "video", muted: false, hidden: false, elements: [video("a", 0), video("b", 2 * T)], transitions: [{ id: "x", kind: "dip-to-black", fromId: "a", toId: "b", before: T / 2, after: T / 2 }] };
	const media = [{ id: "m", type: "video", name: "m", file: {} as File, url: "blob:m" }];
	const root = buildScene({ canvasSize: { width: 1920, height: 1080 }, tracks: { main, overlay: [], audio: [] } as never, mediaAssets: media as never, duration: 4 * T, background: { type: "color", color: "transparent" } as never });
	const kids = root.children;
	assert.deepEqual(kids.map((n) => n.constructor.name), ["ColorNode", "VideoNode", "VideoNode"], "the colour first (beneath), then A, then B over A");
	assert.ok(kids[0] instanceof ColorNode);
	assert.deepEqual((kids[0] as InstanceType<typeof ColorNode>).params, { color: "#000000", window: { start: 1.5 * T, end: 2.5 * T } });
	const [a, b] = [kids[1], kids[2]] as Array<InstanceType<typeof VideoNode>>;
	assert.deepEqual([a.params.share?.head, a.params.share?.tail, b.params.share?.head, b.params.share?.tail], [0, T / 2, T / 2, 0]);
	assert.equal(a.params.share?.at(1.75 * T), 0.5, "A at a quarter: 1 - 2p");
	assert.equal(b.params.share?.at(2.25 * T), 0.5, "B at three quarters: 2p - 1");
	assert.equal(a.params.share?.at(2.1 * T), null, "A is not drawn in the second half");
});

test("a sound in a crossfade plays into its handles at Film's gains; its volume keys stay at their moment", () => {
	const el = (id: string, startTime: number) => ({ id, type: "audio", sourceType: "upload", name: id, mediaId: "m", startTime, duration: 2 * T, trimStart: T, trimEnd: T / 4, volume: 0 });
	const audio = { id: "a1", name: "A1", type: "audio", muted: false, elements: [el("s1", 0), el("s2", 2 * T)], transitions: [{ id: "x", kind: "constant-power", fromId: "s1", toId: "s2", before: T / 2, after: T / 2 }] };
	const shares = audioTransitionShares({ tracks: { main: { elements: [] }, overlay: [], audio: [audio] } as never });
	const sec = (e: { startTime: number; duration: number; trimStart: number; trimEnd: number }) => ({ startTime: e.startTime / T, duration: e.duration / T, trimStart: e.trimStart / T, trimEnd: e.trimEnd / T });
	const s1 = withTransitionFade(sec(audio.elements[0]), audio.elements[0] as never, shares);
	assert.deepEqual([s1.startTime, s1.duration, s1.trimStart, s1.trimEnd], [0, 2.25, 1, 0], "its tail is the medium there is (a quarter second), silent past it as in Film");
	const s2 = withTransitionFade(sec(audio.elements[1]), audio.elements[1] as never, shares);
	assert.deepEqual([s2.startTime, s2.duration, s2.trimStart], [1.5, 2.5, 0.5], "its head: half a second of the medium before its trim");
	assert.equal(s2.fade?.offset, 0.5, "its own volume keys are read half a second later");
	for (const p of [0, 0.25, 0.5, 0.75]) {
		assert.ok(Math.abs((s2.fade?.gainAt(p) ?? -1) - Math.sin((p * Math.PI) / 2)) < 1e-12, `in at ${p}`);
		assert.ok(Math.abs((s1.fade?.gainAt(1.5 + p) ?? -1) - Math.cos((p * Math.PI) / 2)) < 1e-12, `out at ${p}`);
	}
	assert.equal(s2.fade?.gainAt(1.5), 1, "after the window, its own gain");
});
