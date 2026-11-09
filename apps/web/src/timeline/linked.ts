/**
 * Linked elements (OneOS doctrine files/989, Mona 2026-11-10: "Build linked audio, lock multicam"): a clip's picture and its sound as two
 * elements that are edited as one, as Film links them (filmcraft `TrackItem.link`). Elements sharing a `link` label are partners: selecting
 * one selects them all, so a move, a trim or a delete takes them together; a split cuts them all and pairs the right halves under a link
 * of their own, as a duplicate pairs the copies. The label is only a name shared by partners (Film numbers its own when it reads the file).
 */
import type { ElementRef, SceneTracks, TimelineElement } from "./types";

type Tracks = Pick<SceneTracks, "overlay" | "main" | "audio">;

const tracksOf = (tracks: Tracks) => [tracks.main, ...tracks.overlay, ...tracks.audio].filter(Boolean);

/** `refs` and every element linked to one of them, each once, in the order given then in track order. */
export function withLinked({ tracks, refs }: { tracks: Tracks; refs: ElementRef[] }): ElementRef[] {
	const all = tracksOf(tracks).flatMap((t) => (t.elements as TimelineElement[]).map((e) => ({ trackId: t.id, element: e })));
	const links = new Set<string>();
	for (const r of refs) {
		const hit = all.find((x) => x.trackId === r.trackId && x.element.id === r.elementId);
		if (hit?.element.link) links.add(hit.element.link);
	}
	const out = [...refs];
	const has = (r: ElementRef) => out.some((x) => x.trackId === r.trackId && x.elementId === r.elementId);
	for (const x of all) {
		const r = { trackId: x.trackId, elementId: x.element.id };
		if (x.element.link && links.has(x.element.link) && !has(r)) out.push(r);
	}
	return out;
}

/** A link for copies of linked elements: copies of one link's partners share ONE new link, so they are partners of each other only. */
export function relinker(fresh: () => string): <E extends { link?: string }>(element: E) => E {
	const made = new Map<string, string>();
	return (element) => {
		if (!element.link) return element;
		let next = made.get(element.link);
		if (!next) {
			next = fresh();
			made.set(element.link, next);
		}
		return { ...element, link: next };
	};
}
