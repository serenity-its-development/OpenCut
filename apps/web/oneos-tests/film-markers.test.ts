// files/989 (2c clip markers, under Mona's rule of thumb 2026-11-10: "not trying to make them one ... otherwise they will have to differ"):
// Film's clip markers in Cut. Cut has no clip-marker type, so it opens Film's marked clips EDITABLE and carries their markers untouched on
// the clip (OTIO's `markers`, at the medium's time, so a move or a trim leaves each where it is in the picture). A copy of Film's clip (a
// split's right half, a duplicate, a paste) carries only what Mona's "Teach Film, then move" (2026-11-10) moves to it: on a split each marker
// goes to the half whose span of the medium holds it; a duplicate or paste takes none from a clip that still holds them. `CUT_BLESS=1` writes
// `cut-markers-film.otio`, which filmcraft's host test opens (`a_cut_edit_of_film_s_marked_clips_keeps_their_markers_in_film`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";
import { sameValue } from "../src/oneos/otio.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-markers.otio")));
type J = Record<string, any>;
const F = TICKS / 24;

function load(s: CutSession) {
	const p = JSON.parse(JSON.stringify(s.project));
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type === "audio") e.volume ??= 0;
		else Object.assign(e, { transform: e.transform ?? { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: e.opacity ?? 1 });
	}
	s.baseline(p, s.media);
	return p;
}
const tracksOf = (p: J) => p.scenes.flatMap((sc: J) => [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]);
const holding = (p: J, name: string) => tracksOf(p).find((t: J) => t.elements.some((e: J) => e.name === name));
const element = (p: J, name: string) => holding(p, name).elements.find((e: J) => e.name === name);
const clipsOf = (bytes: Uint8Array): J[] => {
	const doc = JSON.parse(new TextDecoder().decode(bytes));
	return doc.children.find((c: J) => c.name === "Edit").tracks.children.flatMap((t: J) => (t.children as J[]).filter((c) => c.OTIO_SCHEMA === "Clip.2"));
};
const marks = (c: J) => (c.markers as J[]).map((m) => m.name);
const wasClip = (name: string) => clipsOf(film).find((c) => c.name === name) as J;

test("Film's marked clips open editable in Cut, nothing locked; unedited, the very bytes", () => {
	const s = CutSession.open("Markers.otio", film);
	assert.equal(s.mode, "carried");
	assert.deepEqual(s.locked, [], "no track is locked for its clips' markers");
	assert.deepEqual(marks(wasClip("A")), ["Early", "Late"]);
	const p = load(s);
	assert.ok(element(p, "A") && element(p, "B") && element(p, "S"));
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
});

test("a Film clip Cut moves or trims keeps its markers untouched; a split moves each marker to the half that holds it; a duplicate carries none (cut-markers-film.otio)", () => {
	const s = CutSession.open("Markers.otio", film);
	const p = load(s);
	// B moves one second later; S's head is trimmed by 12 frames; A is split 48 frames in; S is duplicated after itself.
	const b = element(p, "B");
	b.startTime += TICKS;
	const sound = element(p, "S");
	sound.startTime += 12 * F;
	sound.trimStart += 12 * F;
	sound.duration -= 12 * F;
	const a = element(p, "A");
	const at = 48 * F;
	const right = { ...JSON.parse(JSON.stringify(a)), id: `${a.id}-right`, startTime: a.startTime + at, trimStart: a.trimStart + at, duration: a.duration - at };
	a.duration = at;
	holding(p, "A").elements.splice(1, 0, right);
	const dup = { ...JSON.parse(JSON.stringify(sound)), id: `${sound.id}-copy`, startTime: sound.startTime + sound.duration };
	holding(p, "S").elements.push(dup);
	const out = s.save(p, s.media);
	const clips = clipsOf(out);
	const named = (n: string) => clips.filter((c) => c.name === n);
	assert.equal(JSON.stringify(named("B")[0].markers), JSON.stringify(wasClip("B").markers), "the moved clip's markers, untouched");
	assert.equal(JSON.stringify(named("S")[0].markers), JSON.stringify(wasClip("S").markers), "the trimmed clip's markers, untouched");
	assert.equal(named("S")[0].source_range.start_time.value, 36, "trimmed at the medium's time; the marker (at 60) stays where it is in the picture");
	const [left, half] = named("A");
	assert.equal(JSON.stringify(left.markers), JSON.stringify(wasClip("A").markers.slice(0, 1)), "the left half keeps the marker in its span (Early, at 30), as read");
	assert.equal(JSON.stringify(half.markers), JSON.stringify(wasClip("A").markers.slice(1)), "the right half takes the one in its span (Late, at 90), as read");
	assert.deepEqual(named("S")[1].markers, [], "the duplicate carries none");
	assert.deepEqual(half.metadata.filmcraft.effects, wasClip("A").metadata.filmcraft.effects, "the copy is Film's clip, in Film's shape");
	const golden = join(FIX, "cut-markers-film.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(existsSync(golden), "the golden file (CUT_BLESS=1 writes it)");
	assert.ok(sameValue(JSON.parse(new TextDecoder().decode(out)), JSON.parse(readFileSync(golden, "utf8"))), "Cut writes the edit as pinned");
	const again = CutSession.open("Markers.otio", out);
	assert.deepEqual(again.locked, []);
	assert.deepEqual(again.save(load(again), again.media), out, "Cut's save reopens, and unedited it is the very bytes");
});

test("a gap's markers, or a clip's markers Cut cannot read, still lock the track, named", () => {
	const doc = JSON.parse(new TextDecoder().decode(film));
	const edit = doc.children.find((c: J) => c.name === "Edit");
	const v2 = edit.tracks.children.find((t: J) => (t.children as J[]).some((c) => c.name === "B"));
	v2.children.find((c: J) => c.OTIO_SCHEMA === "Gap.1").markers = [JSON.parse(JSON.stringify(wasClip("B").markers[0]))];
	const a1 = edit.tracks.children.find((t: J) => (t.children as J[]).some((c) => c.name === "S"));
	a1.children.find((c: J) => c.name === "S").markers[0].marked_range = null;
	const s = CutSession.open("Markers.otio", new TextEncoder().encode(JSON.stringify(doc)));
	const reasons = s.locked.map((l) => l.reason);
	assert.ok(reasons.some((r) => /Gap\.1 has markers of its own/.test(r)), JSON.stringify(reasons));
	assert.ok(reasons.some((r) => /"S" holds markers Cut cannot read/.test(r)), JSON.stringify(reasons));
	assert.equal(s.locked.length, 2);
});

test("a split moves no marker while the clip's own element is unchanged, and a trimmed clip keeps a marker no copy holds", () => {
	const s = CutSession.open("Markers.otio", film);
	const p = load(s);
	const a = element(p, "A");
	// A duplicate of A, A itself untouched: A keeps both markers, the copy none.
	holding(p, "A").elements.push({ ...JSON.parse(JSON.stringify(a)), id: `${a.id}-copy`, startTime: a.startTime + a.duration });
	let named = (n: string) => clipsOf(s.save(p, s.media)).filter((c) => c.name === n);
	assert.deepEqual(named("A").map(marks), [["Early", "Late"], []]);
	// A trimmed to its first 24 frames: Late (at 90) is no longer in A's span but is in the copy's (A's whole span), so it moves there,
	// staying where it is in the picture; Early stays on A.
	a.duration = 24 * F;
	named = (n: string) => clipsOf(s.save(p, s.media)).filter((c) => c.name === n);
	assert.deepEqual(named("A").map(marks), [["Early"], ["Late"]]);
});
