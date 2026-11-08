// The assistant's run in Cut (files/025): `craft:command {method: "command.batch", params: {label, steps}}` runs every step or none, as ONE
// undo step; a step that may not run refuses the whole run before anything is done.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runBatch, type RunDeps } from "../src/oneos/command-run.ts";
import { CUT_LEFT_OUT_ACTIONS, CUT_RUN_ACTIONS } from "../src/oneos/command-ids.ts";

function deps(failAt = -1) {
	const done: string[] = [];
	let groups = 0, undone = 0;
	const d: RunDeps = {
		action: (id) => { if (done.length === failAt) throw new Error(`${id} broke`); done.push(`action:${id}`); },
		command: (id) => { if (done.length === failAt) throw new Error(`${id} broke`); done.push(`command:${id}`); },
		asOne: (fn) => { groups += 1; const before = done.length; try { fn(); } catch (e) { undone += done.length - before; done.length = before; throw e; } },
	};
	return { d, done, stats: () => ({ groups, undone }) };
}

test("the actions are exactly the editor's action registry, each run or left out with a reason", () => {
	const src = readFileSync(join(import.meta.dirname, "..", "src", "actions", "definitions.ts"), "utf8");
	const ids = [...src.slice(src.indexOf("export const ACTIONS")).matchAll(/\n\t"?([a-z0-9-]+)"?: \{/g)].map((m) => m[1]);
	assert.equal(ids.length, 30);
	assert.deepEqual([...CUT_RUN_ACTIONS, ...CUT_LEFT_OUT_ACTIONS.flatMap((g) => g.ids)].sort(), ids.sort());
});

test("a run of actions and commands is done in order as ONE undo step", () => {
	const { d, done, stats } = deps();
	const r = runBatch({ label: "Tidy", steps: [{ name: "select-all" }, { name: "track.toggleMute", args: { trackId: "t1" } }, { name: "split" }] }, d);
	assert.deepEqual(r, { ok: true, result: { label: "Tidy", ran: 3 } });
	assert.deepEqual(done, ["action:select-all", "command:track.toggleMute", "action:split"]);
	assert.deepEqual(stats(), { groups: 1, undone: 0 });
});

test("a step that may not run refuses the whole run before anything is done, by name", () => {
	for (const [steps, part] of [
		[[{ name: "select-all" }, { name: "media.add", args: {} }], /left out/],
		[[{ name: "select-all" }, { name: "undo" }], /'undo' is not a step Cut lets the assistant run/],
		[[{ name: "track.toggleMute", args: { trackId: "/etc/passwd" } }], /names a file or an address/],
		[[{ name: "select-all", args: { x: 1 } }], /takes no arguments/],
	] as const) {
		const { d, done, stats } = deps();
		const r = runBatch({ label: "x", steps }, d);
		assert.equal(r.ok, false);
		assert.match(!r.ok ? r.error : "", part);
		assert.deepEqual(done, []);
		assert.equal(stats().groups, 0);
	}
	for (const bad of [null, {}, { label: "x", steps: [] }, { label: "x", steps: new Array(201).fill({ name: "split" }) }, { label: 3, steps: [{ name: "split" }] }]) {
		assert.equal(runBatch(bad, deps().d).ok, false);
	}
});

test("a step that fails while running undoes the steps before it: nothing of the run is kept", () => {
	const { d, done, stats } = deps(1);
	const r = runBatch({ label: "Two", steps: [{ name: "select-all" }, { name: "track.toggleMute", args: { trackId: "t1" } }] }, d);
	assert.equal(r.ok, false);
	assert.match(!r.ok ? r.error : "", /step 2 \(track\.toggleMute\) failed: track\.toggleMute broke; nothing of the run was kept/);
	assert.deepEqual(done, []);
	assert.deepEqual(stats(), { groups: 1, undone: 1 });
});
