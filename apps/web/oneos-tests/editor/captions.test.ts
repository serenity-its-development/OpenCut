// files/989 (Mona 2026-11-10: "Caption track in the .otio"): Cut's caption track in the EDITOR. `oneos/captions.ts` is pure (no editor
// imports), so the editor's own values it mirrors are pinned here against the editor: its text background defaults and its text size
// reference; a new caption track is Film's new one; a caption track takes text elements and nothing else.
// A transcription (the editor's own `buildCaptionChunks`) makes a caption track (Mona 2026-11-10: "Yes, caption track").
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { TEXT_BACKGROUND, buildCaptionElement, captionLook, captionTimes, captionTrackDataFor, captionsGoTo, newCaptionTrackData } from "../../src/oneos/captions.ts";
import { TICKS, cutToOtio, otioToCut } from "../../src/oneos/cut-otio.ts";

register("./alias-hooks.mjs", import.meta.url);
const { DEFAULTS } = await import("../../src/timeline/defaults.ts");
const { FONT_SIZE_SCALE_REFERENCE } = await import("../../src/text/typography.ts");
const { buildEmptyTrack } = await import("../../src/timeline/placement/track-factory.ts");
const { canElementGoOnTrack } = await import("../../src/timeline/placement/compatibility.ts");
const { DEFAULT_TRACK_NAMES } = await import("../../src/timeline/tracks.ts");
const { buildCaptionChunks } = await import("../../src/transcription/caption.ts");
type J = Record<string, any>;

test("a caption's look starts from the editor's own text defaults", () => {
	assert.deepEqual(TEXT_BACKGROUND, DEFAULTS.text.background);
	assert.equal(FONT_SIZE_SCALE_REFERENCE, 90);
	const look = captionLook(newCaptionTrackData().style, "One line", { width: 1920, height: 1080 });
	assert.equal(look.fontSize * (1080 / FONT_SIZE_SCALE_REFERENCE), 54, "Film's 54 px at 1080 lines is Cut's own size");
	for (const k of Object.keys(look)) assert.ok(k in DEFAULTS.text.element, `${k} is a field of the editor's text element`);
});

test("a new caption track is Film's new caption track, and takes text elements only", () => {
	const t = buildEmptyTrack({ id: "c", type: "caption" });
	assert.deepEqual(t, { id: "c", name: DEFAULT_TRACK_NAMES.caption, type: "caption", elements: [], hidden: false, caption: newCaptionTrackData() });
	assert.equal(canElementGoOnTrack({ elementType: "text", trackType: "caption" }), true);
	for (const e of ["video", "image", "audio", "sticker", "graphic", "effect"] as const) assert.equal(canElementGoOnTrack({ elementType: e, trackType: "caption" }), false, e);
});

test("a transcription's captions make a caption track (Mona 2026-11-10: \"Yes, caption track\"), in the language stated, never two at once", () => {
	assert.equal(captionsGoTo({ transcription: true }), "caption");
	assert.equal(captionsGoTo({ file: "talk.SRT" }), "caption");
	assert.equal(captionsGoTo({ file: "styled.ass" }), "text", "an ASS file's cues carry styles of their own");
	assert.equal(captionTrackDataFor({ language: "fr" }).language, "fr");
	assert.deepEqual(captionTrackDataFor({ language: "auto" }), newCaptionTrackData(), "auto-detect: Film's new track");
	assert.deepEqual(captionTrackDataFor({}), newCaptionTrackData());
	// The editor's transcription (`buildCaptionChunks`) at seconds no SRT holds: each chunk starts where the last ends, in seconds.
	const chunks = buildCaptionChunks({ segments: [
		{ text: "one two three four five six seven", start: 0.1234567, end: 2.3456789 },
		{ text: "eight nine ten", start: 2.3456789, end: 3.0000001 },
		{ text: "eleven", start: 3.1, end: 3.2 },
	] });
	assert.ok(chunks.length >= 3);
	const naive = chunks.map((c) => ({ start: Math.round(c.startTime * TICKS), duration: Math.round(c.duration * TICKS) }));
	const times = captionTimes(chunks, (s) => Math.round(s * TICKS));
	const overlaps = (ts: { start: number; duration: number }[]) => ts.some((t, i) => i > 0 && ts[i - 1].start + ts[i - 1].duration > t.start);
	assert.ok(overlaps(naive), "rounding each start and duration apart makes two captions overlap by a tick");
	assert.equal(overlaps(times), false, "placed by start and end, each ends where the next begins at the latest");
	// Written as Film's caption track, in Cut's project, and read back whole.
	const canvas = { width: 1920, height: 1080 };
	const data = captionTrackDataFor({ language: "es" });
	const elements = chunks.map((c, i) => ({ id: `t${i}`, ...buildCaptionElement({ caption: c, style: data.style, canvasSize: canvas }) }));
	const project = {
		metadata: { id: "p", name: "Talk" }, settings: { canvasSize: canvas }, currentSceneId: "s1", version: 1,
		scenes: [{
			id: "s1", name: "Main", isMain: true, bookmarks: [],
			tracks: {
				main: { id: "m", name: "Main", type: "video", muted: false, hidden: false, elements: [] },
				overlay: [{ id: "c1", name: "Captions", type: "caption", hidden: false, caption: data, elements }],
				audio: [],
			},
		}],
	};
	const doc = cutToOtio({ project, media: [] });
	const t = doc.children[0].tracks.children[1];
	assert.equal(t.metadata.filmcraft.caption_track.language, "es");
	assert.deepEqual(t.children.filter((c: J) => c.OTIO_SCHEMA === "Clip.2").map((c: J) => c.metadata.filmcraft.caption.text), chunks.map((c) => c.text));
	assert.deepEqual(otioToCut(JSON.parse(JSON.stringify(doc))).project.scenes[0].tracks.overlay[0], project.scenes[0].tracks.overlay[0]);
});
