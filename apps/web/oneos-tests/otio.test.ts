// The ONE video project format (files/989, Mona 2026-11-08: "OpenTimelineIO .otio"): Cut reads an .otio and writes it back unchanged;
// media are OneOS files (`oneos:file/<id>?version=<v>`); what Cut cannot edit is LOCKED and carried through untouched (Mona: "Stay on .otio,
// fix writers"); only a file Cut would damage is refused.
// Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { OTIO_MIME, OtioRefusal, blankOtio, decodeOtio, encodeOtio, mediaUrl, parseMediaUrl, sameValue } from "../src/oneos/otio.ts";

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

test("a timeline of clips and gaps opens editable and writes back unchanged (every field, both editors' metadata)", () => {
	const src = timeline([clip("beach", mediaUrl(FILE, "v3")), { OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, 15), effects: [], markers: [], enabled: true, metadata: {} }]);
	const doc = decodeOtio("trip.otio", bytes(src));
	const t = doc.timelines[0].tracks[0];
	assert.equal(t.locked, null);
	const [c, g] = t.items;
	assert.deepEqual(c.type === "clip" && c.media, { id: FILE, version: "v3" });
	assert.equal(g.type, "gap");
	assert.ok(sameValue(JSON.parse(new TextDecoder().decode(encodeOtio(doc))), src));
	assert.equal(OTIO_MIME, "application/x-otio+json");
});

test("an edit Cut makes lands on its own track only; a locked track beside it is written back exactly", () => {
	const transition = { OTIO_SCHEMA: "Transition.1", name: "Dissolve", transition_type: "SMPTE_Dissolve", in_offset: rt(5), out_offset: rt(5), metadata: { filmcraft: { effect: "cross_dissolve" } } };
	const src = timeline([clip("beach", mediaUrl(FILE, "v3"))]);
	src.tracks.children.push({ OTIO_SCHEMA: "Track.1", name: "V2", kind: "Video", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [clip("a", mediaUrl(FILE, "v1")), transition, clip("b", mediaUrl(FILE, "v2"))] } as any);
	const doc = decodeOtio("trip.otio", bytes(src));
	const [v1, v2] = doc.timelines[0].tracks;
	assert.equal(v1.locked, null);
	assert.match(v2.locked!, /Transition\.1 "Dissolve"/);
	const first = v1.items[0];
	if (first.type !== "clip") throw new Error("clip");
	first.source.duration = 60;
	first.name = "beach (trimmed)";
	const out = JSON.parse(new TextDecoder().decode(encodeOtio(doc)));
	assert.equal(out.tracks.children[0].children[0].source_range.duration.value, 60);
	assert.equal(out.tracks.children[0].children[0].name, "beach (trimmed)");
	assert.ok(sameValue(out.tracks.children[1], src.tracks.children[1]), "the locked track is exactly as read");
	assert.ok(sameValue(out.metadata, src.metadata), "Film's metadata is untouched");
});

