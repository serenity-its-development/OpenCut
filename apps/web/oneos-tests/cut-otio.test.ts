// The proof (files/989): a MAXIMAL Cut project -> .otio -> back, value for value, and what cannot be SAVED is refused by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CutOtioRefusal, cutToOtio, otioToCut } from "../src/oneos/cut-otio.ts";
import { maximal, s, transform } from "./cut-fixture.ts";

test("a maximal Cut project (every track and element type, effects, masks, keyframes, retime, text style, bookmarks, scenes, settings, view state, media) survives .otio value for value", () => {
	const cut = maximal();
	const otio = cutToOtio(cut);
	const text = JSON.stringify(otio, null, 4);
	assert.match(text, /"OTIO_SCHEMA": "Timeline\.1"/);
	assert.match(text, /oneos:file\/01jabcdefghjkmnpqrstvwxyz0\?version=v3/);
	const back = otioToCut(JSON.parse(text));
	assert.deepEqual(back, cut);
});

test("a library sound is refused by name (Freesound is off in OneOS: a sound is used only once it is a OneOS file); media outside the project is refused", () => {
	const lib = maximal();
	(lib.project.scenes[0].tracks.audio[0].elements as any[]).push({ id: "a2", type: "audio", sourceType: "library", sourceUrl: "https://freesound.org/x.mp3", name: "Whoosh", volume: 1, startTime: s(10), duration: s(1), trimStart: 0, trimEnd: 0 });
	assert.throws(() => cutToOtio(lib), (e: unknown) => e instanceof CutOtioRefusal && e.code === "library-sound-off" && /Whoosh/.test(e.message));
	const missing = maximal();
	missing.media = missing.media.filter((m) => m.id !== "m-image");
	assert.throws(() => cutToOtio(missing), (e: unknown) => e instanceof CutOtioRefusal && e.code === "media-not-referenced" && /Logo/.test(e.message));
});

test("overlapping elements (a resize can make them: OpenCut's resize does not check) are saved on stacked lanes and come back value for value", () => {
	const overlap = maximal();
	const main = overlap.project.scenes[0].tracks.main;
	(main.elements[1] as any).startTime = s(4); // Logo now starts inside Beach (0..5 s)
	(main.elements as any[]).push({ id: "i2", type: "image", name: "Badge", mediaId: "m-image", startTime: s(4.5), duration: s(1), trimStart: 0, trimEnd: 0, transform, opacity: 1 });
	const otio = cutToOtio(overlap);
	const mainTrack = otio.children[0].tracks.children[0];
	assert.equal(mainTrack.OTIO_SCHEMA, "Stack.1");
	assert.equal(mainTrack.children.length, 3, "three lanes: Beach, Logo, Badge all overlap at 4.5 s");
	for (const l of mainTrack.children) assert.equal(l.OTIO_SCHEMA, "Track.1");
	assert.deepEqual(otioToCut(JSON.parse(JSON.stringify(otio))), overlap);
});

test("OpenCut's placement refuses an overlap, and its resize does not check one (so a saved project may hold one)", async () => {
	const { readFileSync } = await import("node:fs");
	const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
	assert.match(src("timeline/placement/overlap.ts"), /startTime < elementEnd && endTime > element\.startTime/, "placement refuses an overlap");
	assert.match(src("timeline/placement/resolve.ts"), /canPlaceTimeSpansOnTrack/);
	assert.doesNotMatch(src("timeline/controllers/resize-controller.ts"), /canPlaceTimeSpansOnTrack|wouldElementOverlap|overlap/i, "a resize does not check");
});
