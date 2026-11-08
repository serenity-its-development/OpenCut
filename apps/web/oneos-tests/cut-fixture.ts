// The MAXIMAL Cut project the codec and session tests share (files/989): `fixtures/maximal-project.json`, which the EDITOR built - its own
// builders, its effect, mask and graphics registries, its animation code, typed against its own types (`editor/build-fixture.ts`; the
// test `editor/fixture.test.ts` proves this file IS that build). Never written by hand: a field the editor does not have cannot get in.
// Needs nothing installed, so the gate runs these tests on the pinned tree.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TICKS, type CutMedia } from "../src/oneos/cut-otio.ts";

export const F1 = "01jabcdefghjkmnpqrstvwxyz0", F2 = "01jabcdefghjkmnpqrstvwxyz1", F3 = "01jabcdefghjkmnpqrstvwxyz2";
export const s = (sec: number) => Math.round(sec * TICKS);
/** The editor's own shape of a transform (rendering/index.ts `Transform`). */
export const transform = { scaleX: 1.25, scaleY: 1.25, position: { x: 12, y: -4 }, rotate: 7.5 };
export const MAXIMAL_JSON = join(import.meta.dirname, "fixtures", "maximal-project.json");
const TEXT = readFileSync(MAXIMAL_JSON, "utf8");

/** A fresh copy of the maximal project (plain JSON, as the editor stores it). */
export function maximal(): { project: Record<string, any>; media: CutMedia[] } {
	return JSON.parse(TEXT);
}
