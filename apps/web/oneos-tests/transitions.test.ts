/**
 * files/989 (Mona 2026-11-10: "Simple ones only"): Cut's transitions. Cut draws Film's simple kinds exactly as Film does: the weights each
 * side takes at a progress are Film's (filmcraft `render/src/plan.rs` `push_tracks`, `render/src/transitions/legacy.rs`, `render/src/
 * transitions.rs` `audio_gains`), placed at a cut, changed, removed, and gone with their place.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	dipLayers,
	handleRoom,
	settleTransitions,
	transitionShares,
	transitionWindow,
	withTransitionAdded,
	withTransitionChanged,
	withTransitionRemoved,
	type TrackTransition,
} from "../src/timeline/transitions.ts";

const S = 120_000;
const el = (id: string, startTime: number, duration: number, more: object = {}) => ({ id, type: "video", name: id, mediaId: "m", startTime, duration, trimStart: S, trimEnd: S, ...more });
const video = (transitions: TrackTransition[] = []) => ({ id: "v", name: "V1", type: "video", muted: false, hidden: false, elements: [el("a", 0, 2 * S), el("b", 2 * S, 2 * S)], transitions }) as any;
const sound = (transitions: TrackTransition[] = []) => ({ id: "s", name: "A1", type: "audio", muted: false, elements: [el("a", 0, 2 * S, { type: "audio" }), el("b", 2 * S, 2 * S, { type: "audio" })], transitions }) as any;
const x = (kind: TrackTransition["kind"], fromId: string | null, toId: string | null, before: number, after: number): TrackTransition => ({ id: "x", kind, fromId, toId, before, after });
const P = [0, 0.1, 0.25, 0.4, 0.499, 0.5, 0.6, 0.75, 0.9, 0.999];
const near = (a: number | null, b: number | null, what: string) => {
	if (a === null || b === null) return assert.equal(a, b, what);
	assert.ok(Math.abs(a - b) < 1e-12, `${what}: ${a} vs ${b}`);
};

test("a cross dissolve: the outgoing picture at full, the incoming over it at p (Film's plan.rs); with nothing coming in, the outgoing at 1 - p", () => {
	const t = video([x("cross-dissolve", "a", "b", S / 2, S / 2)]);
	const shares = transitionShares(t);
	const [a, b] = [shares.get("a")!, shares.get("b")!];
	assert.deepEqual([a.head, a.tail, b.head, b.tail], [0, S / 2, S / 2, 0], "each plays into its handle for the window");
	for (const p of P) {
		const at = 1.5 * S + p * S;
		near(a.at(at), 1, `A at ${p}`);
		near(b.at(at), p, `B at ${p}`);
	}
	assert.equal(a.at(1.4 * S), 1, "outside the window, the element's own span");
	assert.equal(b.at(1.4 * S), null, "B is not drawn before its window");
	const out = transitionShares({ ...t, elements: [t.elements[0]], transitions: [x("cross-dissolve", "a", null, S, 0)] });
	for (const p of P) near(out.get("a")!.at(S + p * S), 1 - p, `a fade to nothing at ${p}`);
	const inn = transitionShares({ ...t, elements: [t.elements[1]], transitions: [x("cross-dissolve", null, "b", 0, S)] });
	for (const p of P) near(inn.get("b")!.at(2 * S + p * S), p, `a fade from nothing at ${p}`);
});

test("a dip: the colour over the frame beneath the track's pictures, the outgoing at 1 - 2p in the first half, the incoming at 2p - 1 in the second (legacy.rs)", () => {
	for (const [kind, color] of [["dip-to-black", "#000000"], ["dip-to-white", "#ffffff"]] as const) {
		const t = video([x(kind, "a", "b", S / 2, S / 2)]);
		assert.deepEqual(dipLayers(t), [{ start: 1.5 * S, end: 2.5 * S, color, beneath: "a" }]);
		const shares = transitionShares(t);
		for (const p of P) {
			const at = 1.5 * S + p * S;
			near(shares.get("a")!.at(at), p < 0.5 ? 1 - p * 2 : null, `${kind} A at ${p}`);
			near(shares.get("b")!.at(at), p < 0.5 ? null : (p - 0.5) * 2, `${kind} B at ${p}`);
		}
	}
});

test("the audio crossfades: constant power cos/sin(p·π/2), constant gain 1 - p and p (transitions.rs audio_gains)", () => {
	const power = transitionShares(sound([x("constant-power", "a", "b", S / 2, S / 2)]));
	const gain = transitionShares(sound([x("constant-gain", "a", "b", S / 2, S / 2)]));
	for (const p of P) {
		const at = 1.5 * S + p * S;
		near(power.get("a")!.at(at), Math.cos((p * Math.PI) / 2), `power out ${p}`);
		near(power.get("b")!.at(at), Math.sin((p * Math.PI) / 2), `power in ${p}`);
		near(gain.get("a")!.at(at), 1 - p, `gain out ${p}`);
		near(gain.get("b")!.at(at), p, `gain in ${p}`);
	}
});

test("a transition's place: its kind is its track's, its sides meet at one cut, its window fits each side; a reversed clip's head is the medium after its span", () => {
	assert.match(transitionWindow(video(), x("constant-power", "a", "b", 1, 1)) as string, /not a picture's transition/);
	assert.match(transitionWindow(sound(), x("dip-to-black", "a", "b", 1, 1)) as string, /not a sound's transition/);
	assert.match(transitionWindow(video(), x("cross-dissolve", "a", "b", 3 * S, 1)) as string, /past the start of the outgoing/);
	const apart = { ...video(), elements: [el("a", 0, 2 * S), el("b", 3 * S, 2 * S)] };
	assert.match(transitionWindow(apart, x("cross-dissolve", "a", "b", 1, 1)) as string, /no longer meet/);
	assert.deepEqual(handleRoom(el("r", 0, S, { trimStart: 2 * S, trimEnd: S, retime: { rate: 2, reverse: true } })), { head: S / 2, tail: S });
	assert.deepEqual(handleRoom(el("i", 0, S, { type: "image" })), { head: Infinity, tail: Infinity });
});

test("placed at a cut (Film's one second, centred), changed in kind and length (still centred, or at its edge), removed; refused by name where it cannot be", () => {
	const t = withTransitionAdded(video(), { id: "n", kind: "cross-dissolve", fromId: "a", toId: "b" });
	assert.deepEqual(t.transitions, [{ id: "n", kind: "cross-dissolve", fromId: "a", toId: "b", before: S / 2, after: S / 2 }]);
	assert.throws(() => withTransitionAdded(t, { id: "m", kind: "dip-to-black", fromId: "a", toId: "b" }), /already has a transition/);
	const longer = withTransitionChanged(t, "n", { kind: "dip-to-white", duration: S * 1.5 });
	assert.deepEqual(longer.transitions[0], { id: "n", kind: "dip-to-white", fromId: "a", toId: "b", before: S * 0.75, after: S * 0.75 });
	assert.throws(() => withTransitionChanged(t, "n", { duration: 3 * S }), /too little of its medium/, "the handles bound it");
	const edge = withTransitionAdded(video(), { id: "e", kind: "cross-dissolve", fromId: "b", toId: null, duration: S / 4 });
	assert.deepEqual([edge.transitions[0].before, edge.transitions[0].after], [S / 4, 0], "at an edge it lies inside the element");
	assert.deepEqual(withTransitionChanged(edge, "e", { duration: S }).transitions[0].before, S);
	assert.equal(withTransitionRemoved(t, "n").transitions.length, 0);
	assert.throws(() => withTransitionRemoved(t, "z"), /no transition z/);
	assert.throws(() => withTransitionAdded(sound(), { id: "q", kind: "cross-dissolve", fromId: "a", toId: "b" }), /not a sound's/);
});

test("an edit that takes a transition's place takes the transition (the editor's one door for tracks settles them)", () => {
	const t = video([x("cross-dissolve", "a", "b", S / 2, S / 2)]);
	const tracks = { main: t, overlay: [], audio: [] } as any;
	assert.equal(settleTransitions(tracks), tracks, "nothing to settle: the very tracks");
	const moved = settleTransitions({ ...tracks, main: { ...t, elements: [t.elements[0], { ...t.elements[1], startTime: 3 * S }] } });
	assert.deepEqual(moved.main.transitions, []);
	const removed = settleTransitions({ ...tracks, main: { ...t, elements: [t.elements[0]] } });
	assert.deepEqual(removed.main.transitions, []);
});
