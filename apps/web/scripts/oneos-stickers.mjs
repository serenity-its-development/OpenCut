#!/usr/bin/env node
/**
 * OneOS (files/989; Mona 2026-11-10 "Shared set + Cut now"; coordinator: Cut's build runs `--to-cut` from the ONE OneOS set): before Cut
 * is built, the sticker set in its bundle (public/stickers/oneos/, copied by OneOS workspace/scripts/craft-stickers.mjs --to-cut) must be
 * exactly the set Cut's committed index pins (src/stickers/providers/oneos-set.ts `set.files` and `set.filesDigest`). Anything else fails
 * the build BY NAME, never an empty picker:
 *   oneos-stickers-missing     the copy is not there (run OneOS craft-stickers.mjs --to-cut <this apps/web>)
 *   oneos-stickers-not-pinned  the copy holds other files or other bytes than the pin
 * Run: node scripts/oneos-stickers.mjs [apps/web dir]   (the build script runs it first)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** The faults of the copy in `web` against the pin, by name; none when it is the pinned set. */
export function stickerFaults(web, pin) {
	const dir = path.join(web, "public", "stickers", "oneos");
	if (!fs.existsSync(dir)) return [`oneos-stickers-missing: ${dir} is not there; run OneOS workspace/scripts/craft-stickers.mjs --to-cut ${web}`];
	const files = [];
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else files.push([path.relative(dir, p).split(path.sep).join("/"), sha256(fs.readFileSync(p))]);
		}
	};
	walk(dir);
	files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	if (files.length === 0) return [`oneos-stickers-missing: ${dir} is empty; run OneOS workspace/scripts/craft-stickers.mjs --to-cut ${web}`];
	const digest = sha256(Buffer.from(files.map(([f, h]) => `${f} ${h}\n`).join("")));
	if (files.length !== pin.files || digest !== pin.filesDigest) {
		return [`oneos-stickers-not-pinned: ${dir} holds ${files.length} files (digest ${digest.slice(0, 12)}), Cut's index pins ${pin.files} (digest ${String(pin.filesDigest).slice(0, 12)}, set ${String(pin.digest).slice(0, 12)})`];
	}
	return [];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	const web = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
	const { ONEOS_STICKER_SET } = await import(pathToFileURL(path.join(web, "src", "stickers", "providers", "oneos-set.ts")).href);
	const faults = stickerFaults(web, ONEOS_STICKER_SET.set);
	if (faults.length) {
		for (const f of faults) console.error(`cut build: ${f}`);
		process.exit(1);
	}
	console.log(`cut build: sticker set ${ONEOS_STICKER_SET.set.digest.slice(0, 12)} in the bundle as pinned (${ONEOS_STICKER_SET.set.files} files)`);
}
