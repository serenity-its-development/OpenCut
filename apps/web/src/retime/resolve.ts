import type { RetimeConfig } from "@/timeline";
import { clampRetimeRate } from "@/retime/rate";

function getSafeRate({ rate }: { rate: number }): number {
	return clampRetimeRate({ rate });
}

/**
 * OneOS (files/989, 2c "speed and reverse"): a reversed clip shows its source span backwards, as Film's reverse does: its first moment
 * shows the span's end and its last moment the span's start. The span stays where the trims put it (`trimStart` is still the source time
 * before which nothing is shown), so the mirror needs the clip's duration; asking without it is a mistake, refused loudly.
 */
function mirrored({ clipTime, duration }: { clipTime: number; duration?: number }): number {
	if (duration === undefined || !Number.isFinite(duration)) {
		throw new Error("a reversed clip's source time needs the clip's duration");
	}
	return duration - clipTime;
}

export function isReversed({ retime }: { retime?: RetimeConfig }): boolean {
	return retime?.reverse === true;
}

export function getSourceTimeAtClipTime({
	clipTime,
	retime,
	duration,
}: {
	clipTime: number;
	retime?: RetimeConfig;
	/** The clip's duration on the timeline, in the unit of `clipTime`: needed when the clip is reversed. */
	duration?: number;
}): number {
	const at = isReversed({ retime }) ? mirrored({ clipTime, duration }) : clipTime;
	return at * getSafeRate({ rate: retime?.rate ?? 1 });
}

export function getClipTimeAtSourceTime({
	sourceTime,
	retime,
	duration,
}: {
	sourceTime: number;
	retime?: RetimeConfig;
	duration?: number;
}): number {
	const at = sourceTime / getSafeRate({ rate: retime?.rate ?? 1 });
	return isReversed({ retime }) ? mirrored({ clipTime: at, duration }) : at;
}

export function getEffectiveRateAt({
	retime,
}: {
	clipTime?: number;
	retime?: RetimeConfig;
}): number {
	return getSafeRate({ rate: retime?.rate ?? 1 });
}

export function getTimelineDurationForSourceSpan({
	sourceSpan,
	retime,
}: {
	sourceSpan: number;
	retime?: RetimeConfig;
}): number {
	if (sourceSpan <= 0) {
		return 0;
	}
	return sourceSpan / getSafeRate({ rate: retime?.rate ?? 1 });
}
