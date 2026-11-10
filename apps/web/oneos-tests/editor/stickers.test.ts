// files/989 (Mona 2026-11-10: "Shared set + Cut now"): Cut's picker offers OneOS's ONE sticker set (our icons + Noto Emoji, OneOS
// workspace/data/craft-stickers, in Cut's bundle by `craft-stickers.mjs --to-cut`); a sticker of it is written `oneos:<id>`. Cut's earlier
// stickers (flags, shapes, logos) are carried: a project using one opens unchanged and draws as before; the picker no longer offers flags.
// Film keeps every Cut sticker locked by name, as before (filmcraft `otio/cut.rs`; untouched here).
// Run: node --import ./apps/web/oneos-tests/editor/alias-hooks.mjs --test apps/web/oneos-tests/editor/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
const { CutSession } = await import("../../src/oneos/cut-session.ts");
const { cutToOtio } = await import("../../src/oneos/cut-otio.ts");
const { maximal, s } = await import("../cut-fixture.ts");
const { browseAll, resolveStickerId, resolveStickerIntrinsicSize, searchAll, searchStickers } = await import("../../src/stickers/index.ts");
const { buildStickerElement } = await import("../../src/timeline/element-utils.ts");
const { ONEOS_STICKER_BASE, ONEOS_STICKER_SIZE, oneosStickerSet } = await import("../../src/stickers/providers/oneos.ts");

