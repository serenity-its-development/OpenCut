// Cut's editor on its OTIO codec (files/989): what the host opens becomes the project the editor holds, and the editor's project becomes
// the .otio the host saves. A Cut project collection opens whole; any other .otio opens CARRIED (plain tracks editable, the rest locked and
// written back exactly). An unedited save gives back the bytes it opened; what cannot be saved is refused by name, never dropped.
// Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CutSession, CutSaveRefusal } from "../src/oneos/cut-session.ts";
import { OtioRefusal, mediaUrl, sameValue } from "../src/oneos/otio.ts";
import { TICKS, cutToOtio } from "../src/oneos/cut-otio.ts";
import { maximal } from "./cut-fixture.ts";

const F1 = "01jabcdefghjkmnpqrstvwxyz0", F2 = "01jabcdefghjkmnpqrstvwxyz1", F9 = "01jabcdefghjkmnpqrstvwxyz9";
const enc = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 4)}\n`);
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rt = (value: number, rate = 30) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, dur: number, rate = 30) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });
const clip = (name: string, url: string, start = 0, dur = 90, extra: Record<string, unknown> = {}) => ({
	OTIO_SCHEMA: "Clip.2", name, source_range: range(start, dur), effects: [], markers: [], enabled: true,
	media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "ExternalReference.1", name: `${name}.mov`, target_url: url, available_range: range(0, 300), available_image_bounds: null, metadata: {} } },
	active_media_reference_key: "DEFAULT_MEDIA", metadata: { filmcraft: { label: "blue" } }, ...extra,
});
const gap = (dur: number) => ({ OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, dur), effects: [], markers: [], enabled: true, metadata: {} });
const track = (name: string, kind: string, children: unknown[], extra: Record<string, unknown> = {}) => ({ OTIO_SCHEMA: "Track.1", name, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: { filmcraft: { track: name } }, children, ...extra });
const transition = { OTIO_SCHEMA: "Transition.1", name: "Dissolve", transition_type: "SMPTE_Dissolve", in_offset: rt(5), out_offset: rt(5), metadata: { filmcraft: { effect: "cross_dissolve" } } };

/** A whole Film project, in the shape FilmCraft's writer makes it: two sequences, the project under metadata.filmcraft.project. */
function filmDoc() {
	const tl = (name: string, tracks: unknown[]) => ({
		OTIO_SCHEMA: "Timeline.1", name, global_start_time: null, metadata: { filmcraft: { sequence: name } },
		tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [{ OTIO_SCHEMA: "Marker.2", name: "film marker", marked_range: range(10, 0), color: "GREEN", comment: "", metadata: {} }], enabled: true, metadata: {}, children: tracks },
	});
	return {
		OTIO_SCHEMA: "SerializableCollection.1", name: "Trip", metadata: { filmcraft: { project: { name: "Trip", notes: "Call the client", next_id: 42 } } },
		children: [
			tl("Edit", [
				track("V1", "Video", [clip("beach", mediaUrl(F1, "v3"), 30, 90), gap(15), clip("pier", mediaUrl(F2, "v1"), 0, 60)]),
				track("V2", "Video", [clip("title", mediaUrl(F1, "v3")), transition, clip("end", mediaUrl(F2, "v1"))]),
				track("A1", "Audio", [clip("music", mediaUrl(F9, "v2"), 0, 150)]),
			]),
			tl("Alt", [track("V1", "Video", [clip("beach", mediaUrl(F1, "v3"))])]),
		],
	};
}

/** What the browser loader does to a fresh session's project: it fills each element with the editor's defaults. */
function load(s: CutSession) {
	const p = copy(s.project);
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type !== "audio") Object.assign(e, { transform: e.transform ?? { position: { x: 0, y: 0 }, scale: 1, rotate: 0, flipX: false }, opacity: e.opacity ?? 1 });
		else e.volume ??= 1;
	}
	s.baseline(p, s.media);
	return p;
}

test("a Cut project collection opens whole, and an unedited save gives back the very bytes it opened", () => {
	const bytes = enc(cutToOtio(maximal() as any));
	const s = CutSession.open("trip.otio", bytes);
	assert.equal(s.mode, "cut");
	assert.deepEqual(s.locked, []);
	assert.deepEqual(s.media.map((m) => m.file), [{ id: F1, version: "v3" }, { id: F2, version: "v1" }, { id: "01jabcdefghjkmnpqrstvwxyz2", version: "v9" }]);
	const p = load(s);
	assert.deepEqual(s.save(p, s.media), bytes);
});

test("an edit to a Cut project is saved through the whole-project writer and reads back as edited", () => {
	const s = CutSession.open("trip.otio", enc(cutToOtio(maximal() as any)));
	const p = load(s);
	p.scenes[0].tracks.main.elements[0].duration = 4 * TICKS;
	p.scenes[0].tracks.main.elements[0].opacity = 0.25;
	const back = CutSession.open("trip.otio", s.save(p, s.media));
	assert.equal(back.project.scenes[0].tracks.main.elements[0].duration, 4 * TICKS);
	assert.equal(back.project.scenes[0].tracks.main.elements[0].opacity, 0.25);
});

test("a Cut project that would not come back value for value is refused by name, never opened", () => {
	const doc = cutToOtio(maximal() as any) as any;
	doc.children[0].tracks.children[0].children[0].effects = [{ OTIO_SCHEMA: "Effect.1", name: "x", effect_name: "x", metadata: {} }];
	assert.throws(() => CutSession.open("trip.otio", enc(doc)), (e: unknown) => e instanceof OtioRefusal && e.code === "format-not-round-trip");
});

test("a whole Film project opens CARRIED: plain tracks become Cut's tracks, the rest is locked with its reason, the media are its OneOS files", () => {
	const s = CutSession.open("trip.otio", enc(filmDoc()));
	assert.equal(s.mode, "carried");
	assert.deepEqual(s.project.scenes.map((sc: any) => sc.name), ["Edit", "Alt"]);
	assert.deepEqual(s.locked.map((l) => [l.scene, l.track]), [["Edit", "V2"]]);
	assert.match(s.locked[0].reason, /Transition\.1 "Dissolve"/);
	const main = s.project.scenes[0].tracks.main;
	assert.equal(main.name, "V1");
	assert.deepEqual(main.elements.map((e: any) => [e.name, e.startTime, e.duration, e.trimStart, e.trimEnd]), [
		["beach", 0, 3 * TICKS, TICKS, 6 * TICKS], ["pier", 3.5 * TICKS, 2 * TICKS, 0, 8 * TICKS],
	]);
	assert.deepEqual(s.project.scenes[0].tracks.audio.map((t: any) => t.name), ["A1"]);
	assert.deepEqual(s.media.map((m) => [m.file.id, m.file.version, m.type]), [[F1, "v3", "video"], [F2, "v1", "video"], [F9, "v2", "audio"]]);
});

test("Film -> Cut -> Film, unedited: the very bytes come back, and after a reload by the editor too", () => {
	const bytes = enc(filmDoc());
	const s = CutSession.open("trip.otio", bytes);
	assert.deepEqual(s.save(load(s), s.media), bytes);
});

test("an edit in a carried project lands on its own track only; the locked track, the gaps it kept and every other editor's metadata are untouched", () => {
	const src = filmDoc();
	const s = CutSession.open("trip.otio", enc(src));
	const p = load(s);
	const pier = p.scenes[0].tracks.main.elements[1];
	pier.startTime = 4 * TICKS; // moved half a second later
	pier.opacity = 0.5;
	const out = dec(s.save(p, s.media));
	const want = copy(src) as any;
	const v1 = want.children[0].tracks.children[0];
	v1.children[1] = gap(30);
	v1.children[2].metadata = { filmcraft: { label: "blue" }, opencut: { element: { ...elementExtras(pier) } } };
	assert.ok(sameValue(out.children[0].tracks.children[1], src.children[0].tracks.children[1]), "the locked track is written back exactly");
	assert.ok(sameValue(out.children[0].tracks.children[0].children[0], (src as any).children[0].tracks.children[0].children[0]), "an unmoved clip is its own bytes");
	assert.ok(sameValue(out.children[0].tracks.children[0].children[1], gap(30)));
	assert.deepEqual(out.children[0].tracks.children[0].children[2].metadata.filmcraft, { label: "blue" });
	assert.equal(out.children[0].tracks.children[0].children[2].metadata.opencut.element.opacity, 0.5);
	assert.ok(sameValue(out.metadata, src.metadata) && sameValue(out.children[1], src.children[1]));
	// And it opens again as edited.
	const again = CutSession.open("trip.otio", enc(out));
	assert.equal(again.project.scenes[0].tracks.main.elements[1].startTime, 4 * TICKS);
	assert.equal(again.project.scenes[0].tracks.main.elements[1].opacity, 0.5);
});

function elementExtras(e: Record<string, unknown>) {
	const { id: _i, name: _n, startTime: _s, duration: _d, trimStart: _t, trimEnd: _e, sourceDuration: _sd, mediaId: _m, type: _ty, ...rest } = e;
	return rest;
}

test("a time Cut cannot hold at the track's own rate is written in Cut's exact ticks, never rounded", () => {
	const s = CutSession.open("trip.otio", enc(filmDoc()));
	const p = load(s);
	p.scenes[0].tracks.main.elements[0].duration = 3 * TICKS + 7; // not a whole frame at 30 fps
	const out = dec(s.save(p, s.media));
	const c = out.children[0].tracks.children[0].children[0];
	assert.deepEqual(c.source_range.duration, rt(3 * TICKS + 7, TICKS));
	assert.deepEqual(c.source_range.start_time, rt(TICKS, TICKS));
	assert.equal(CutSession.open("trip.otio", enc(out)).project.scenes[0].tracks.main.elements[0].duration, 3 * TICKS + 7);
});

test("a new medium placed in a carried project is saved as a OneOS file; one that is not a OneOS file is refused by name", () => {
	const s = CutSession.open("trip.otio", enc(filmDoc()));
	const p = load(s);
	const media = [...s.media, { id: "new", name: "drone.mp4", type: "video", file: { id: "01jabcdefghjkmnpqrstvwxyz8", version: "v1" } }];
	p.scenes[0].tracks.main.elements.push({ id: "e-new", type: "video", name: "drone", mediaId: "new", startTime: 6 * TICKS, duration: TICKS, trimStart: 0, trimEnd: 0, transform: { position: { x: 0, y: 0 }, scale: 1, rotate: 0, flipX: false }, opacity: 1 });
	const out = dec(s.save(p, media));
	const kids = out.children[0].tracks.children[0].children;
	assert.equal(kids.at(-1).media_references.DEFAULT_MEDIA.target_url, mediaUrl("01jabcdefghjkmnpqrstvwxyz8", "v1"));
	assert.deepEqual(kids.at(-2), { OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, 15), effects: [], markers: [], enabled: true, metadata: {} });
	const unref = [...s.media, { id: "new", name: "drone.mp4", type: "video" }];
	assert.throws(() => s.save(p, unref as any), (e: unknown) => e instanceof CutSaveRefusal && e.code === "media-not-referenced" && /drone\.mp4/.test(e.message));
});

test("what a carried project has no place for is refused by name at save, and nothing is written", () => {
	const s = CutSession.open("trip.otio", enc(filmDoc()));
	const refusedAs = (edit: (p: any) => void, code: string, part: RegExp) => {
		const p = load(CutSession.open("trip.otio", enc(filmDoc())));
		edit(p);
		assert.throws(() => s.save(p, s.media), (e: unknown) => e instanceof CutSaveRefusal && e.code === code && part.test(e.message));
	};
	refusedAs((p) => p.scenes.push({ ...p.scenes[1], id: "s-new", name: "New" }), "scene-not-carried", /New/);
	refusedAs((p) => p.scenes[0].tracks.overlay.push({ id: "tx", name: "Titles", type: "text", hidden: false, elements: [{ id: "t", type: "text", name: "Hi", startTime: 0, duration: TICKS, trimStart: 0, trimEnd: 0 }] }), "element-not-carried", /text "Hi"/);
	refusedAs((p) => { p.scenes[0].tracks.main.elements[0].sourceType = "library"; p.scenes[0].tracks.main.elements[0].type = "audio"; }, "library-sound-off", /beach/);
});

test("a carried track Cut would damage on rewrite is locked at open, by name", () => {
	const doc = filmDoc() as any;
	doc.children[1].tracks.children[0].children.push({ ...gap(10), metadata: { filmcraft: { note: "hold" } } });
	doc.children[0].tracks.children[2].enabled = false;
	doc.children[0].tracks.children[0].children[0].source_range = range(1, 1, 23.976);
	const s = CutSession.open("trip.otio", enc(doc));
	const reasons = Object.fromEntries(s.locked.map((l) => [`${l.scene}/${l.track}`, l.reason]));
	assert.match(reasons["Alt/V1"], /gap carries data of its own/);
	assert.match(reasons["Edit/A1"], /switched off/);
	assert.match(reasons["Edit/V1"], /whole ticks/);
	assert.deepEqual(s.save(load(s), s.media), enc(doc));
});

test("after the host confirms a save, the next save is made on what was saved: unedited it is those bytes, edited it lands again", () => {
	const s = CutSession.open("trip.otio", enc(filmDoc()));
	const p = load(s);
	p.scenes[0].tracks.main.elements[1].startTime = 4 * TICKS;
	p.scenes[0].tracks.audio = [];
	p.scenes[0].tracks.overlay.push({ id: "v-new", name: "B-roll", type: "video", muted: false, hidden: false, elements: [{ id: "b1", type: "video", name: "gull", mediaId: s.media[0].id, startTime: TICKS, duration: TICKS, trimStart: 0, trimEnd: 0, opacity: 1 }] });
	const first = s.save(p, s.media);
	assert.deepEqual(dec(first).children[0].tracks.children.map((t: any) => t.name), ["V1", "V2", "B-roll"], "A1 removed, B-roll added after the locked V2");
	s.committed(first, p, s.media);
	assert.deepEqual(s.save(p, s.media), first, "unedited after the save: the saved bytes");
	p.scenes[0].tracks.main.elements[0].name = "beach (long)";
	p.scenes[0].tracks.overlay[0].elements[0].duration = 2 * TICKS;
	const second = dec(s.save(p, s.media));
	const [v1, v2, broll] = second.children[0].tracks.children;
	assert.equal(v1.children[0].name, "beach (long)");
	assert.ok(sameValue(v1.children.slice(1), dec(first).children[0].tracks.children[0].children.slice(1)), "the rest of V1 is what was saved");
	assert.ok(sameValue(v2, filmDoc().children[0].tracks.children[1]), "the locked track, still exactly the file's");
	assert.deepEqual(broll.children.map((c: any) => [c.OTIO_SCHEMA, c.source_range.duration.value]), [["Gap.1", TICKS], ["Clip.2", 2 * TICKS]]);
	assert.throws(() => s.committed(first, p, s.media), (e: unknown) => e instanceof CutSaveRefusal && e.code === "format-not-round-trip");
});

test("what the editor changes by itself (when it last saved, the duration it measures, where the person scrolled) is not an edit", () => {
	for (const bytes of [enc(filmDoc()), enc(cutToOtio(maximal() as any))]) {
		const s = CutSession.open("trip.otio", bytes);
		const p = load(s);
		p.metadata.updatedAt = "2026-11-09T09:00:00.000Z";
		p.metadata.duration = 12345;
		p.timelineViewState = { zoomLevel: 4, scrollLeft: 99, playheadTime: 7 };
		for (const sc of p.scenes) sc.updatedAt = "2026-11-09T09:00:00.000Z";
		assert.deepEqual(s.save(p, s.media), bytes);
	}
});

test("the window says it has unsaved changes only when the project holds an edit", () => {
	const s = CutSession.open("trip.otio", enc(filmDoc()));
	const p = load(s);
	assert.equal(s.isEdited(p, s.media), false);
	p.metadata.updatedAt = "2026-11-09T09:00:00.000Z";
	assert.equal(s.isEdited(p, s.media), false);
	p.scenes[0].tracks.main.elements[0].name = "beach 2";
	assert.equal(s.isEdited(p, s.media), true);
	assert.equal(s.isEdited(p, s.media.slice(1)), true);
	assert.equal(CutSession.open("trip.otio", enc(filmDoc())).isEdited(p, s.media), true, "a session not yet measured counts as edited");
});
