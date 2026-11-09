// files/989 step 2d (Mona 2026-11-10, relayed: "Build linked audio, lock multicam"): Film's multicam clip stays LOCKED in Cut, named, and is
// carried untouched; Cut builds no multicam. `fixtures/film-multicam.otio` is byte for byte filmcraft's
// `crates/interchange/tests/it/oneos/film-multicam.otio` (its test `oneos_film_writes_its_multicam_clip_for_cut` pins Film's writer to it):
// "Edit" holds a multicam clip of "Cams" (angles Wide and Close, showing Close) on its first video track and a plain clip on its second.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-multicam.otio")));
type J = Record<string, any>;

function load(s: CutSession): J {
	const p = JSON.parse(JSON.stringify(s.project));
	s.baseline(p, s.media);
	return p;
}
const timeline = (doc: J, name: string): J => doc.children.find((t: J) => t.name === name);

test("Film's multicam clip locks its track in Cut, named with its cameras and angle; the rest stays editable; unedited, the very bytes", () => {
	const s = CutSession.open("Multicam.otio", film);
	const edit = s.locked.filter((l) => l.scene === "Edit");
	assert.equal(edit.length, 1, "only the track holding the multicam clip");
	assert.match(edit[0].reason, /Film's multicam clip "Cams" \(cameras: Wide, Close, showing Close\)/);
	assert.ok(!s.locked.some((l) => /multicam/.test(l.reason) && l.scene !== "Edit"), "the source sequence's own tracks are not a multicam clip");
	const p = load(s);
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
});

test("an edit beside Film's multicam clip carries it untouched", () => {
	const s = CutSession.open("Multicam.otio", film);
	const p = load(s);
	const scene = p.scenes.find((sc: J) => sc.name === "Edit");
	const plain = [scene.tracks.main, ...scene.tracks.overlay].flatMap((t: J) => t.elements);
	assert.equal(plain.length, 1, "the plain clip is Cut's to edit");
	plain[0].duration -= TICKS / 4;
	const out = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const before = JSON.parse(new TextDecoder().decode(film));
	assert.deepEqual(timeline(out, "Edit").tracks.children[0], timeline(before, "Edit").tracks.children[0], "the multicam track, exactly as Film wrote it");
	assert.deepEqual(out.metadata, before.metadata, "Film's project, untouched");
	assert.notDeepEqual(timeline(out, "Edit").tracks.children[1], timeline(before, "Edit").tracks.children[1], "the edit is saved");
});
