// files/989 (Mona 2026-11-09: "yes, so this becomes a tool choice not a file type choicer"): a Cut project another tool saved is still a
// Cut project. Every key Cut does not own (Film's metadata.filmcraft, any other editor's, at every level) is carried untouched through
// Cut's project mode, on the part that holds it, through an unedited save AND an edited one; only real damage is refused, by name.
// Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CutSession } from "../src/oneos/cut-session.ts";
import { OtioRefusal, sameValue } from "../src/oneos/otio.ts";
import { TICKS, cutToOtio } from "../src/oneos/cut-otio.ts";
import { carry, foreignOf } from "../src/oneos/foreign.ts";
import { maximal } from "./cut-fixture.ts";

const enc = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 4)}\n`);
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The maximal Cut project as another tool saved it: a foreign key on EVERY level Cut writes. */
function saidByAnother() {
	const doc = cutToOtio(maximal() as any) as any;
	doc.metadata.filmcraft = { project: { name: "Trip", next_id: 7 } };
	doc.metadata.other = ["kept"];
	doc.film_root_note = "a root key outside metadata";
	const tl = doc.children[0];
	tl.metadata.filmcraft = { sequence: "s1" };
	tl.tracks.metadata.filmcraft = { stack: true };
	const main = tl.tracks.children[0];
	main.metadata.filmcraft = { track: { locked: false, height: 64 } };
	const [beach, gap, logo] = main.children;
	assert.equal(gap.OTIO_SCHEMA, "Gap.1");
	beach.metadata.filmcraft = { label: "iris", source_in_ticks: 1 };
	beach.media_references.DEFAULT_MEDIA.metadata.filmcraft = { proxy: "none" };
	beach.source_range.filmcraft_note = 1;
	gap.metadata.filmcraft = { gap: "kept" };
	logo.metadata.filmcraft = { label: "rose" };
	tl.tracks.markers[0].metadata.filmcraft = { kind: "chapter" };
	doc.children[1].tracks.children[1].metadata.resolve = { lane: "any other tool" };
	return doc;
}

const fold = (s: CutSession) => {
	const p = copy(s.project);
	s.baseline(p, s.media);
	return p;
};

test("a Cut project another tool saved (foreign keys at every level) still opens in Cut's project mode, and unedited saves the very bytes", () => {
	const doc = saidByAnother();
	const bytes = enc(doc);
	const s = CutSession.open("trip.otio", bytes);
	assert.equal(s.mode, "cut");
	assert.deepEqual(s.locked, []);
	assert.deepEqual(s.save(fold(s), s.media), bytes);
});

test("an edit Cut makes to such a project keeps every foreign key on the part that holds it; a removed part takes its keys with it", () => {
	const doc = saidByAnother();
	const s = CutSession.open("trip.otio", enc(doc));
	const p = fold(s);
	const main = p.scenes[0].tracks.main;
	main.elements[0].duration = 4 * TICKS; // the gap after "Beach" grows; it is still the gap before "Logo"
	main.elements[0].opacity = 0.25;
	main.elements[1].startTime += TICKS;
	p.scenes[0].tracks.overlay[0].elements[0].content = "Bye";
	p.scenes[0].bookmarks[0].note = "Cut there";
	const out = dec(s.save(p, s.media));
	const want = cutToOtio({ project: p, media: s.media } as any) as any;
	// What Cut wrote is its edit; every foreign key is back where it was.
	const f = foreignOf(out, want);
	assert.ok(typeof f !== "string", String(f));
	const flat = Object.fromEntries([...(f as Map<string, object>)].map(([k, v]) => [k, v]));
	assert.deepEqual(flat, {
		"": { film_root_note: "a root key outside metadata" },
		".metadata": { filmcraft: { project: { name: "Trip", next_id: 7 } }, other: ["kept"] },
		".children/scene:s1.metadata": { filmcraft: { sequence: "s1" } },
		".children/scene:s1.tracks.metadata": { filmcraft: { stack: true } },
		".children/scene:s1.tracks.markers/bookmark:0.metadata": { filmcraft: { kind: "chapter" } },
		".children/scene:s1.tracks.children/track:s1-main.metadata": { filmcraft: { track: { locked: false, height: 64 } } },
		".children/scene:s1.tracks.children/track:s1-main.children/element:v1.metadata": { filmcraft: { label: "iris", source_in_ticks: 1 } },
		".children/scene:s1.tracks.children/track:s1-main.children/element:v1.source_range": { filmcraft_note: 1 },
		".children/scene:s1.tracks.children/track:s1-main.children/element:v1.media_references.DEFAULT_MEDIA.metadata": { filmcraft: { proxy: "none" } },
		".children/scene:s1.tracks.children/track:s1-main.children/gap-before:element:i1.metadata": { filmcraft: { gap: "kept" } },
		".children/scene:s1.tracks.children/track:s1-main.children/element:i1.metadata": { filmcraft: { label: "rose" } },
		".children/scene:s2.tracks.children/track:s2-text.metadata": { resolve: { lane: "any other tool" } },
	});
	// And it reopens as a Cut project, with Cut's edit.
	const again = CutSession.open("trip.otio", enc(out));
	assert.equal(again.mode, "cut");
	assert.equal(again.project.scenes[0].tracks.overlay[0].elements[0].content, "Bye");
	// The person removes "Logo": its keys go with it, the rest stay.
	const q = fold(again);
	q.scenes[0].tracks.main.elements.pop();
	const gone = dec(again.save(q, again.media));
	assert.equal(JSON.stringify(gone).includes('"rose"'), false);
	assert.equal(gone.metadata.filmcraft.project.next_id, 7);
});

test("a foreign key is never confused with damage: a value Cut writes otherwise, or a part Cut would drop, is still refused by name", () => {
	const changed = saidByAnother();
	changed.children[0].tracks.children[0].children[0].enabled = false;
	assert.throws(() => CutSession.open("trip.otio", enc(changed)), (e: unknown) => e instanceof OtioRefusal && e.code === "format-not-round-trip" && /element:v1\.enabled is false in the file and true as Cut writes it/.test(e.message));
	const extra = saidByAnother();
	extra.children[0].tracks.children[0].children.push({ OTIO_SCHEMA: "Transition.1", name: "Dissolve", metadata: {} });
	assert.throws(() => CutSession.open("trip.otio", enc(extra)), (e: unknown) => e instanceof OtioRefusal && e.code === "format-not-round-trip");
	const lacking = saidByAnother();
	delete lacking.children[0].tracks.children[0].children[0].effects;
	assert.throws(() => CutSession.open("trip.otio", enc(lacking)), (e: unknown) => e instanceof OtioRefusal && /effects is written by Cut but the file lacks it/.test(e.message));
});

test("carry() is the inverse of foreignOf() on an untouched project", () => {
	const doc = saidByAnother();
	const bare = cutToOtio(maximal() as any);
	const f = foreignOf(doc, bare);
	assert.ok(typeof f !== "string");
	assert.ok(sameValue(carry(bare as any, f as any), doc));
});

// The proof on Film's own output: `fixtures/cut-project.otio` is Cut's writer's maximal project (CUT_BLESS=1 writes it); filmcraft's host
// test `a_pure_cut_project_film_saved_opens_in_cut_s_project_mode` opens it in Film, renames a bookmark and pins what Film saves as
// `fixtures/film-saved-cut.otio` (byte for byte filmcraft's `crates/interchange/tests/it/oneos/film-saved-cut.otio`).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const FIX = join(import.meta.dirname, "fixtures");

test("Cut's maximal project is pinned as the file Film opens (cut-project.otio)", () => {
	const out = enc(cutToOtio(maximal() as any));
	const golden = join(FIX, "cut-project.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(Buffer.from(out).equals(readFileSync(golden)), "Cut writes its project as it is pinned (CUT_BLESS=1 writes it)");
});

test("the pure Cut project FILM saved (film-saved-cut.otio) opens in Cut's project mode, Film's edit read, and Cut's edit keeps Film's keys", () => {
	const golden = join(FIX, "film-saved-cut.otio");
	assert.ok(existsSync(golden), "Film's save of cut-project.otio (filmcraft blesses it)");
	const bytes = new Uint8Array(readFileSync(golden));
	const s = CutSession.open("trip.otio", bytes);
	assert.equal(s.mode, "cut");
	const p = fold(s);
	assert.equal(p.scenes[0].bookmarks[0].note, "Edited in Film", "Film's edit of Cut's bookmark");
	assert.deepEqual(s.save(p, s.media), bytes, "unedited: the very bytes");
	p.scenes[0].tracks.main.elements[0].opacity = 0.5;
	const film = dec(bytes), out = dec(s.save(p, s.media));
	assert.equal(out.children[0].tracks.children[0].children[0].metadata.opencut.element.opacity, 0.5);
	const strip = (v: any): any => (Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "opencut").map(([k, x]) => [k, strip(x)])) : v);
	assert.ok(sameValue(strip(out), strip(film)), "every key that is not Cut's comes back exactly");
});
