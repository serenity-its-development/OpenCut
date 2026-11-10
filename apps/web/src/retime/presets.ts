import type { RetimeConfig } from "@/timeline";
import { clampRetimeRate } from "@/retime/rate";

export function buildConstantRetime({
	rate,
	maintainPitch = false,
	reverse = false,
}: {
	rate: number;
	maintainPitch?: boolean;
	reverse?: boolean;
}): RetimeConfig {
	return { rate: clampRetimeRate({ rate }), maintainPitch, ...(reverse ? { reverse: true } : {}) };
}