test("what Cut cannot edit is locked with its reason, never refused or dropped: transitions, effects, markers, nested stacks, unknown fields, paths as media", () => {
	const lockOf = (children: unknown[]) => decodeOtio("trip.otio", bytes(timeline(children))).timelines[0].tracks[0].locked;
	assert.match(lockOf([{ OTIO_SCHEMA: "Transition.1", name: "Dissolve", transition_type: "SMPTE_Dissolve", in_offset: rt(5), out_offset: rt(5), metadata: {} }])!, /Transition\.1/);
	// A clip's speed (one plain LinearTimeWarp.1, files/989 2c) Cut edits; a frame hold, a speed outside Cut's, any other effect lock it, named.
	const warp = (time_scalar: number, more: object = {}) => ({ OTIO_SCHEMA: "LinearTimeWarp.1", name: "", effect_name: "LinearTimeWarp", time_scalar, metadata: {}, ...more });
	assert.equal(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [warp(2)] })]) ?? null, null);
	assert.equal(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [warp(-0.5)] })]) ?? null, null);
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [warp(8)] })])!, /plays at 800%, outside Cut's speed \(1% to 500%\)/);
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [{ OTIO_SCHEMA: "FreezeFrame.1", name: "", effect_name: "FreezeFrame", time_scalar: 0, metadata: { filmcraft: { hold: 0 } } }] })])!, /holds a frame, which Cut has no hold for/);
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [warp(2, { metadata: { other: 1 } })] })])!, /effects Cut does not show/);
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [warp(2), warp(2)] })])!, /effects Cut does not show/);
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1"), { effects: [{ OTIO_SCHEMA: "Effect.1", name: "", effect_name: "Blur", metadata: {} }] })])!, /effects Cut does not show/);
	// A clip's own markers are carried on it, the track editable (files/989, 2c clip markers); markers Cut cannot read, or a gap's, lock it.
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1"), { markers: [{ OTIO_SCHEMA: "Marker.2" }] })])!, /holds markers Cut cannot read/);
	assert.equal(lockOf([clip("beach", mediaUrl(FILE, "v1"), { markers: [{ OTIO_SCHEMA: "Marker.2", name: "m", marked_range: range(10, 0), color: "RED", comment: "", metadata: {} }] })]), null);
	assert.match(lockOf([clip("beach", mediaUrl(FILE, "v1")), { OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, 15), effects: [], markers: [{ OTIO_SCHEMA: "Marker.2" }], enabled: true, metadata: {} }])!, /Gap\.1 has markers of its own/);
	assert.match(lockOf([clip("beach", "file:///Users/me/beach.mov")])!, /not a OneOS file/);
	const nested = timeline([]);
	nested.tracks.children = [{ OTIO_SCHEMA: "Stack.1", name: "nested", children: [] }] as any;
	assert.match(decodeOtio("trip.otio", bytes(nested)).timelines[0].tracks[0].locked!, /nested stack/);
	// Locked parts round-trip value for value.
	for (const children of [[{ OTIO_SCHEMA: "Transition.1", name: "D", transition_type: "SMPTE_Dissolve", in_offset: rt(5), out_offset: rt(5), metadata: {} }], [clip("x", "https://cdn.example/x.mov", { unknown_field: 1 })]]) {
		const src = timeline(children);
		assert.ok(sameValue(JSON.parse(new TextDecoder().decode(encodeOtio(decodeOtio("t.otio", bytes(src))))), src));
	}
});

test("a whole Film project (a SerializableCollection.1 with the project in metadata.filmcraft) goes Film -> Cut -> Film value for value", () => {
	const filmProject = { name: "Trip", notes: "Call the client", luts: [{ id: "l1", name: "Warm", format: "cube", text: "LUT_3D_SIZE 2" }], transcripts: { "7": { language: "en", words: [] } }, items: { "3": { name: "unused.mov" } }, next_id: 42 };
	const tl = (n: string, children: unknown[]) => ({ ...timeline(children), name: n, metadata: { filmcraft: { item: 9, settings: { frame_rate: 23.976023976023978 } } } });
	const src = {
		OTIO_SCHEMA: "SerializableCollection.1", name: "Trip", metadata: { filmcraft: { project: filmProject } },
		children: [
			tl("Outer", [clip("beach", mediaUrl(FILE, "v3")), { OTIO_SCHEMA: "Transition.1", name: "Iris", transition_type: "Custom_Transition", in_offset: rt(8), out_offset: rt(8), metadata: { filmcraft: { effect: "iris_round" } } }, clip("b", mediaUrl(FILE, "v4"), { effects: [{ OTIO_SCHEMA: "Effect.1", name: "Gaussian Blur", effect_name: "gaussian_blur", metadata: { filmcraft: { params: { radius: { value: 4, keyframes: [{ t: 0, v: 0 }, { t: 24, v: 8 }] } } } } }] })]),
			tl("Inner", [clip("c", mediaUrl(FILE, "v5"))]),
		],
	};
	const doc = decodeOtio("trip.otio", bytes(src));
	assert.equal(doc.timelines.length, 2);
	assert.match(doc.timelines[0].tracks[0].locked!, /Transition\.1 "Iris"/);
	assert.equal(doc.timelines[1].tracks[0].locked, null);
	const back = JSON.parse(new TextDecoder().decode(encodeOtio(doc)));
	assert.ok(sameValue(back, src), "Film -> Cut -> Film, unedited, value for value");
});

