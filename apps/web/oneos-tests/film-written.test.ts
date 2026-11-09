// files/989, Film -> Cut -> Film on a file FILM wrote: `fixtures/film-written.otio` is byte for byte filmcraft's
// `crates/interchange/tests/it/oneos/film-written.otio` (its test `oneos_film_writes_the_file_cut_reads` pins Film's writer to it). Cut opens
// it, saves it unedited as the very bytes, and saves an edit as `fixtures/cut-edited.otio`, the file filmcraft's host test opens in Film
// (`a_file_cut_edited_opens_in_film_and_saves_back_value_for_value`). `CUT_BLESS=1` writes that golden file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";
import { sameValue } from "../src/oneos/otio.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-written.otio")));

/** What the browser loader does to a fresh project: the editor's defaults on each element. */
function load(s: CutSession) {
	const p = JSON.parse(JSON.stringify(s.project));
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type === "audio") e.volume ??= 0; // the editor's default: 0 dB (timeline/defaults.ts)
		else Object.assign(e, { transform: e.transform ?? { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: e.opacity ?? 1 });
	}
	s.baseline(p, s.media);
	return p;
}

test("Cut opens the file Film wrote: its media are OneOS files, the transition track is carried locked, and unedited it saves the very bytes", () => {
	const s = CutSession.open("Trip.otio", film);
	assert.equal(s.mode, "carried");
	assert.deepEqual(s.project.scenes.map((sc: { name: string }) => sc.name), ["Edit", "Alt"]);
	assert.ok(s.locked.some((l) => l.scene === "Edit" && /Transition\.1/.test(l.reason)), JSON.stringify(s.locked));
	assert.ok(s.media.length >= 2 && s.media.every((m) => /^[0-9a-z]{26}$/.test(m.file.id)));
	assert.deepEqual(s.save(load(s), s.media), film);
});

test("an edit Cut makes to Film's file is pinned as the file Film opens next (cut-edited.otio)", () => {
	const s = CutSession.open("Trip.otio", film);
	const p = load(s);
	const main = p.scenes[0].tracks.main;
	main.elements[0].duration -= TICKS / 2;
	p.scenes[0].tracks.overlay.push({ id: "titles", name: "Titles", type: "text", hidden: false, elements: [
		{ id: "t1", type: "text", name: "Title", content: "Trip", fontSize: 64, fontFamily: "Inter", color: "#ffffff", background: { enabled: false, color: "#000000" }, textAlign: "center", fontWeight: "bold", fontStyle: "normal", textDecoration: "none", hidden: false, transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: 1, startTime: 0, duration: TICKS, trimStart: 0, trimEnd: 0 },
	] });
	p.scenes.push({ id: "teaser", name: "Teaser", isMain: false, createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z", bookmarks: [{ time: TICKS, note: "hook" }],
		tracks: { main: { ...JSON.parse(JSON.stringify(main)), id: "teaser-main", elements: main.elements.slice(0, 1).map((e: object) => ({ ...e, id: "tz1", startTime: 0, link: undefined })) }, overlay: [], audio: [] } });
	const out = s.save(p, s.media);
	const golden = join(FIX, "cut-edited.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(existsSync(golden), "the golden Cut-edited file (CUT_BLESS=1 writes it)");
	assert.ok(sameValue(JSON.parse(new TextDecoder().decode(out)), JSON.parse(readFileSync(golden, "utf8"))), "Cut writes the edit as it is pinned");
	const again = CutSession.open("Trip.otio", out);
	assert.equal(again.project.scenes[0].tracks.overlay.find((t: { name: string }) => t.name === "Titles").elements[0].content, "Trip");
	assert.equal(again.project.scenes.at(-1).name, "Teaser");
});

// files/989 (Mona: "yes, so this becomes a tool choice not a file type choicer"): Cut edits Film's audio volume and track mute IN FILM'S OWN
// SHAPE. A Film clip's gain (metadata.filmcraft.gain_db) and Cut's volume are both decibels, so Cut's volume IS Film's gain; a Film track's
// mute is Film's switch (metadata.filmcraft.muted). Neither gets a second copy of Cut's beside it.
test("Cut edits a Film clip's gain and a Film track's mute as Film's own values", () => {
	const s = CutSession.open("Trip.otio", film);
	const p = load(s);
	const music = p.scenes[0].tracks.audio[0];
	assert.equal(music.elements[0].volume, 0, "Film's 0 dB gain is Cut's volume");
	assert.equal(music.muted, false);
	music.elements[0].volume = -6.5;
	music.muted = true;
	const out = JSON.parse(new TextDecoder().decode(s.save(p, s.media)));
	const raw = JSON.parse(new TextDecoder().decode(film));
	const at = raw.children[0].tracks.children.findIndex((t: { name: string; kind: string }) => t.kind === "Audio" && t.name === music.name);
	const track = out.children[0].tracks.children[at];
	assert.equal(track.metadata.filmcraft.muted, true, "the mute is Film's switch");
	assert.equal(track.metadata.opencut?.track?.muted, undefined, "no second mute of Cut's");
	const clip = track.children.find((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === "Clip.2");
	assert.equal(clip.metadata.filmcraft.gain_db, -6.5, "the volume is Film's gain");
	assert.equal(clip.metadata.opencut?.element?.volume, undefined, "no second volume of Cut's");
	const again = CutSession.open("Trip.otio", new TextEncoder().encode(JSON.stringify(out)));
	assert.equal(again.project.scenes[0].tracks.audio[0].elements[0].volume, -6.5);
	assert.equal(again.project.scenes[0].tracks.audio[0].muted, true);
});

test("a Film gain outside Cut's volume range (-60 to 20 dB) locks its track, named, rather than being clamped", () => {
	const raw = JSON.parse(new TextDecoder().decode(film));
	const track = raw.children[0].tracks.children.find((t: { kind: string; children: unknown[] }) => t.kind === "Audio" && t.children.length);
	track.children.find((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA === "Clip.2").metadata.filmcraft.gain_db = 30;
	const s = CutSession.open("Trip.otio", new TextEncoder().encode(JSON.stringify(raw)));
	assert.ok(s.locked.some((l) => /gain of 30 dB .* outside Cut's volume range/.test(l.reason)), JSON.stringify(s.locked));
});
