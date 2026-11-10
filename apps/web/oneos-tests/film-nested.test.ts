// files/989 (2c nested sequences and generators, under Mona's rule of thumb 2026-11-10: "not trying to make them one ... otherwise they
// will have to differ"): Cut has no nested sequences and draws none of Film's generators, so a track holding Film's nested sequence or one of
// its generators is LOCKED in Cut, named, and carried byte for byte; the file's other tracks stay editable. `CUT_BLESS=1` writes
// `cut-nested-film.otio`, which filmcraft's host test opens (`a_cut_edit_beside_film_s_nested_sequence_and_generators_opens_in_film`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";
import { sameValue } from "../src/oneos/otio.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-nested.otio")));
type J = Record<string, any>;

function load(s: CutSession) {
	const p = JSON.parse(JSON.stringify(s.project));
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type === "audio") e.volume ??= 0;
		else Object.assign(e, { transform: e.transform ?? { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: e.opacity ?? 1 });
	}
	s.baseline(p, s.media);
	return p;
}
const editTracks = (bytes: Uint8Array): J[] => JSON.parse(new TextDecoder().decode(bytes)).children.find((c: J) => c.name === "Edit").tracks.children;
const holds = (t: J, name: string) => (t.children as J[]).some((c) => c.name === name);

test("Film's nested sequence and its generators lock their tracks in Cut, each named; unedited, the very bytes", () => {
	const s = CutSession.open("Nested.otio", film);
	assert.equal(s.mode, "carried");
	const reasons = s.locked.map((l) => l.reason);
	assert.ok(reasons.some((r) => /Film's nested sequence "Nest"/.test(r) && /no nested sequences/.test(r)), JSON.stringify(reasons));
	assert.ok(reasons.some((r) => /"Matte" is Film's Color Matte generator/.test(r)), JSON.stringify(reasons));
	const p = load(s);
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
});

test("an edit beside them leaves the locked tracks byte for byte (cut-nested-film.otio)", () => {
	const s = CutSession.open("Nested.otio", film);
	const p = load(s);
	const t = p.scenes.flatMap((sc: J) => [sc.tracks.main, ...sc.tracks.overlay]).find((x: J) => x.elements.some((e: J) => e.name === "Plain"));
	const e = t.elements.find((x: J) => x.name === "Plain");
	e.startTime += TICKS;
	const out = s.save(p, s.media);
	const before = editTracks(film), after = editTracks(out);
	for (const name of ["Nest", "Matte"]) {
		const a = before.find((x) => holds(x, name)), b = after.find((x) => holds(x, name));
		assert.equal(JSON.stringify(b), JSON.stringify(a), `the locked track holding ${name} is carried byte for byte`);
	}
	assert.equal(after.find((x) => holds(x, "Plain"))!.children[0].OTIO_SCHEMA, "Gap.1", "the plain clip moved");
	const golden = join(FIX, "cut-nested-film.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(existsSync(golden), "the golden file (CUT_BLESS=1 writes it)");
	assert.ok(sameValue(JSON.parse(new TextDecoder().decode(out)), JSON.parse(readFileSync(golden, "utf8"))), "Cut writes the edit as pinned");
});
