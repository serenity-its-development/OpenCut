// files/989 (2c, speed and reverse): Film's speed and reverse in Cut. A clip's speed is its one OpenTimelineIO `LinearTimeWarp.1` (a negative
// scalar is reverse, as Film writes it), Maintain Audio Pitch Film's own switch (`metadata.filmcraft.maintain_pitch`): Cut opens them as
// the element's retime (rate, maintainPitch, reverse) and writes what it changed back as Film's own, never a retime of Cut's beside it. A
// frame hold (`FreezeFrame.1`) has no place in Cut: its track is locked, named, carried untouched. `CUT_BLESS=1` writes `cut-speed.otio`,
// which filmcraft's host test opens next (`cut_s_speed_and_reverse_open_in_film_as_its_own`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-speed.otio")));
type J = Record<string, any>;

function load(s: CutSession): J {
	const p = JSON.parse(JSON.stringify(s.project));
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type === "audio") e.volume ??= 0;
		else Object.assign(e, { transform: e.transform ?? { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: e.opacity ?? 1 });
	}
	s.baseline(p, s.media);
	return p;
}
const edit = (p: J) => p.scenes.find((sc: J) => sc.name === "Edit");
const v1 = (out: J) => out.children.find((t: J) => t.name === "Edit").tracks.children[0].children.filter((c: J) => c.OTIO_SCHEMA === "Clip.2");
const warp = (s: number) => [{ OTIO_SCHEMA: "LinearTimeWarp.1", name: "", effect_name: "LinearTimeWarp", time_scalar: s, metadata: {} }];

test("Film's speeds open in Cut as each element's retime, a frame hold locked by name; unedited, the very bytes", () => {
	const s = CutSession.open("Speed.otio", film);
	const held = s.locked.find((l) => l.scene === "Edit");
	assert.match(held?.reason ?? "", /the clip "Held" holds a frame, which Cut has no hold for/);
	const p = load(s);
	const [fast, back] = edit(p).tracks.main.elements;
	assert.deepEqual([fast.name, fast.retime], ["Fast", { rate: 2, maintainPitch: false }]);
	assert.deepEqual([back.name, back.retime], ["Back", { rate: 0.5, maintainPitch: true, reverse: true }]);
	assert.equal(fast.duration, 2 * TICKS, "the timeline duration is the clip's");
	assert.equal(fast.trimStart + fast.duration * 2 + fast.trimEnd, fast.sourceDuration, "the trims hold the span the speed reads");
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
});

test("a speed and a reverse Cut changes on Film's clips are written as Film's own time warp and pitch switch, nothing of Cut's beside", () => {
	const s = CutSession.open("Speed.otio", film);
	const p = load(s);
	const [fast, back] = edit(p).tracks.main.elements;
	const span = fast.duration * 2;
	fast.retime = { rate: 1.5, maintainPitch: false, reverse: true };
	fast.duration = Math.round(span / 1.5);
	fast.trimEnd = fast.sourceDuration - fast.trimStart - span;
	const backSpan = back.duration * 0.5;
	back.retime = undefined;
	back.startTime = fast.startTime + fast.duration;
	back.duration = backSpan;
	const bytes = s.save(p, s.media);
	const out = JSON.parse(new TextDecoder().decode(bytes));
	const [f, b] = v1(out);
	assert.deepEqual(f.effects, warp(-1.5), "reversed at 150%: Film's own time warp");
	assert.deepEqual(b.effects, [], "100% forwards: no time warp");
	assert.equal(b.metadata.filmcraft.maintain_pitch, undefined, "Maintain Audio Pitch switched off in Film's own place");
	for (const c of [f, b]) assert.equal(c.metadata.opencut?.element?.retime, undefined, "no retime of Cut's beside Film's");
	const src = JSON.parse(new TextDecoder().decode(film));
	const t2 = (d: J) => d.children.find((t: J) => t.name === "Edit").tracks.children[1];
	assert.deepEqual(t2(out), t2(src), "the held clip's track is exactly as read");
	if (process.env.CUT_BLESS) writeFileSync(join(FIX, "cut-speed.otio"), bytes);
	const again = load(CutSession.open("Speed.otio", bytes));
	const [f2, b2] = edit(again).tracks.main.elements;
	assert.deepEqual([f2.retime, b2.retime], [{ rate: 1.5, maintainPitch: false, reverse: true }, undefined], "read back as edited");
	assert.equal(f2.trimStart, fast.trimStart, "a reversed clip's span starts where it did");
});
