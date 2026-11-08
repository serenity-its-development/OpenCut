// The ONE video project format (files/989, Mona 2026-11-08: "OpenTimelineIO .otio"): Cut reads an .otio and writes it back unchanged;
// media are OneOS files (`oneos:file/<id>?version=<v>`); what Cut cannot represent is refused by name, naming the part, never dropped.
// Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { OTIO_MIME, OtioRefusal, blankOtio, decodeOtio, encodeOtio, mediaUrl, parseMediaUrl } from "../src/oneos/otio.ts";

const FILE = "01jabcdefghjkmnpqrstvwxyz0";
const rt = (value: number, rate = 30) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, dur: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start), duration: rt(dur) });
const clip = (name: string, url: string, extra: Record<string, unknown> = {}) => ({
	OTIO_SCHEMA: "Clip.2", name, source_range: range(0, 90), effects: [], markers: [], enabled: true,
	media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", name, target_url: url, available_range: range(0, 300), available_image_bounds: null, metadata: {} } },
	active_media_reference_key: "DEFAULT_MEDIA", metadata: { opencut: { opacity: 0.8 } }, ...extra,
});
const timeline = (children: unknown[], extra: Record<string, unknown> = {}) => ({
	OTIO_SCHEMA: "Timeline.1", name: "Trip", global_start_time: null, metadata: { filmcraft: { kept: true } },
	tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {},
		children: [{ OTIO_SCHEMA: "Track.1", name: "V1", kind: "Video", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children }] },
	...extra,
});
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 4));
const refused = (fn: () => unknown, code: string, part?: RegExp) =>
	assert.throws(fn, (e: unknown) => e instanceof OtioRefusal && e.code === code && (!part || part.test(e.message)));

test("a timeline of clips and gaps opens as tracks of OneOS media and writes back unchanged (every field, both editors' metadata)", () => {
	const src = timeline([clip("beach", mediaUrl(FILE, "v3")), { OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, 15), effects: [], markers: [], enabled: true, metadata: {} }]);
	const doc = decodeOtio("trip.otio", bytes(src));
	assert.equal(doc.tracks.length, 1);
	assert.equal(doc.tracks[0].kind, "Video");
	const [c, g] = doc.tracks[0].items;
	assert.equal(c.type, "clip");
	assert.deepEqual(c.type === "clip" && c.media, { id: FILE, version: "v3" });
	assert.equal(g.type, "gap");
	assert.deepEqual(JSON.parse(new TextDecoder().decode(encodeOtio(doc))), src, "the same document, value for value");
	assert.equal(OTIO_MIME, "application/x-otio+json");
});

test("a media reference is a OneOS file and version, never a path, an address or embedded bytes", () => {
	assert.deepEqual(parseMediaUrl(mediaUrl(FILE, "v3")), { id: FILE, version: "v3" });
	for (const url of ["file:///Users/me/beach.mov", "https://cdn.example/beach.mov", `oneos:file/${FILE}`, "oneos:file/NOTULID?version=v1", "data:video/mp4;base64,AAAA"]) {
		refused(() => decodeOtio("trip.otio", bytes(timeline([clip("beach", url)]))), "media-not-referenced", /beach/);
	}
});

test("what Cut cannot represent is refused by name, naming the part, before anything opens", () => {
	const t = (children: unknown[]) => bytes(timeline(children));
	refused(() => decodeOtio("trip.otio", t([{ OTIO_SCHEMA: "Transition.1", name: "Dissolve", transition_type: "SMPTE_Dissolve", in_offset: rt(5), out_offset: rt(5), metadata: {} }])), "format-not-round-trip", /Transition\.1/);
	refused(() => decodeOtio("trip.otio", t([clip("beach", mediaUrl(FILE, "v1"), { effects: [{ OTIO_SCHEMA: "LinearTimeWarp.1", name: "", effect_name: "LinearTimeWarp", time_scalar: 2, metadata: {} }] })])), "format-not-round-trip", /effects of clip beach/);
	refused(() => decodeOtio("trip.otio", t([clip("beach", mediaUrl(FILE, "v1"), { markers: [{ OTIO_SCHEMA: "Marker.2" }] })])), "format-not-round-trip", /markers of clip beach/);
	refused(() => decodeOtio("trip.otio", t([clip("beach", mediaUrl(FILE, "v1"), { unknown_field: 1 })])), "format-not-round-trip", /unknown_field/);
	refused(() => decodeOtio("trip.otio", bytes(timeline([], { tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [{ OTIO_SCHEMA: "Stack.1", name: "nested", children: [] }] } }))), "format-not-round-trip", /Stack\.1/);
});

test("anything that is not an OpenTimelineIO timeline Cut reads is refused by name", () => {
	refused(() => decodeOtio("beach.mp4", new Uint8Array([0, 0, 0, 24])), "format-not-editable");
	refused(() => decodeOtio("trip.fcproj", new Uint8Array()), "format-not-editable");
	refused(() => decodeOtio("trip.otio", new TextEncoder().encode("not json")), "file-unreadable");
	refused(() => decodeOtio("trip.otio", bytes({ OTIO_SCHEMA: "SerializableCollection.1", children: [] })), "format-not-editable", /SerializableCollection/);
	refused(() => decodeOtio("trip.otio", bytes(timeline([clip("beach", mediaUrl(FILE, "v1"), { source_range: { OTIO_SCHEMA: "TimeRange.1", start_time: rt(0, 30), duration: rt(10, 25) } })]))), "format-not-round-trip", /rate/);
});

test("the Create blank is an empty timeline with one video and one audio track, in the form Cut writes", () => {
	const b = blankOtio("Untitled video");
	const doc = decodeOtio("Untitled video.otio", b);
	assert.deepEqual(doc.tracks.map((t) => t.kind), ["Video", "Audio"]);
	assert.deepEqual(encodeOtio(doc), b);
});
