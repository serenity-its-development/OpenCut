/**
 * How an element's masks combine (OneOS doctrine files/989, "Masks, both ways"): EVERY mask is drawn, top to bottom, as Film combines its
 * masks (filmcraft `project/src/mask.rs` `MaskMode`, `render/src/mask.rs`), so a project's masks draw alike in Cut and Film. Each mask's
 * coverage c (its shape, grown or shrunk by `expansion` pixels, then feathered) becomes m = opacity · (inverted ? 1 − c : c) and is combined
 * with the coverage of the masks above it by the mask's mode; the first mask drawn starts from nothing (add, lighten, difference) or from the
 * whole element (subtract, intersect, darken). A mask whose mode is "none", or that its definition says is inactive, is not drawn (it is kept
 * for the person to switch back on). An absent field is Film's default: mode add, opacity 1, expansion 0, so a project saved before these
 * fields existed draws as it did: one mask exactly as before, several masks as their union. Pure: no DOM.
 */
import type { BaseMaskParams, MaskMode } from "./types";

export const MASK_MODES: readonly MaskMode[] = [
	"none",
	"add",
	"subtract",
	"intersect",
	"lighten",
	"darken",
	"difference",
];

export const maskMode = (params: BaseMaskParams): MaskMode =>
	params.mode ?? "add";
export const maskOpacity = (params: BaseMaskParams): number =>
	params.opacity ?? 1;
export const maskExpansion = (params: BaseMaskParams): number =>
	params.expansion ?? 0;

/** A mask that draws as Cut drew its one mask before: add, fully opaque, not expanded (inverted and feathered by the compositor). */
export const isPlainMask = (params: BaseMaskParams): boolean =>
	maskMode(params) === "add" &&
	maskOpacity(params) === 1 &&
	maskExpansion(params) === 0;

/** Combine the coverage `a` of the masks above with this mask's coverage `m` (Film's `MaskMode::combine`). */
export function combineMode(mode: MaskMode, a: number, m: number): number {
	switch (mode) {
		case "none":
			return a;
		case "add":
			return a + m - a * m;
		case "subtract":
			return a * (1 - m);
		case "intersect":
			return a * m;
		case "lighten":
			return Math.max(a, m);
		case "darken":
			return Math.min(a, m);
		case "difference":
			return a + m - 2 * a * m;
	}
}

/** Where the first mask drawn starts (Film's `MaskMode::start`): subtractive modes from the whole element, the others from nothing. */
export const startOf = (mode: MaskMode): number =>
	mode === "subtract" || mode === "intersect" || mode === "darken" ? 1 : 0;

/** One mask's coverage per pixel (0..1: its expanded, feathered shape) with how it combines. */
export interface MaskCoverage {
	coverage: ArrayLike<number>;
	mode: MaskMode;
	opacity: number;
	inverted: boolean;
}

/**
 * The coverage of masks drawn top to bottom over `n` pixels, or null when none is drawn (the element is not masked). Each mask's
 * m = opacity · (inverted ? 1 − c : c), combined by its mode with what the masks above it left.
 */
export function combineCoverages(
	masks: MaskCoverage[],
	n: number,
): Float32Array | null {
	const drawn = masks.filter((m) => m.mode !== "none");
	if (!drawn.length) return null;
	const out = new Float32Array(n).fill(startOf(drawn[0].mode));
	for (const { coverage, mode, opacity, inverted } of drawn) {
		const k = Math.min(Math.max(opacity, 0), 1);
		for (let i = 0; i < n; i++) {
			const c = coverage[i];
			out[i] = combineMode(mode, out[i], k * (inverted ? 1 - c : c));
		}
	}
	return out;
}
