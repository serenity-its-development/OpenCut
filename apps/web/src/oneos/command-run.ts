/**
 * The assistant's run in Cut (OneOS doctrine files/025): `command.batch {label, steps}`, each step `{name, args?}` naming an action of the
 * editor (`CUT_RUN_ACTIONS`) or a command id (`CUT_RUN_COMMANDS`). Every step is judged before anything runs, and one that may not run refuses
 * the WHOLE run by name; then the steps run in order as ONE undo step, and a step that fails undoes the ones before it. Pure: what runs a step
 * is handed in (`command-host.ts`).
 */
import { CUT_RUN_ACTIONS, checkArgs } from "./command-ids.ts";

export interface RunDeps {
	action(id: string, args: Record<string, unknown> | undefined): void;
	command(id: string, args: Record<string, unknown>): void;
	/** Run `fn` as ONE undo step; if it throws, undo what it did and throw again. */
	asOne(fn: () => void): void;
}

export type RunAnswer = { ok: true; result: { label: string; ran: number } } | { ok: false; error: string };

export const RUN_STEPS_MAX = 200;
const ACTIONS = new Set(CUT_RUN_ACTIONS);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function runBatch(params: unknown, deps: RunDeps): RunAnswer {
	if (!isObj(params) || typeof params.label !== "string" || !Array.isArray(params.steps)) return { ok: false, error: "a run is {label, steps}" };
	const steps = params.steps as unknown[];
	if (!steps.length || steps.length > RUN_STEPS_MAX) return { ok: false, error: `a run has 1 to ${RUN_STEPS_MAX} steps` };
	const plan: Array<{ kind: "action" | "command"; name: string; args: Record<string, unknown> | undefined }> = [];
	for (const [i, s] of steps.entries()) {
		if (!isObj(s) || typeof s.name !== "string") return { ok: false, error: `step ${i + 1} names no command - nothing was run` };
		const args = s.args === undefined ? undefined : s.args;
		if (args !== undefined && !isObj(args)) return { ok: false, error: `step ${i + 1} (${s.name}): its arguments are not an object - nothing was run` };
		if (ACTIONS.has(s.name)) {
			if (args && Object.keys(args).length) return { ok: false, error: `step ${i + 1} (${s.name}) takes no arguments - nothing was run` };
			plan.push({ kind: "action", name: s.name, args: undefined });
			continue;
		}
		if (!/\./.test(s.name) && s.name !== "batch") return { ok: false, error: `step ${i + 1}: '${s.name}' is not a step Cut lets the assistant run - nothing was run` };
		const why = checkArgs(s.name, args ?? {});
		if (why) return { ok: false, error: `step ${i + 1}: ${why} - nothing was run` };
		plan.push({ kind: "command", name: s.name, args: args ?? {} });
	}
	let at = 0;
	try {
		deps.asOne(() => {
			for (const [i, p] of plan.entries()) {
				at = i;
				if (p.kind === "action") deps.action(p.name, undefined);
				else deps.command(p.name, p.args ?? {});
			}
		});
	} catch (e) {
		return { ok: false, error: `step ${at + 1} (${plan[at].name}) failed: ${(e as Error).message}; nothing of the run was kept` };
	}
	return { ok: true, result: { label: params.label, ran: plan.length } };
}
