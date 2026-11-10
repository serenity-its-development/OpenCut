import { stickersRegistry } from "../registry";
import type { StickerProvider } from "@/stickers/types";
import { flagsProvider } from "./flags";
import { logosProvider } from "./logos";
import { oneosProvider } from "./oneos";
import { shapesProvider } from "./shapes";

// OneOS (files/989, Mona 2026-11-10 "Shared set + Cut now"): every provider stays registered, so a sticker id a project already holds
// (flags, shapes, logos) resolves as before; the picker lists only the providers `STICKER_CATEGORIES` names (`pickerProviders`).
const defaultProviders: StickerProvider[] = [
	oneosProvider,
	logosProvider,
	flagsProvider,
	shapesProvider,
];

export function registerDefaultStickerProviders({
	providersToRegister = defaultProviders,
}: {
	providersToRegister?: StickerProvider[];
} = {}): void {
	for (const provider of providersToRegister) {
		if (stickersRegistry.has(provider.id)) {
			continue;
		}
		stickersRegistry.register(provider.id, provider);
	}
}
