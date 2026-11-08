// Cut's host bridge (files/016, files/999): one declared parent, the session, a save on the opened version, exports beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostBridge, plainOrigin, readDeclared, type Opened } from "../src/oneos/host-bridge.ts";

const HOST = "https://acme.oneos.example";
const FORMAT = { mime: "application/x-opencut-project", maxBytes: 1024 };

function frame() {
	const sent: Array<{ m: any; origin: string; transfer?: unknown[] }> = [];
	let listener: (e: { origin: string; source: unknown; data: unknown }) => void = () => {};
	const parent = { postMessage: (m: unknown, origin: string, transfer?: unknown[]) => sent.push({ m, origin, transfer }) };
	const win = { parent, addEventListener: (_t: "message", l: typeof listener) => { listener = l; } };
	const opened: Opened[] = [];
	const bridge = new HostBridge(win as any, { app: "cut", version: "0.1.0", parent: HOST }, FORMAT, (o) => opened.push(o));
	const from = (data: unknown, origin = HOST, source: unknown = parent) => listener({ origin, source, data });
	return { bridge, sent, opened, from };
}
const open = (f: ReturnType<typeof frame>, readOnly = false) =>
	f.from({ type: "craft:open", session: "s1", name: "trip.ocproj", mime: FORMAT.mime, bytes: new Uint8Array([1, 2]).buffer, versionId: "v1", readOnly });

test("the declared parent is a plain https origin, else there is no bridge, by name", () => {
	assert.ok(plainOrigin(HOST));
	assert.ok(!plainOrigin("https://acme.example/path"));
	assert.ok(!plainOrigin("http://acme.example"));
	assert.ok(plainOrigin("http://localhost:5173"));
	assert.match((readDeclared({}) as any).refused, /^craft-host-undeclared/);
	assert.match((readDeclared({ __craftHost: { app: "cut", version: "1", parent: "*" } }) as any).refused, /^craft-host-origin/);
	assert.deepEqual(readDeclared({ __craftHost: { app: "cut", version: "1", parent: HOST } }), { app: "cut", version: "1", parent: HOST });
});

test("ready goes to the declared origin only; an open from anyone else, or of a wrong shape or size, is dropped", () => {
	const f = frame();
	f.bridge.ready();
	assert.deepEqual(f.sent[0], { m: { type: "craft:ready", app: "cut", version: "0.1.0" }, origin: HOST, transfer: undefined });
	f.from({ type: "craft:open", session: "s1", name: "x.ocproj", bytes: new ArrayBuffer(1), versionId: "v1", readOnly: false }, "https://evil.example");
	f.from({ type: "craft:open", session: "s1", name: "x.ocproj", bytes: new ArrayBuffer(1), versionId: "v1", readOnly: false }, HOST, {});
	f.from({ type: "craft:open", session: "s1", name: "x.ocproj", bytes: "AAAA", versionId: "v1", readOnly: false });
	f.from({ type: "craft:open", session: "s1", name: "x.ocproj", bytes: new ArrayBuffer(2048), versionId: "v1", readOnly: false });
	assert.equal(f.opened.length, 0);
	open(f);
	assert.equal(f.opened.length, 1);
	assert.deepEqual([...f.opened[0].bytes], [1, 2]);
});

test("a save is the project under its own name on the version it opened; saved moves the base, refused says why", async () => {
	const f = frame();
	open(f);
	f.bridge.dirty(true);
	f.bridge.dirty(true);
	assert.equal(f.sent.filter((s) => s.m.type === "craft:dirty").length, 1, "once per change");
	const p = f.bridge.save("trip.ocproj", FORMAT.mime, new Uint8Array([9]), false);
	const save = f.sent.at(-1)!;
	assert.equal(save.m.type, "craft:save");
	assert.equal(save.m.baseVersionId, "v1");
	assert.equal(save.m.saveAs, false);
	assert.equal(save.transfer?.length, 1, "the bytes are transferred");
	f.from({ type: "craft:saved", session: "other", versionId: "v9" });
	f.from({ type: "craft:saved", session: "s1", versionId: "v2" });
	assert.deepEqual(await p, { ok: true, versionId: "v2" });
	const q = f.bridge.save("trip.ocproj", FORMAT.mime, new Uint8Array([9]), false);
	assert.equal(f.sent.at(-1)!.m.baseVersionId, "v2", "the next save's base is the version the last one made");
	f.from({ type: "craft:refused", session: "s1", code: "stale-base-version", reason: "the file moved on" });
	assert.deepEqual(await q, { ok: false, code: "stale-base-version", reason: "the file moved on" });
});

test("an export is a new file beside the project (saveAs) and never moves the project's base", async () => {
	const f = frame();
	open(f);
	const p = f.bridge.save("trip.mp4", "video/mp4", new Uint8Array([1]), true);
	assert.equal(f.sent.at(-1)!.m.saveAs, true);
	f.from({ type: "craft:saved", session: "s1", versionId: "x1" });
	await p;
	f.bridge.save("trip.ocproj", FORMAT.mime, new Uint8Array([1]), false);
	assert.equal(f.sent.at(-1)!.m.baseVersionId, "v1");
});

test("what may not be saved is refused by name and nothing is sent", async () => {
	const f = frame();
	assert.equal((await f.bridge.save("trip.ocproj", FORMAT.mime, new Uint8Array(), false) as any).code, "craft-nothing-open");
	open(f);
	assert.equal((await f.bridge.save("other.ocproj", FORMAT.mime, new Uint8Array(), false) as any).code, "craft-save-not-the-project");
	assert.equal((await f.bridge.save("trip.ocproj", "video/mp4", new Uint8Array(), false) as any).code, "craft-save-not-the-project");
	const ro = frame();
	open(ro, true);
	assert.equal((await ro.bridge.save("trip.ocproj", FORMAT.mime, new Uint8Array(), false) as any).code, "craft-read-only");
	assert.equal(ro.sent.filter((s) => s.m.type === "craft:save").length, 0);
});
