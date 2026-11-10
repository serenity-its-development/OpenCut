// files/989 (Mona 2026-11-10: "Simple ones only"): Film's transitions in Cut. Cut edits Film's simple kinds (Cross Dissolve, Dip to Black,
// Dip to White; Constant Power, Constant Gain) where Film wrote them, as its own transitions, and writes what it changed back in Film's
// shape; a track holding any other of Film's kinds stays locked, named, and is carried byte for byte. `CUT_BLESS=1` writes
// `cut-transitions-film.otio`, which filmcraft's host test opens next (`a_cut_edit_of_film_s_transitions_opens_in_film_as_film_s_own`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";
import { TICKS } from "../src/oneos/cut-otio.ts";
import { sameValue } from "../src/oneos/otio.ts";
import { withTransitionAdded, withTransitionChanged, withTransitionRemoved } from "../src/timeline/transitions.ts";

const FIX = join(import.meta.dirname, "fixtures");
const film = new Uint8Array(readFileSync(join(FIX, "film-transitions.otio")));
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
const idOf = (t: J, name: string) => t.elements.find((e: J) => e.name === name).id;
const fileTracks = (bytes: Uint8Array): J[] => {
	const doc = JSON.parse(new TextDecoder().decode(bytes));
	return doc.children.find((c: J) => c.name === "Edit").tracks.children;
};
const holds = (t: J, name: string) => (t.children as J[]).some((c) => c.name === name);

test("Film's simple transitions open as Cut's at their cuts; a track holding another of Film's kinds stays locked, named; unedited, the very bytes", () => {
	const s = CutSession.open("Transitions.otio", film);
	assert.equal(s.mode, "carried");
	const reasons = s.locked.map((l) => l.reason);
	assert.ok(reasons.some((r) => /Iris Round/.test(r) && /iris_round/.test(r) && /simple transitions/.test(r)), JSON.stringify(reasons));
	assert.ok(reasons.some((r) => /Exponential Fade/.test(r) && /exponential_fade/.test(r)), JSON.stringify(reasons));
	assert.equal(s.locked.length, 2, "only those two tracks");
	const p = load(s);
	const v1 = holding(p, "A"), v2 = holding(p, "D"), a1 = holding(p, "S1");
	const pick = (t: J) => t.transitions.map((x: J) => [x.kind, x.fromId && t.elements.find((e: J) => e.id === x.fromId).name, x.toId && t.elements.find((e: J) => e.id === x.toId).name, x.before / F, x.after / F]);
	assert.deepEqual(pick(v1), [["cross-dissolve", "A", "B", 4, 4], ["dip-to-black", "B", "C", 6, 6]]);
	assert.deepEqual(pick(v2), [["dip-to-white", null, "D", 0, 12], ["cross-dissolve", "D", null, 12, 0]]);
	assert.deepEqual(pick(a1), [["constant-power", "S1", "S2", 4, 4], ["constant-gain", "S2", null, 12, 0]]);
	assert.deepEqual(s.save(p, s.media), film, "unedited: the very bytes");
});

