/**
 * Which of an element's masks are drawn and how each one's hard shape is drawn (OneOS doctrine files/989, "Masks, both ways"; used by the
 * compositor's frame descriptor, `services/renderer/compositor/frame-descriptor.ts`). No DOM: the definitions' renderers are only named here.
 */
import { maskExpansion, maskMode } from "./combine";
import { masksRegistry } from "./registry";
import type { Mask, SplitMaskParams } from "./types";

/** The masks an element draws, in order: not those whose mode is "none" or that their definition says are inactive. */
export function drawnMasks(masks: Mask[]): Mask[] {
	return masks.filter(
		(mask) =>
			maskMode(mask.params) !== "none" &&
			masksRegistry.get(mask.type).isActive?.(mask.params as never) !== false,
	);
}

/** How one mask's hard shape is drawn: by its own renderer (`direct`) or as a filled path, and the feather still to apply after it. */
export function planMask(mask: Mask): { direct: boolean; feather: number } {
	const definition = masksRegistry.get(mask.type);
	const expanded = maskExpansion(mask.params) !== 0 && mask.type !== "split";
	const canRenderMaskDirectly = Boolean(definition.renderer.renderMask);
	// A path is grown or shrunk by stroking it, so an expanded mask that has a path is drawn as its path.
	const direct =
		canRenderMaskDirectly &&
		(!definition.renderer.buildPath ||
			(!expanded &&
				mask.params.feather > 0 &&
				Boolean(definition.renderer.renderMaskHandlesFeather)));
	const feather =
		direct && definition.renderer.renderMaskHandlesFeather
			? 0
			: mask.params.feather;
	return { direct, feather };
}

/**
 * A split's line moved so its kept side grows by `expansion` pixels (its kept side is where the normal points; a split has no other edge
 * inside the element, so moving the line IS growing the shape).
 */
export function expandedSplit(
	params: SplitMaskParams,
	width: number,
	height: number,
): SplitMaskParams {
	const e = maskExpansion(params);
	if (e === 0) return params;
	const angle = (params.rotation * Math.PI) / 180;
	return {
		...params,
		centerX: params.centerX - (Math.cos(angle) * e) / width,
		centerY: params.centerY - (Math.sin(angle) * e) / height,
	};
}
