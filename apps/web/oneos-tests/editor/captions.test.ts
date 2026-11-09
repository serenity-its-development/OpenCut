// files/989 (Mona 2026-11-10: "Caption track in the .otio"): Cut's caption track in the EDITOR. `oneos/captions.ts` is pure (no editor
// imports), so the editor's own values it mirrors are pinned here against the editor: its text background defaults and its text size
// reference; a new caption track is Film's new one; a caption track takes text elements and nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { TEXT_BACKGROUND, captionLook, newCaptionTrackData } from "../../src/oneos/captions.ts";

register("./alias-hooks.mjs", import.meta.url);
const { DEFAULTS } = await import("../../src/timeline/defaults.ts");
const { FONT_SIZE_SCALE_REFERENCE } = await import("../../src/text/typography.ts");
const { buildEmptyTrack } = await import("../../src/timeline/placement/track-factory.ts");
const { canElementGoOnTrack } = await import("../../src/timeline/placement/compatibility.ts");
const { DEFAULT_TRACK_NAMES } = await import("../../src/timeline/tracks.ts");

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