test("Cut's edit of Film's transitions is written in Film's shape, and the tracks it cannot edit come back byte for byte (cut-transitions-film.otio)", () => {
	const s = CutSession.open("Transitions.otio", film);
	const p = load(s);
	const swap = (t: J, next: J) => Object.assign(t, next);
	const v1 = holding(p, "A"), v2 = holding(p, "D"), a1 = holding(p, "S1");
	// The cross dissolve becomes a dip to white half a second long; the dip to black is removed; V2's fade out is removed and a cross
	// dissolve of 6 frames put at D's end in its place; A1's crossfade becomes Constant Gain, two frames shorter.
	swap(v1, withTransitionChanged(v1 as never, v1.transitions[0].id, { kind: "dip-to-white", duration: TICKS / 2 }));
	swap(v1, withTransitionRemoved(v1 as never, v1.transitions[1].id));
	swap(v2, withTransitionRemoved(v2 as never, v2.transitions[1].id));
	swap(v2, withTransitionAdded(v2 as never, { id: "new", kind: "cross-dissolve", fromId: idOf(v2, "D"), toId: null, duration: 6 * F }));
	swap(a1, withTransitionChanged(a1 as never, a1.transitions[0].id, { kind: "constant-gain", duration: 6 * F }));
	const out = s.save(p, s.media);
	const before = fileTracks(film), after = fileTracks(out);
	for (const name of ["E", "S3"]) {
		const a = before.find((t) => holds(t, name)), b = after.find((t) => holds(t, name));
		assert.equal(JSON.stringify(b), JSON.stringify(a), `the locked track holding ${name} is carried byte for byte`);
	}
	const x = (t: J) => (t.children as J[]).filter((c) => c.OTIO_SCHEMA === "Transition.1");
	const [w] = x(after.find((t) => holds(t, "A")) as J);
	assert.equal(x(after.find((t) => holds(t, "A")) as J).length, 1);
	assert.deepEqual([w.name, w.transition_type, w.in_offset.value, w.out_offset.value, w.in_offset.rate], ["Dip to White", "Custom_Transition", 6, 6, 24]);
	assert.deepEqual(w.metadata, { filmcraft: { align: "CenterAtCut", effect: { effect: "dip_to_white", enabled: true, params: {} }, reverse: false } }, "Film's own shape, nothing of Cut's");
	const v2out = after.find((t) => holds(t, "D")) as J;
	assert.deepEqual(v2out.children.map((c: J) => c.OTIO_SCHEMA), ["Gap.1", "Transition.1", "Clip.2", "Transition.1"]);
	assert.equal(JSON.stringify(v2out.children[1]), JSON.stringify(fileTracks(film).find((t) => holds(t, "D"))!.children[1]), "the untouched fade in is its own bytes");
	assert.deepEqual([v2out.children[3].name, v2out.children[3].in_offset.value, v2out.children[3].out_offset.value, v2out.children[3].metadata.filmcraft.align], ["Cross Dissolve", 6, 0, "EndAtCut"]);
	const [c] = x(after.find((t) => holds(t, "S1")) as J);
	assert.deepEqual([c.name, c.transition_type, c.metadata.filmcraft.effect.effect, c.in_offset.value + c.out_offset.value], ["Constant Gain", "SMPTE_Dissolve", "constant_gain", 6]);
	const golden = join(FIX, "cut-transitions-film.otio");
	if (process.env.CUT_BLESS) writeFileSync(golden, out);
	assert.ok(existsSync(golden), "the golden file (CUT_BLESS=1 writes it)");
	assert.ok(sameValue(JSON.parse(new TextDecoder().decode(out)), JSON.parse(readFileSync(golden, "utf8"))), "Cut writes the edit as pinned");
	const again = CutSession.open("Transitions.otio", out);
	assert.equal(again.locked.length, 2);
	const q = load(again);
	assert.deepEqual(holding(q, "A").transitions.map((t: J) => [t.kind, t.before, t.after]), [["dip-to-white", TICKS / 4, TICKS / 4]]);
	assert.deepEqual(again.save(q, again.media), out, "Cut's save reopens, and unedited it is the very bytes");
});

test("a Film transition Cut cannot place (its window past its clip) keeps its track locked, named, rather than be dropped", () => {
	const doc = JSON.parse(new TextDecoder().decode(film));
	const edit = doc.children.find((c: J) => c.name === "Edit");
	const v1 = edit.tracks.children.find((t: J) => holds(t, "A"));
	v1.children[1].in_offset.value = 60;
	const s = CutSession.open("Transitions.otio", new TextEncoder().encode(JSON.stringify(doc)));
	assert.ok(s.locked.some((l) => /Cross Dissolve/.test(l.reason) && /past the start of the outgoing/.test(l.reason)), JSON.stringify(s.locked));
});

test("a Cut project's transitions are written in Film's shape among its track's children and read back whole", async () => {
	const { cutToOtio, otioToCut } = await import("../src/oneos/cut-otio.ts");
	const el = (id: string, startTime: number) => ({ id, type: "video", name: id, mediaId: "m", startTime, duration: 2 * TICKS, trimStart: TICKS, trimEnd: TICKS });
	const main = { id: "main", name: "Main", type: "video", muted: false, hidden: false, elements: [el("a", 0), el("b", 2 * TICKS)], transitions: [{ id: "main-x0", kind: "dip-to-black", fromId: "a", toId: "b", before: TICKS / 2, after: TICKS / 2 }] };
	const project = { metadata: { name: "P" }, scenes: [{ id: "s", name: "S", isMain: true, bookmarks: [], tracks: { main, overlay: [], audio: [] } }] };
	const media = [{ id: "m", name: "m", type: "video", file: { id: "01jabcdefghjkmnpqrstvwxy10", version: "1" } }];
	const doc = cutToOtio({ project, media });
	const kids = doc.children[0].tracks.children[0].children;
	assert.deepEqual(kids.map((c: J) => c.OTIO_SCHEMA), ["Clip.2", "Transition.1", "Clip.2"]);
	assert.equal(kids[1].metadata.filmcraft.effect.effect, "dip_to_black");
	assert.equal(doc.children[0].tracks.children[0].metadata.opencut.track.transitions, undefined, "not a second copy in Cut's metadata");
	assert.deepEqual(otioToCut(doc).project.scenes[0].tracks.main.transitions, main.transitions);
});