const FIX = join(import.meta.dirname, "..", "fixtures");
const enc = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 4)}\n`);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const OLD = ["shapes:star", "flags:US", "flags:GB-SCT", "logos:/logos/opencut.svg"];

/** What the browser loader does to a fresh session's project (as cut-session.test.ts): the editor's defaults, then the baseline. */
function load(session: ReturnType<typeof CutSession.open>) {
	const p = copy(session.project) as any;
	for (const sc of p.scenes) for (const t of [sc.tracks.main, ...sc.tracks.overlay, ...sc.tracks.audio]) for (const e of t.elements) {
		if (e.type !== "audio") Object.assign(e, { transform: e.transform ?? { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: e.opacity ?? 1 });
		else e.volume ??= 0;
	}
	session.baseline(p, session.media);
	return p;
}

function stickers(p: any): any[] {
	return p.scenes.flatMap((sc: any) => [sc.tracks.main, ...sc.tracks.overlay].flatMap((t: any) => t.elements.filter((e: any) => e.type === "sticker")));
}

/** The maximal Cut project with one more sticker per id, each after the last element of the track that holds Cut's star. */
function withStickers(ids: string[]) {
	const cut = maximal();
	const track = cut.project.scenes[0].tracks.overlay.find((t: any) => t.elements.some((e: any) => e.type === "sticker"));
	assert.ok(track, "the maximal project holds a sticker");
	let at = Math.max(...track.elements.map((e: any) => e.startTime + e.duration));
	const star = track.elements.find((e: any) => e.type === "sticker");
	ids.forEach((stickerId, i) => {
		track.elements.push({ ...copy(star), id: `st-${i}`, name: `Sticker ${i}`, stickerId, startTime: at, duration: s(1) });
		at += s(1);
	});
	return cut;
}

test("an untouched Cut project saves back byte for byte, its earlier stickers and a sticker of the set alike", () => {
	for (const bytes of [new Uint8Array(readFileSync(join(FIX, "cut-project.otio"))), enc(cutToOtio(withStickers([...OLD, "oneos:noto/1f600", "oneos:solar/star-bold-duotone"]) as any))]) {
		const session = CutSession.open("trip.otio", bytes);
		assert.equal(session.mode, "cut");
		assert.deepEqual(session.save(load(session), session.media), bytes);
	}
});

test("a project using Cut's earlier sticker ids opens unchanged, and each still draws what it drew", () => {
	const bytes = enc(cutToOtio(withStickers(OLD) as any));
	const session = CutSession.open("trip.otio", bytes);
	assert.deepEqual(session.locked, []);
	const ids = stickers(session.project).map((e) => e.stickerId);
	for (const id of OLD) assert.ok(ids.includes(id), id);
	assert.equal(resolveStickerId({ stickerId: "flags:US" }), "/flags/us.svg");
	assert.equal(resolveStickerId({ stickerId: "flags:GB-SCT" }), "/flags/gb-sct.svg");
	assert.match(resolveStickerId({ stickerId: "shapes:star" }), /^data:image\/svg\+xml/);
	assert.equal(resolveStickerId({ stickerId: "logos:/logos/opencut.svg" }), "logos:/logos/opencut.svg", "a logo id resolves as upstream's provider resolves it");
	const back = CutSession.open("trip.otio", session.save(load(session), session.media));
	assert.deepEqual(stickers(back.project).map((e) => e.stickerId), ids);
});

test("a new sticker from the set is written by its id and read back as it", async () => {
	const found = await searchStickers({ query: "grinning face", category: "oneos" as any });
	const item = found.items.find((i) => i.id === "oneos:noto/1f600");
	assert.ok(item, "the picker finds Noto's grinning face");
	assert.equal(item.previewUrl, `${ONEOS_STICKER_BASE}/noto/1f600.svg`);
	assert.deepEqual(await resolveStickerIntrinsicSize({ stickerId: item.id }), { width: ONEOS_STICKER_SIZE, height: ONEOS_STICKER_SIZE });
	const el = buildStickerElement({ stickerId: item.id, name: item.name, startTime: 0 as any, intrinsicWidth: 128, intrinsicHeight: 128 });
	assert.equal(el.stickerId, "oneos:noto/1f600");

	const cut = withStickers([el.stickerId, "oneos:fluent-color/heart-48"]);
	const text = JSON.stringify(cutToOtio(cut as any), null, 4);
	assert.match(text, /"stickerId": "oneos:noto\/1f600"/);
	assert.match(text, /"stickerId": "oneos:fluent-color\/heart-48"/);
	const back = CutSession.open("trip.otio", new TextEncoder().encode(`${text}\n`));
	const ids = stickers(back.project).map((e) => e.stickerId);
	assert.ok(ids.includes("oneos:noto/1f600") && ids.includes("oneos:fluent-color/heart-48"), ids.join(", "));
	assert.equal(resolveStickerId({ stickerId: "oneos:fluent-color/heart-48" }), `${ONEOS_STICKER_BASE}/fluent-color/heart-48.svg`);
	assert.throws(() => resolveStickerId({ stickerId: "oneos:../../secret" }), /sticker-not-in-set/);
	assert.throws(() => resolveStickerId({ stickerId: "oneos:https://x.test/a" }), /sticker-not-in-set/);
});

test("the picker offers the shared set and Shapes; flags are no longer offered; the set's credits travel with it", async () => {
	const browsed = await browseAll({ recentStickers: ["flags:US"] });
	assert.deepEqual(browsed.sections.map((x) => x.id), ["recent", "oneos", "shapes"], "a flag a person used stays in Recently used");
	const searched = await searchAll({ query: "france" });
	assert.deepEqual(searched.sections.map((x) => x.id), [], "Cut's flags provider (France among them) is not offered: the set has no flags");
	const set = await oneosStickerSet();
	assert.equal(set.set.size, ONEOS_STICKER_SIZE);
	assert.equal(set.stickers.length, 3750 + 1508 + 199);
	assert.deepEqual(set.credits.map((c) => c.licence), ["Apache-2.0", "CC-BY-4.0", "MIT", "Unicode-3.0"]);
	assert.ok(set.credits.some((c) => /Solar icon set by 480 Design/.test(c.credit)));
	assert.ok(set.stickers.every(([id]) => /^(noto|solar|fluent-color)\//.test(id)));
});

test("Cut's build fails by name when the set's copy in its bundle is missing or is not the pinned set, never with an empty picker", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { createHash } = await import("node:crypto");
	const { stickerFaults } = await import("../../scripts/oneos-stickers.mjs");
	const web = mkdtempSync(join(tmpdir(), "cut-stickers-"));
	try {
		const files: [string, string][] = [["CREDITS.txt", "credits\n"], ["noto/1f600.svg", "<svg/>"]];
		const sha = (t: string) => createHash("sha256").update(t).digest("hex");
		const pin = { digest: "d".repeat(64), files: 2, filesDigest: sha(files.map(([f, b]) => `${f} ${sha(b)}\n`).join("")) };
		assert.match(stickerFaults(web, pin).join(), /^oneos-stickers-missing:/);
		mkdirSync(join(web, "public", "stickers", "oneos", "noto"), { recursive: true });
		assert.match(stickerFaults(web, pin).join(), /^oneos-stickers-missing: .* is empty/);
		for (const [f, b] of files) writeFileSync(join(web, "public", "stickers", "oneos", f), b);
		assert.deepEqual(stickerFaults(web, pin), []);
		writeFileSync(join(web, "public", "stickers", "oneos", "noto", "1f600.svg"), "<svg>changed</svg>");
		assert.match(stickerFaults(web, pin).join(), /^oneos-stickers-not-pinned:/);
	} finally {
		rmSync(web, { recursive: true, force: true });
	}
	const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"));
	assert.match(pkg.scripts.build, /^node scripts\/oneos-stickers\.mjs && next build$/, "the build checks the set first");
	const set = await oneosStickerSet();
	assert.equal(typeof set.set.filesDigest, "string");
	assert.equal(set.set.files, set.stickers.length + 4, "every sticker, three licence texts and CREDITS.txt");
});

test("the set's credits ship visibly with Cut: the sticker panel shows each source's credit and links its licence text in the bundle", async () => {
	const set = await oneosStickerSet();
	const by = (n: RegExp) => set.credits.find((c) => n.test(c.name));
	assert.equal(by(/^Noto Emoji/)?.licenceFile, "licences/noto-emoji-Apache-2.0.txt");
	assert.equal(by(/^Solar/)?.licenceFile, "licences/solar-CC-BY-4.0.txt");
	assert.equal(by(/^Fluent/)?.licenceFile, "licences/fluent-color-MIT.txt");
	assert.match(by(/^Solar/)!.credit, /by 480 Design .*CC BY 4\.0/);
	const view = readFileSync(join(import.meta.dirname, "..", "..", "src", "stickers", "components", "assets-view.tsx"), "utf8");
	assert.match(view, /<StickerCredits \/>/, "the panel renders the credits");
	assert.match(view, /\{c\.credit\}/);
	assert.match(view, /href=\{`\$\{ONEOS_STICKER_BASE\}\/\$\{c\.licenceFile\}`\}/);
});
