/**
 * OneOS (files/989; Mona 2026-11-10: "Shared set + Cut now"): Cut's stickers come from the ONE sticker set of the Craft video editors,
 * OneOS's own assets by id (OneOS `workspace/data/craft-stickers`: our icon set, Solar and Fluent Color, plus Noto Emoji, each credited
 * under its licence). A sticker is `oneos:<id>` (`oneos:noto/1f600`, `oneos:solar/star-bold-duotone`, `oneos:fluent-color/heart-48`).
 *
 * The set is in Cut's own bundle: the index (`oneos-set.ts`) and the bytes (`public/stickers/oneos/<id>.svg`, with the licences and
 * CREDITS.txt), both written by OneOS `workspace/scripts/craft-stickers.mjs --to-cut`. Nothing is fetched from anywhere else.
 * Cut's earlier stickers (flags, shapes, logos) still resolve, so a project using them opens unchanged; new ones come from this set.
 */
import { buildStickerId, parseStickerId } from "../sticker-id";
import type {
	StickerBrowseResult,
	StickerItem,
	StickerProvider,
	StickerSearchResult,
} from "../types";

export const ONEOS_PROVIDER_ID = "oneos";
/** Where the set's bytes are in Cut's bundle. */
export const ONEOS_STICKER_BASE = "/stickers/oneos";
/** Every sticker of the set is square, this many units a side (the set's `size`). */
export const ONEOS_STICKER_SIZE = 128;
const ID = /^(noto|solar|fluent-color)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BROWSE_LIMIT = 240;
const SEARCH_LIMIT = 100;

/** `[id, name, keywords]` per sticker, as the set lists them. */
export type OneosStickerEntry = [string, string, string[]];
export interface OneosStickerSet {
	set: { version: number; digest: string; size: number; files: number; filesDigest: string };
	credits: { name: string; licence: string; credit: string; licenceFile?: string }[];
	stickers: OneosStickerEntry[];
}

let loaded: Promise<OneosStickerSet> | null = null;
/** The index, loaded once when the picker first needs it (the editor does not carry it otherwise). */
export function oneosStickerSet(): Promise<OneosStickerSet> {
	loaded ??= import("./oneos-set").then((m) => m.ONEOS_STICKER_SET);
	return loaded;
}

/** The bundle address of a sticker of the set, or a refusal by name: an id of any other shape is not the set's. */
export function oneosStickerUrl({ id }: { id: string }): string {
	if (!ID.test(id)) {
		throw new Error(`sticker-not-in-set: "${id}" is not an id of OneOS's sticker set`);
	}
	return `${ONEOS_STICKER_BASE}/${id}.svg`;
}

function toItem([id, name, keywords]: OneosStickerEntry): StickerItem {
	return {
		id: buildStickerId({ providerId: ONEOS_PROVIDER_ID, providerValue: id }),
		provider: ONEOS_PROVIDER_ID,
		name,
		previewUrl: oneosStickerUrl({ id }),
		metadata: { source: id.split("/")[0], keywords },
	};
}

/** Every word of the query is in the sticker's name, keywords or id. */
export function matches(entry: OneosStickerEntry, query: string): boolean {
	const hay = `${entry[1]} ${entry[2].join(" ")} ${entry[0]}`.toLowerCase();
	return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export const oneosProvider: StickerProvider = {
	id: ONEOS_PROVIDER_ID,
	async search({ query, options }): Promise<StickerSearchResult> {
		const { stickers } = await oneosStickerSet();
		const hits = query.trim() ? stickers.filter((e) => matches(e, query)) : stickers;
		const limit = Math.max(1, options?.limit ?? SEARCH_LIMIT);
		return { items: hits.slice(0, limit).map(toItem), total: hits.length, hasMore: hits.length > limit };
	},
	async browse({ options }): Promise<StickerBrowseResult> {
		const { stickers } = await oneosStickerSet();
		const limit = Math.max(1, options?.limit ?? BROWSE_LIMIT);
		const section = (id: string, title: string, of: OneosStickerEntry[]) => ({
			id,
			title,
			items: of.slice(0, limit).map(toItem),
			hasMore: of.length > limit,
			layout: "grid" as const,
		});
		return {
			sections: [
				section("emoji", "Emoji", stickers.filter((e) => e[0].startsWith("noto/"))),
				section("icons", "Icons", stickers.filter((e) => !e[0].startsWith("noto/"))),
			],
		};
	},
	resolveUrl({ stickerId }): string {
		return oneosStickerUrl({ id: parseStickerId({ stickerId }).providerValue });
	},
};
