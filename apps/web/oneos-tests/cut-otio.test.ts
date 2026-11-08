// The proof (files/989): a MAXIMAL Cut project -> .otio -> back, value for value, and what cannot be SAVED is refused by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CutOtioRefusal, TICKS, cutToOtio, otioToCut } from "../src/oneos/cut-otio.ts";

const F1 = "01jabcdefghjkmnpqrstvwxyz0", F2 = "01jabcdefghjkmnpqrstvwxyz1", F3 = "01jabcdefghjkmnpqrstvwxyz2";
const s = (sec: number) => Math.round(sec * TICKS);
const transform = { position: { x: 12, y: -4 }, scale: 1.25, rotate: 7.5, flipX: false };
const animations = { opacity: { keyframes: [{ time: 0, value: 0, easing: "ease-in" }, { time: s(1), value: 1 }] } };
const effects = [{ id: "fx1", type: "blur", enabled: true, params: { radius: 4 } }, { id: "fx2", type: "colorCorrect", enabled: false, params: { saturation: 0.8 } }];
const masks = [{ id: "mk1", type: "custom", inverted: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }];

export function maximal() {
	const scene = (id: string, isMain: boolean) => ({
		id, name: isMain ? "Main" : "B-roll", isMain, createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T01:00:00.000Z",
		bookmarks: [{ time: s(2), note: "Cut here", color: "#ff0000", duration: s(1) }, { time: s(9) }],
		tracks: {
			main: { id: `${id}-main`, name: "Main", type: "video", muted: false, hidden: false, elements: [
				{ id: "v1", type: "video", name: "Beach", mediaId: "m-video", startTime: 0, duration: s(5), trimStart: s(1), trimEnd: s(2), sourceDuration: s(8), volume: 0.7, muted: false, isSourceAudioEnabled: true, hidden: false, retime: { rate: 1.5, maintainPitch: true }, transform, opacity: 0.9, blendMode: "screen", effects, masks, animations },
				{ id: "i1", type: "image", name: "Logo", mediaId: "m-image", startTime: s(7), duration: s(3), trimStart: 0, trimEnd: 0, transform, opacity: 1, effects: [], masks: [] },
			] },
			overlay: [
				{ id: `${id}-text`, name: "Titles", type: "text", hidden: false, elements: [
					{ id: "t1", type: "text", name: "Title", content: "Hello 日本語", fontSize: 64, fontFamily: "Inter", color: "#ffffff", background: { enabled: true, color: "#00000080", cornerRadius: 8, paddingX: 4, paddingY: 2, offsetX: 0, offsetY: 0 }, textAlign: "center", fontWeight: "bold", fontStyle: "italic", textDecoration: "underline", letterSpacing: 1, lineHeight: 1.2, hidden: false, transform, opacity: 1, startTime: s(1), duration: s(2), trimStart: 0, trimEnd: 0, animations },
				] },
				{ id: `${id}-gfx`, name: "Graphics", type: "graphic", hidden: true, elements: [
					{ id: "g1", type: "sticker", name: "Star", stickerId: "emoji:star", transform, opacity: 0.5, startTime: 0, duration: s(1), trimStart: 0, trimEnd: 0 },
					{ id: "g2", type: "graphic", name: "Lower third", definitionId: "lower-third", params: { title: "Ana" }, transform, opacity: 1, startTime: s(4), duration: s(2), trimStart: 0, trimEnd: 0 },
				] },
				{ id: `${id}-fx`, name: "Adjust", type: "effect", hidden: false, elements: [
					{ id: "e1", type: "effect", name: "Grade", effectType: "colorCorrect", params: { contrast: 1.1 }, startTime: 0, duration: s(10), trimStart: 0, trimEnd: 0 },
				] },
			],
			audio: [{ id: `${id}-a1`, name: "Music", type: "audio", muted: true, elements: [
				{ id: "a1", type: "audio", sourceType: "upload", name: "Song", mediaId: "m-audio", volume: 0.4, muted: false, retime: { rate: 0.9 }, startTime: s(0.5), duration: s(9), trimStart: s(3), trimEnd: 0, sourceDuration: s(180) },
			] }],
		},
	});
	return {
		project: {
			metadata: { id: "p1", name: "Trip", thumbnail: "data:image/png;base64,AAAA", duration: s(10), createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T02:00:00.000Z" },
			scenes: [scene("s1", true), scene("s2", false)],
			currentSceneId: "s2",
			settings: { fps: { numerator: 30000, denominator: 1001 }, canvasSize: { width: 1080, height: 1920 }, canvasSizeMode: "custom", lastCustomCanvasSize: { width: 1080, height: 1920 }, originalCanvasSize: null, background: { type: "blur", blurIntensity: 12 } },
			version: 23,
			timelineViewState: { zoomLevel: 2.5, scrollLeft: 340, playheadTime: s(3) },
		},
		media: [
			{ id: "m-video", name: "beach.mp4", type: "video", file: { id: F1, version: "v3" }, width: 1920, height: 1080, duration: 8, fps: 30, hasAudio: true },
			{ id: "m-image", name: "logo.png", type: "image", file: { id: F2, version: "v1" }, width: 512, height: 512 },
			{ id: "m-audio", name: "song.wav", type: "audio", file: { id: F3, version: "v9" }, duration: 180 },
		],
	};
}

test("a maximal Cut project (every track and element type, effects, masks, keyframes, retime, text style, bookmarks, scenes, settings, view state, media) survives .otio value for value", () => {
	const cut = maximal();
	const otio = cutToOtio(cut);
	const text = JSON.stringify(otio, null, 4);
	assert.match(text, /"OTIO_SCHEMA": "Timeline\.1"/);
	assert.match(text, /oneos:file\/01jabcdefghjkmnpqrstvwxyz0\?version=v3/);
	const back = otioToCut(JSON.parse(text));
	assert.deepEqual(back, cut);
});

test("what cannot be SAVED under files/989 is refused by name: a library sound (an address), media outside the project, overlapping elements", () => {
	const lib = maximal();
	(lib.project.scenes[0].tracks.audio[0].elements as any[]).push({ id: "a2", type: "audio", sourceType: "library", sourceUrl: "https://freesound.org/x.mp3", name: "Whoosh", volume: 1, startTime: s(10), duration: s(1), trimStart: 0, trimEnd: 0 });
	assert.throws(() => cutToOtio(lib), (e: unknown) => e instanceof CutOtioRefusal && e.code === "media-not-referenced" && /Whoosh/.test(e.message));
	const missing = maximal();
	missing.media = missing.media.filter((m) => m.id !== "m-image");
	assert.throws(() => cutToOtio(missing), (e: unknown) => e instanceof CutOtioRefusal && e.code === "media-not-referenced" && /Logo/.test(e.message));
	const overlap = maximal();
	(overlap.project.scenes[0].tracks.main.elements[1] as any).startTime = s(4);
	assert.throws(() => cutToOtio(overlap), (e: unknown) => e instanceof CutOtioRefusal && e.code === "format-not-round-trip" && /overlap/.test(e.message));
});