test("only a file Cut would damage is refused by name", () => {
	refused(() => decodeOtio("beach.mp4", new Uint8Array([0, 0, 0, 24])), "format-not-editable");
	refused(() => decodeOtio("trip.fcproj", new Uint8Array()), "format-not-editable");
	refused(() => decodeOtio("trip.otio", new TextEncoder().encode("not json")), "file-unreadable");
	refused(() => decodeOtio("trip.otio", bytes({ OTIO_SCHEMA: "SerializableCollection.1", children: [] })), "format-not-editable", /no Timeline/);
	assert.deepEqual(parseMediaUrl(mediaUrl(FILE, "v3")), { id: FILE, version: "v3" });
	assert.throws(() => mediaUrl("NOTULID", "v1"), OtioRefusal);
});

test("the Create blank is an empty timeline with one video and one audio track, in the form Cut writes", () => {
	const b = blankOtio("Untitled video");
	const doc = decodeOtio("Untitled video.otio", b);
	assert.deepEqual(doc.timelines[0].tracks.map((t) => t.kind), ["Video", "Audio"]);
	assert.deepEqual(encodeOtio(doc), b);
});

test("Cut's own clips (an OpenCut generator with its element) and lane stacks open editable; anyone else's generator or stack stays locked", () => {
	const gen = (kind: string, meta: unknown) => ({ OTIO_SCHEMA: "Clip.2", name: "Title", source_range: range(0, 30), effects: [], markers: [], enabled: true,
		media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "GeneratorReference.1", name: "Title", generator_kind: kind, parameters: {}, available_range: null, metadata: {} } },
		active_media_reference_key: "DEFAULT_MEDIA", metadata: meta });
	const own = decodeOtio("t.otio", bytes(timeline([gen("OpenCut.text", { opencut: { element: { content: "Hi" } } })])));
	assert.equal(own.timelines[0].tracks[0].locked, null);
	assert.equal(own.timelines[0].tracks[0].items[0].type, "generator");
	assert.match(decodeOtio("t.otio", bytes(timeline([gen("SolidColor", {})]))).timelines[0].tracks[0].locked!, /not a OneOS file/);
	assert.match(decodeOtio("t.otio", bytes(timeline([gen("OpenCut.text", {})]))).timelines[0].tracks[0].locked!, /not a OneOS file/);
	const lanes = timeline([]);
	const lane = (i: number, children: unknown[]) => ({ OTIO_SCHEMA: "Track.1", name: `V1 (lane ${i + 1})`, kind: "Video", source_range: null, effects: [], markers: [], enabled: true, metadata: { opencut: { lane: i } }, children });
	lanes.tracks.children = [{ OTIO_SCHEMA: "Stack.1", name: "V1", source_range: null, effects: [], markers: [], enabled: true, metadata: { opencut: { track: { muted: false, hidden: false } } }, children: [lane(0, [clip("a", mediaUrl(FILE, "v1"))]), lane(1, [clip("b", mediaUrl(FILE, "v2"))])] }] as any;
	const t = decodeOtio("t.otio", bytes(lanes)).timelines[0].tracks[0];
	assert.equal(t.locked, null);
	assert.equal(t.kind, "Video");
	assert.deepEqual(t.lanes!.map((l) => l.length), [1, 1]);
	assert.ok(sameValue(JSON.parse(new TextDecoder().decode(encodeOtio(decodeOtio("t.otio", bytes(lanes))))), lanes));
});
