// files/989 (2c, speed and reverse): the editor's reverse, as Film's. A reversed clip shows its source span backwards: its first moment
// shows the span's end (a tick inside it), its last the span's start; the trims still say where the span is (`trimStart` the source before
// it). A split gives the left half the span's later source; trimming the left edge moves the span's end. Cut's speed range is the one
// `otio.ts` checks Film's speeds against. Run: node --import ./apps/web/oneos-tests/editor/alias-hooks.mjs --test ...
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
const { getSourceTimeAtClipTime, getClipTimeAtSourceTime, splitTrims, getSourceSpanAtClipTime } = await import("../../src/retime/index.ts");
const { MIN_RETIME_RATE, MAX_RETIME_RATE } = await import("../../src/retime/rate.ts");
const { computeGroupResize } = await import("../../src/timeline/group-resize/compute-resize.ts");
const { buildWaveformSampleBuckets } = await import("../../src/media/waveform-summary.ts");
const { CUT_RATE } = await import("../../src/oneos/otio.ts");
const T = 120_000;
const t = (x: number) => x as never;

test("Cut's speed range is the one Film's speeds are checked against", () => {
	assert.deepEqual([CUT_RATE.min, CUT_RATE.max], [MIN_RETIME_RATE, MAX_RETIME_RATE]);
});

test("a reversed clip shows its span backwards; asking without its duration is refused loudly", () => {
	const r = { rate: 2, reverse: true };
	assert.equal(getSourceTimeAtClipTime({ clipTime: 0, retime: r, duration: 3 * T }), 6 * T, "its first moment: the span's end");
	assert.equal(getSourceTimeAtClipTime({ clipTime: 3 * T, retime: r, duration: 3 * T }), 0, "its last: the span's start");
	assert.equal(getSourceTimeAtClipTime({ clipTime: T, retime: { rate: 2 }, duration: 3 * T }), 2 * T, "forwards as before");
	assert.equal(getClipTimeAtSourceTime({ sourceTime: 2 * T, retime: r, duration: 3 * T }), 2 * T, "and back");
	assert.throws(() => getSourceTimeAtClipTime({ clipTime: 0, retime: r }), /needs the clip's duration/);
	assert.equal(getSourceSpanAtClipTime({ clipTime: T, retime: r }), 2 * T, "a span is a span, either way");
});

test("a split gives a reversed clip's left half the span's later source", () => {
	const at = { trimStart: t(10), trimEnd: t(20), leftSourceSpan: t(100), rightSourceSpan: t(300) };
	assert.deepEqual(splitTrims({ ...at, retime: { rate: 1 } }), { left: { trimEnd: 320 }, right: { trimStart: 110 } });
	assert.deepEqual(splitTrims({ ...at, retime: { rate: 1, reverse: true } }), { left: { trimStart: 310 }, right: { trimEnd: 120 } });
});

test("trimming a reversed clip's left edge moves the span's end, its right edge the span's start", () => {
	const fps = { numerator: 30, denominator: 1 } as never;
	const member = (reverse: boolean) => ({ trackId: "t", elementId: "e", startTime: t(10 * T), duration: t(4 * T), trimStart: t(2 * T), trimEnd: t(3 * T), sourceDuration: t(9 * T), retime: { rate: 1, reverse }, leftNeighborBound: null, rightNeighborBound: null });
	const left = (reverse: boolean) => computeGroupResize({ members: [member(reverse)], side: "left", deltaTime: t(T), fps }).updates[0].patch;
	assert.deepEqual([left(false).trimStart, left(false).trimEnd], [3 * T, 3 * T], "forwards: the start of the span");
	assert.deepEqual([left(true).trimStart, left(true).trimEnd], [2 * T, 4 * T], "reversed: its end");
	const out = (reverse: boolean) => computeGroupResize({ members: [member(reverse)], side: "right", deltaTime: t(10 * T), fps }).updates[0].patch;
	assert.equal(out(false).duration, 7 * T, "forwards: extended by what lies after the span (3 s)");
	assert.equal(out(true).duration, 6 * T, "reversed: by what lies before it (2 s)");
	assert.equal(out(true).trimStart, 0);
});

test("a reversed clip's waveform is drawn backwards", () => {
	const args = { clipLeftPx: 0, clipRightPx: 100, barCount: 2, pixelsPerSecond: 50, clipDurationSec: 2, sourceStartSec: 1, sampleRate: 10, maxSampleExclusive: 1000, barStepPx: 50 };
	const fwd = buildWaveformSampleBuckets({ ...args, retime: { rate: 1 } });
	const rev = buildWaveformSampleBuckets({ ...args, retime: { rate: 1, reverse: true } });
	assert.deepEqual(rev.map((b) => [b.bucketStart, b.bucketEnd]), [...fwd].reverse().map((b) => [b.bucketStart, b.bucketEnd]));
});
