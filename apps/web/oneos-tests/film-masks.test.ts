// files/989 part 2 ("Masks, both ways"): Cut opens the masks FILM edited and added on Cut's project, as Cut's own. `fixtures/film-masked-cut.otio`
// is byte for byte filmcraft's `crates/interchange/tests/it/oneos/film-masked-cut.otio`, written by its host test
// `film_edits_cut_s_masks_as_its_own_and_writes_them_in_cut_s_shape`: Film changed the feather of Beach's rectangle and added a subtracting
// mask to Beach and to the Logo. Cut opens it in its PROJECT mode, holds Film's feather in the canvas's pixels (the rectangle is Cut's, so
// Film measures it as Cut does: Mona 2026-11-09, "Build canvas feather in Film") and Film's masks, in clip pixels, as its custom paths,
// draws them (every mask, combined as Film combines them: oneos-tests/editor/masks.test.ts), and an unedited save is the very bytes.
// Run: node --test apps/web/oneos-tests/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CutSession } from "../src/oneos/cut-session.ts";

const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "film-masked-cut.otio")));

test("Film's masks on Cut's project open in Cut's project mode as Cut's masks, and an unedited save is the very bytes", () => {
	const s = CutSession.open("trip.otio", bytes);
	assert.equal(s.mode, "cut");
	const main = s.project.scenes[0].tracks.main;
	const beach = main.elements.find((e: any) => e.name === "Beach");
	const logo = main.elements.find((e: any) => e.name === "Logo");
	const rect = beach.masks.find((m: any) => m.type === "rectangle");
	assert.deepEqual([rect.params.units, rect.params.feather, rect.params.expansion], [undefined, 6, 0], "Film's feather, in the canvas's pixels, Cut's own");
	for (const hole of [beach.masks.at(-1), logo.masks[0]]) {
		assert.deepEqual([hole.type, hole.name, hole.params.mode, hole.params.units, hole.params.closed], ["custom", "Hole", "subtract", "clip", true]);
		assert.equal(hole.params.path.length, 4, "Film's ellipse as Cut's custom path of the same curve");
	}
	const p = JSON.parse(JSON.stringify(s.project));
	s.baseline(p, s.media);
	assert.ok(Buffer.from(s.save(p, s.media)).equals(Buffer.from(bytes)), "the very bytes");
});
