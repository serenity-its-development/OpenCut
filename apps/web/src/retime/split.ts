import type { RetimeConfig } from "@/timeline";
import { addMediaTime, type MediaTime } from "@/wasm";
import { getEffectiveRateAt } from "./resolve";

/**
 * OneOS (files/989, 2c): the trims a split gives its halves. Forwards, the left half ends sooner in its source (`trimEnd` grows by the right
 * half's span) and the right half starts later (`trimStart` grows by the left's). A reversed clip shows its span backwards, so its left half
 * shows the span's later source: the left half's `trimStart` grows by the right half's span and the right half's `trimEnd` by the left's.
 */
export function splitTrims({
	trimStart,
	trimEnd,
	leftSourceSpan,
	rightSourceSpan,
	retime,
}: {
	trimStart: MediaTime;
	trimEnd: MediaTime;
	leftSourceSpan: MediaTime;
	rightSourceSpan: MediaTime;
	retime?: RetimeConfig;
}): { left: { trimStart?: MediaTime; trimEnd?: MediaTime }; right: { trimStart?: MediaTime; trimEnd?: MediaTime } } {
	return retime?.reverse === true
		? { left: { trimStart: addMediaTime({ a: trimStart, b: rightSourceSpan }) }, right: { trimEnd: addMediaTime({ a: trimEnd, b: leftSourceSpan }) } }
		: { left: { trimEnd: addMediaTime({ a: trimEnd, b: rightSourceSpan }) }, right: { trimStart: addMediaTime({ a: trimStart, b: leftSourceSpan }) } };
}

export function getSourceSpanAtClipTime({
	clipTime,
	retime,
}: {
	clipTime: number;
	retime?: RetimeConfig;
}): number {
	// A span of source, forwards or reversed alike (a reversed clip shows the same span backwards).
	return Math.max(0, clipTime * getEffectiveRateAt({ retime }));
}

export function splitRetimeAtClipTime({
	retime,
}: {
	retime?: RetimeConfig;
	splitClipTime: number;
}): {
	left: RetimeConfig | undefined;
	right: RetimeConfig | undefined;
} {
	return { left: retime, right: retime };
}

export function adjustRetimeForTrimChange({
	retime,
}: {
	retime?: RetimeConfig;
	clipTrimTime: number;
	side: "start" | "end";
}): RetimeConfig | undefined {
	return retime;
}
