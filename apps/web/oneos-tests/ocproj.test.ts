// The .ocproj codec (files/999): what opens writes back unchanged; every refusal is by name. Run: node --test apps/web/oneos-tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { OCPROJ_MIME, OcprojRefusal, blankOcproj, decodeOcproj, encodeOcproj } from "../src/oneos/ocproj.ts";

const FILE = "01jabcdefghjkmnpqrstvwxyz0";
const doc = () => ({
	project: { metadata: { id: "p1", name: "Trip", duration: 12 }, scenes: [{ id: "s1", name: "Main", isMain: true, tracks: [{ id: "t1", elements: [{ id: "e1", type: "video", mediaId: "m1", startTime: 0, duration: 12 }] }] }], currentSceneId: "s1", settings: { fps: 30 }, version: 1 },
	media: [{ id: "m1", name: "beach.mp4", type: "video" as const, file: { id: FILE, version: "v3" }, duration: 12 }],
});
const code = (fn: () => unknown, c: string) => assert.throws(fn, (e: unknown) => e instanceof OcprojRefusal && e.code === c);

test("a project round-trips byte for byte, its media as storage references", () => {
	const bytes = encodeOcproj(doc());
	const back = decodeOcproj("trip.ocproj", bytes);
	assert.deepEqual(back.media[0].file, { id: FILE, version: "v3" });
	assert.deepEqual(encodeOcproj(back), bytes);
	assert.equal(OCPROJ_MIME, "application/x-opencut-project");
});

test("the Create blank opens and writes back unchanged", () => {
	const b = blankOcproj("Untitled video", "p0", "2026-11-08T00:00:00.000Z");
	const d = decodeOcproj("Untitled video.ocproj", b);
	assert.deepEqual(d.media, []);
	assert.deepEqual(encodeOcproj(d), b);
});

test("anything Cut would not write back unchanged is refused by name, before it opens", () => {
	code(() => decodeOcproj("beach.mp4", new Uint8Array([0, 0, 0, 24])), "format-not-editable");
	code(() => decodeOcproj("trip.fcproj", new Uint8Array()), "format-not-editable");
	code(() => decodeOcproj("trip.ocproj", new TextEncoder().encode("not json")), "file-unreadable");
	const text = new TextDecoder().decode(encodeOcproj(doc()));
	// The same document written another way (not Cut's form) would be rewritten by a save: refused.
	code(() => decodeOcproj("trip.ocproj", new TextEncoder().encode(JSON.stringify(JSON.parse(text)))), "format-not-round-trip");
	const extra = JSON.parse(text);
	extra.plugins = {};
	code(() => decodeOcproj("trip.ocproj", new TextEncoder().encode(`${JSON.stringify(extra, null, 2)}\n`)), "format-not-round-trip");
	const newer = JSON.parse(text);
	newer.formatVersion = 2;
	code(() => decodeOcproj("trip.ocproj", new TextEncoder().encode(`${JSON.stringify(newer, null, 2)}\n`)), "format-not-editable");
});

test("a medium that is not a file in OneOS storage is refused (never embedded, never browser-only)", () => {
	const d = doc();
	(d.media[0] as any).file = { id: "opfs:beach", version: "v1" };
	code(() => encodeOcproj(d), "media-not-referenced");
	const e = doc();
	(e.media[0] as any).bytes = "AAAA";
	code(() => encodeOcproj(e), "format-not-round-trip");
});
