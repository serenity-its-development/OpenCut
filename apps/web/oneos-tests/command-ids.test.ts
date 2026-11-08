// Cut's command ids (files/025, files/999): every command class of the editor has ONE id, and each is either allowed to the assistant or left
// out with its reason; nothing is unnamed and nothing is named twice. The ids are measured against the source, not stated by hand.
// Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CUT_COMMAND_IDS, CUT_LEFT_OUT, CUT_RUN_COMMANDS, checkArgs } from "../src/oneos/command-ids.ts";

const SRC = join(import.meta.dirname, "..", "src", "commands");
function classes(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) return classes(p);
		return f.endsWith(".ts") ? [...readFileSync(p, "utf8").matchAll(/export class (\w+) extends Command\b/g)].map((m) => m[1]) : [];
	});
}

test("every command class of the editor has exactly one id; each id is allowed or left out with a reason", () => {
	const found = classes(SRC).sort();
	assert.equal(found.length, 40, "the editor's command classes, measured");
	assert.deepEqual(Object.values(CUT_COMMAND_IDS).sort(), found, "one id per class");
	const ids = Object.keys(CUT_COMMAND_IDS);
	const left = CUT_LEFT_OUT.flatMap((g) => g.ids);
	assert.deepEqual([...CUT_RUN_COMMANDS, ...left].sort(), [...ids].sort(), "allowed + left out = every id");
	assert.equal(new Set([...CUT_RUN_COMMANDS, ...left]).size, ids.length, "none named twice");
	for (const g of CUT_LEFT_OUT) assert.ok(g.reason.length > 20, g.reason);
	assert.equal(CUT_RUN_COMMANDS.length, 33);
	for (const id of ["media.add", "clipboard.paste", "batch"]) assert.ok(!CUT_RUN_COMMANDS.includes(id));
});

test("a step's arguments are checked by shape before any command is made, and refused by name", () => {
	assert.equal(checkArgs("track.toggleMute", { trackId: "t1" }), null);
	assert.match(checkArgs("track.toggleMute", {})!, /trackId/);
	assert.match(checkArgs("element.split", { elements: [{ trackId: "t", elementId: "e" }], splitTime: "soon" })!, /splitTime/);
	assert.equal(checkArgs("element.split", { elements: [{ trackId: "t", elementId: "e" }], splitTime: 120000 }), null);
	assert.match(checkArgs("element.update", { updates: [{ trackId: "t", elementId: "e", patch: { mediaId: "x", sourceUrl: "https://freesound.org/x.mp3" } }] })!, /address/);
	assert.match(checkArgs("nope", {})!, /not a command/);
	assert.match(checkArgs("media.add", {})!, /left out/);
});

test("the window makes exactly the allowed command ids (command-host.ts), no more and no fewer", () => {
	const src = readFileSync(join(import.meta.dirname, "..", "src", "oneos", "command-host.ts"), "utf8");
	const body = src.slice(src.indexOf("const MAKE"), src.indexOf("export const MADE_IDS"));
	const made = [...body.matchAll(/\n\t"([a-zA-Z.]+)": \(a\) =>/g)].map((m) => m[1]);
	assert.deepEqual([...made].sort(), [...CUT_RUN_COMMANDS].sort());
});
