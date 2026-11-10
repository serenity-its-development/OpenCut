import { drawCssBackground } from "@/gradients";
import { masksRegistry } from "@/masks";
import {
	combineCoverages,
	isPlainMask,
	type MaskCoverage,
	maskExpansion,
	maskMode,
	maskOpacity,
	maskUnits,
} from "@/masks/combine";
import { drawnMasks, expandedSplit, planMask } from "@/masks/draw-plan";
import type { Mask } from "@/masks/types";
import { applyMaskFeather } from "../mask-feather";
import { incrementCounter } from "@/diagnostics/render-perf";
import type { AnyBaseNode } from "../nodes/base-node";
import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import { BlurBackgroundNode } from "../nodes/blur-background-node";
import { ColorNode } from "../nodes/color-node";
import { EffectLayerNode } from "../nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "../nodes/graphic-node";
import { ImageNode } from "../nodes/image-node";
import { RootNode } from "../nodes/root-node";
import { StickerNode } from "../nodes/sticker-node";
import { renderTextToContext, TextNode } from "../nodes/text-node";
import { VideoNode } from "../nodes/video-node";
import type { ResolvedVisualSourceNodeState } from "../nodes/visual-node";
import type {
	FrameDescriptor,
	FrameItemDescriptor,
	LayerMaskDescriptor,
	QuadTransformDescriptor,
	TextureCanvasDrawFn,
	TextureUploadDescriptor,
} from "./types";
import { DEFAULT_GRAPHIC_SOURCE_SIZE } from "@/graphics";

export async function buildFrameDescriptor({
	node,
	renderer,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
}): Promise<{
	frame: FrameDescriptor;
	textures: TextureUploadDescriptor[];
}> {
	const items: FrameItemDescriptor[] = [];
	const textures = new Map<string, TextureUploadDescriptor>();

	await collectNode({
		node,
		renderer,
		path: "root",
		items,
		textures,
	});

	incrementCounter({ name: "frameItems", by: items.length });
	incrementCounter({ name: "frameTextures", by: textures.size });

	return {
		frame: {
			width: renderer.width,
			height: renderer.height,
			clear: {
				color: [0, 0, 0, 1],
			},
			items,
		},
		textures: [...textures.values()],
	};
}

async function collectNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}): Promise<void> {
	if (node instanceof RootNode) {
		for (let index = 0; index < node.children.length; index++) {
			await collectNode({
				node: node.children[index],
				renderer,
				path: `${path}:${index}`,
				items,
				textures,
			});
		}
		return;
	}

	if (node instanceof ColorNode) {
		// OneOS (files/989): a dip's colour is drawn only inside its window.
		if (!node.resolved) return;
		const textureId = `${path}:color`;
		const { width, height } = renderer;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash: `color:${node.params.color}:${width}x${height}`,
			width,
			height,
			draw: (ctx) => {
				if (/gradient\(/i.test(node.params.color)) {
					drawCssBackground({ ctx, width, height, css: node.params.color });
				} else {
					ctx.fillStyle = node.params.color;
					ctx.fillRect(0, 0, width, height);
				}
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		});
		return;
	}

	if (node instanceof EffectLayerNode) {
		if (!node.resolved || node.resolved.passes.length === 0) {
			return;
		}
		items.push({
			type: "sceneEffect",
			effectPassGroups: [node.resolved.passes],
		});
		return;
	}

	if (node instanceof BlurBackgroundNode) {
		if (!node.resolved) {
			return;
		}
		const textureId = `${path}:blur-background`;
		const { width, height } = renderer;
		const { backdropSource, passes } = node.resolved;
		// Backdrop pixels come from a decoded video/image frame whose identity
		// already changes when it changes. Hashing the source reference is
		// enough to let us skip redraws on frozen frames.
		const contentHash = `blur:${identityKey(backdropSource.source)}:${backdropSource.width}x${backdropSource.height}:${width}x${height}`;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash,
			width,
			height,
			draw: (ctx) => {
				const coverScale = Math.max(
					width / backdropSource.width,
					height / backdropSource.height,
				);
				const scaledWidth = backdropSource.width * coverScale;
				const scaledHeight = backdropSource.height * coverScale;
				const offsetX = (width - scaledWidth) / 2;
				const offsetY = (height - scaledHeight) / 2;
				ctx.drawImage(
					backdropSource.source,
					offsetX,
					offsetY,
					scaledWidth,
					scaledHeight,
				);
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [passes],
			mask: null,
		});
		return;
	}

	if (
		node instanceof VideoNode ||
		node instanceof ImageNode ||
		node instanceof StickerNode ||
		node instanceof GraphicNode
	) {
		await collectVisualSourceNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
		return;
	}

	if (node instanceof TextNode) {
		collectTextNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
	}
}

async function collectVisualSourceNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: VideoNode | ImageNode | StickerNode | GraphicNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	const source =
		node instanceof GraphicNode
			? node.getSource({ resolvedParams: node.resolved.resolvedParams })
			: node.resolved.source;
	if (!source) {
		return;
	}

	const sourceWidth =
		node instanceof GraphicNode
			? DEFAULT_GRAPHIC_SOURCE_SIZE
			: (node.resolved as ResolvedVisualSourceNodeState).sourceWidth;
	const sourceHeight =
		node instanceof GraphicNode
			? DEFAULT_GRAPHIC_SOURCE_SIZE
			: (node.resolved as ResolvedVisualSourceNodeState).sourceHeight;

	const textureId = `${path}:source`;
	textures.set(textureId, {
		kind: "external",
		id: textureId,
		source,
		width: sourceWidth,
		height: sourceHeight,
	});

	const transform = computeVisualTransform({
		renderer,
		resolved: node.resolved,
		sourceWidth,
		sourceHeight,
	});
	const { mask, strokeLayers } = buildMaskArtifacts({
		node,
		renderer,
		path,
		transform,
		source: { width: sourceWidth, height: sourceHeight },
		textures,
	});

	items.push({
		type: "layer",
		textureId,
		transform,
		opacity: node.resolved.opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		mask,
	});
	items.push(...strokeLayers);
}

function collectTextNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: TextNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	const textureId = `${path}:text`;
	const { width, height } = renderer;
	// Text output is fully determined by node.params + node.resolved. Both are
	// plain data we can stringify cheaply; the resolved measured layout is the
	// expensive part of text setup, so stringifying it here is orders of
	// magnitude cheaper than re-rasterizing when nothing changed.
	const contentHash = `text:${width}x${height}:${JSON.stringify({
		params: node.params,
		resolved: node.resolved,
	})}`;
	textures.set(textureId, {
		kind: "rendered",
		id: textureId,
		contentHash,
		width,
		height,
		draw: (ctx) => {
			renderTextToContext({ node, ctx });
		},
	});
	items.push({
		type: "layer",
		textureId,
		transform: fullCanvasTransform(renderer),
		opacity: node.resolved.opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		mask: null,
	});
}

function computeVisualTransform({
	renderer,
	resolved,
	sourceWidth,
	sourceHeight,
}: {
	renderer: CanvasRenderer;
	resolved: ResolvedVisualSourceNodeState | ResolvedGraphicNodeState;
	sourceWidth: number;
	sourceHeight: number;
}): QuadTransformDescriptor {
	const containScale = Math.min(
		renderer.width / sourceWidth,
		renderer.height / sourceHeight,
	);
	const scaledWidth = sourceWidth * containScale * resolved.transform.scaleX;
	const scaledHeight = sourceHeight * containScale * resolved.transform.scaleY;
	const absWidth = Math.abs(scaledWidth);
	const absHeight = Math.abs(scaledHeight);

	return {
		centerX: renderer.width / 2 + resolved.transform.position.x,
		centerY: renderer.height / 2 + resolved.transform.position.y,
		width: absWidth,
		height: absHeight,
		rotationDegrees: resolved.transform.rotate,
		flipX: scaledWidth < 0,
		flipY: scaledHeight < 0,
	};
}

function fullCanvasTransform(
	renderer: CanvasRenderer,
): QuadTransformDescriptor {
	return {
		centerX: renderer.width / 2,
		centerY: renderer.height / 2,
		width: renderer.width,
		height: renderer.height,
		rotationDegrees: 0,
		flipX: false,
		flipY: false,
	};
}

/**
 * The element's masks as ONE mask texture (OneOS doctrine files/989, "Masks, both ways"): EVERY mask is drawn, top to bottom, combined as
 * Film combines its masks (`masks/combine.ts`), and each mask's stroke is a layer of its own. One mask that is plain (add, opaque, not
 * expanded) is drawn as before, feathered and inverted by the compositor; otherwise each mask is feathered here and the texture holds the
 * combined coverage (the compositor then neither feathers nor inverts it).
 */
function buildMaskArtifacts({
	node,
	renderer,
	path,
	transform,
	source,
	textures,
}: {
	node: VideoNode | ImageNode | StickerNode | GraphicNode;
	renderer: CanvasRenderer;
	path: string;
	transform: QuadTransformDescriptor;
	/** The element's own pixels (its medium's, or a graphic's drawing size): where a mask measured in clip pixels is drawn and feathered. */
	source: { width: number; height: number };
	textures: Map<string, TextureUploadDescriptor>;
}): {
	mask: LayerMaskDescriptor | null;
	strokeLayers: FrameItemDescriptor[];
} {
	const drawn = drawnMasks(node.params.masks ?? []);
	if (!drawn.length) {
		return { mask: null, strokeLayers: [] };
	}
	const { width: canvasWidth, height: canvasHeight } = renderer;
	const strokeLayers = drawn.flatMap((mask, index) => {
		const layer = buildMaskStrokeLayer({
			mask,
			index,
			renderer,
			path,
			transform,
			textures,
		});
		return layer ? [layer] : [];
	});
	const maskTextureId = `${path}:mask`;

	if (drawn.length === 1 && isPlainMask(drawn[0].params)) {
		const [mask] = drawn;
		const plan = planMask(mask);
		textures.set(maskTextureId, {
			kind: "rendered",
			id: maskTextureId,
			contentHash: `mask:${mask.type}:${JSON.stringify(mask.params)}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}:direct=${plan.direct}`,
			width: canvasWidth,
			height: canvasHeight,
			draw: (ctx) => drawHardMask({ ctx, mask, plan, transform, source }),
		});
		return {
			mask: {
				textureId: maskTextureId,
				feather: plan.feather,
				inverted: mask.params.inverted,
			},
			strokeLayers,
		};
	}

	textures.set(maskTextureId, {
		kind: "rendered",
		id: maskTextureId,
		contentHash: `masks:${JSON.stringify(drawn.map((m) => [m.type, m.params]))}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}:source=${source.width}x${source.height}`,
		width: canvasWidth,
		height: canvasHeight,
		draw: (ctx) =>
			drawCombinedMasks({
				ctx,
				masks: drawn,
				transform,
				source,
				width: canvasWidth,
				height: canvasHeight,
			}),
	});
	return {
		mask: { textureId: maskTextureId, feather: 0, inverted: false },
		strokeLayers,
	};
}

/**
 * One mask's shape, expanded, drawn on the canvas where the element is. A mask measured in the canvas's pixels (Cut's own) is drawn at the
 * element's drawn size and feathered afterwards on the canvas; one measured in clip pixels (Film's) is drawn and feathered at the element's
 * own pixels, then drawn through the element's scale and rotation, as Film draws a clip's masks before its Motion, so its feather follows
 * the element's scale frame by frame, per axis.
 */
function drawHardMask({
	ctx,
	mask,
	plan,
	transform,
	source,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	mask: Mask;
	plan: { direct: boolean; feather: number };
	transform: QuadTransformDescriptor;
	source: { width: number; height: number };
}): void {
	const definition = masksRegistry.get(mask.type);
	const clip = maskUnits(mask.params) === "clip";
	const drawnWidth = clip ? source.width : transform.width;
	const drawnHeight = clip ? source.height : transform.height;
	const width = Math.round(drawnWidth);
	const height = Math.round(drawnHeight);
	const elementMaskCanvas = createOffscreenCanvas({ width, height });
	const elementMaskCtx = elementMaskCanvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!elementMaskCtx) return;
	const params =
		mask.type === "split"
			? expandedSplit(mask.params, drawnWidth, drawnHeight)
			: mask.params;
	const expansion = mask.type === "split" ? 0 : maskExpansion(mask.params);

	if (plan.direct && definition.renderer.renderMask) {
		definition.renderer.renderMask({
			resolvedParams: params,
			ctx: elementMaskCtx,
			width,
			height,
			feather: params.feather,
		});
		if (expansion !== 0) {
			if (!definition.renderer.renderStroke) {
				throw new Error(
					`mask-expansion-not-drawn: the ${mask.type} mask has no outline to grow or shrink it by`,
				);
			}
			// The outline stroked 2|e| wide, centred: added to the shape it grows it by e, taken from it shrinks it.
			elementMaskCtx.save();
			if (expansion < 0)
				elementMaskCtx.globalCompositeOperation = "destination-out";
			definition.renderer.renderStroke({
				resolvedParams: {
					...params,
					strokeColor: "#ffffff",
					strokeWidth: 2 * Math.abs(expansion),
					strokeAlign: "center",
				},
				ctx: elementMaskCtx,
				width,
				height,
			});
			elementMaskCtx.restore();
		}
	} else if (definition.renderer.buildPath) {
		const path2d = definition.renderer.buildPath({
			resolvedParams: params,
			width: drawnWidth,
			height: drawnHeight,
		});
		elementMaskCtx.fillStyle = "white";
		elementMaskCtx.fill(path2d);
		if (expansion !== 0) {
			elementMaskCtx.save();
			elementMaskCtx.lineJoin = "round";
			elementMaskCtx.lineWidth = 2 * Math.abs(expansion);
			elementMaskCtx.strokeStyle = "white";
			if (expansion < 0)
				elementMaskCtx.globalCompositeOperation = "destination-out";
			elementMaskCtx.stroke(path2d);
			elementMaskCtx.restore();
		}
	} else {
		return;
	}

	const drawnMask =
		clip && plan.feather > 0
			? applyMaskFeather({
					maskCanvas: elementMaskCanvas,
					width,
					height,
					feather: plan.feather,
				})
			: elementMaskCanvas;
	drawTransformedCanvas({ ctx, source: drawnMask, transform });
}

/** Every mask feathered here and combined top to bottom (`combineCoverages`), drawn as white of that coverage. */
function drawCombinedMasks({
	ctx,
	masks,
	transform,
	source,
	width,
	height,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	masks: Mask[];
	transform: QuadTransformDescriptor;
	source: { width: number; height: number };
	width: number;
	height: number;
}): void {
	const layers: MaskCoverage[] = [];
	for (const mask of masks) {
		const plan = planMask(mask);
		const hard = createOffscreenCanvas({ width, height });
		const hardCtx = hard.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!hardCtx) return;
		drawHardMask({ ctx: hardCtx, mask, plan, transform, source });
		const feathered =
			plan.feather > 0 && maskUnits(mask.params) === "canvas"
				? applyMaskFeather({
						maskCanvas: hard,
						width,
						height,
						feather: plan.feather,
					})
				: hard;
		const coverage = alphaOf({ source: feathered, width, height });
		if (!coverage) return;
		layers.push({
			coverage,
			mode: maskMode(mask.params),
			opacity: maskOpacity(mask.params),
			inverted: mask.params.inverted,
		});
	}
	const combined = combineCoverages(layers, width * height);
	if (!combined) return;
	const image = ctx.createImageData(width, height);
	for (let i = 0; i < combined.length; i++) {
		image.data[i * 4] = 255;
		image.data[i * 4 + 1] = 255;
		image.data[i * 4 + 2] = 255;
		image.data[i * 4 + 3] = Math.round(combined[i] * 255);
	}
	ctx.putImageData(image, 0, 0);
}

/** A drawn mask's coverage per pixel (its alpha, 0..1). */
function alphaOf({
	source,
	width,
	height,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
}): Float32Array | null {
	const scratch = createOffscreenCanvas({ width, height });
	const scratchCtx = scratch.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!scratchCtx) return null;
	scratchCtx.drawImage(source, 0, 0, width, height);
	const data = scratchCtx.getImageData(0, 0, width, height).data;
	const out = new Float32Array(width * height);
	for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] / 255;
	return out;
}

/** One mask's stroke, a layer of its own above the element (the first mask's keeps the texture id it always had). */
function buildMaskStrokeLayer({
	mask,
	index,
	renderer,
	path,
	transform,
	textures,
}: {
	mask: Mask;
	index: number;
	renderer: CanvasRenderer;
	path: string;
	transform: QuadTransformDescriptor;
	textures: Map<string, TextureUploadDescriptor>;
}): FrameItemDescriptor | null {
	const definition = masksRegistry.get(mask.type);
	const { width: canvasWidth, height: canvasHeight } = renderer;
	const hasStroke =
		mask.params.strokeWidth > 0 &&
		(definition.renderer.renderStroke ||
			definition.renderer.buildStrokePath ||
			definition.renderer.buildPath);
	if (!hasStroke) {
		return null;
	}
	const strokeTextureId =
		index === 0 ? `${path}:mask-stroke` : `${path}:mask-stroke-${index}`;
	const strokeContentHash = `stroke:${mask.type}:${JSON.stringify(mask.params)}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}`;
	const drawStroke: TextureCanvasDrawFn = (ctx) => {
		const strokeCanvas = createOffscreenCanvas({
			width: Math.round(transform.width),
			height: Math.round(transform.height),
		});
		const strokeCtx = strokeCanvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!strokeCtx) return;

		if (definition.renderer.renderStroke) {
			definition.renderer.renderStroke({
				resolvedParams: mask.params,
				ctx: strokeCtx,
				width: transform.width,
				height: transform.height,
			});
		} else {
			const strokePath =
				definition.renderer.buildStrokePath?.({
					resolvedParams: mask.params,
					width: transform.width,
					height: transform.height,
				}) ??
				definition.renderer.buildPath?.({
					resolvedParams: mask.params,
					width: transform.width,
					height: transform.height,
				}) ??
				null;
			if (!strokePath) return;
			strokeCtx.strokeStyle = mask.params.strokeColor;
			strokeCtx.lineWidth = mask.params.strokeWidth;
			strokeCtx.stroke(strokePath);
		}

		drawTransformedCanvas({ ctx, source: strokeCanvas, transform });
	};
	textures.set(strokeTextureId, {
		kind: "rendered",
		id: strokeTextureId,
		contentHash: strokeContentHash,
		width: canvasWidth,
		height: canvasHeight,
		draw: drawStroke,
	});
	return {
		type: "layer",
		textureId: strokeTextureId,
		transform: fullCanvasTransform(renderer),
		opacity: 1,
		blendMode: "normal",
		effectPassGroups: [],
		mask: null,
	};
}

function drawTransformedCanvas({
	ctx,
	source,
	transform,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	transform: QuadTransformDescriptor;
}) {
	const x = transform.centerX - transform.width / 2;
	const y = transform.centerY - transform.height / 2;
	const flipX = transform.flipX ? -1 : 1;
	const flipY = transform.flipY ? -1 : 1;
	const requiresTransform =
		transform.rotationDegrees !== 0 || flipX !== 1 || flipY !== 1;

	ctx.save();
	if (requiresTransform) {
		ctx.translate(transform.centerX, transform.centerY);
		ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
		ctx.scale(flipX, flipY);
		ctx.translate(-transform.centerX, -transform.centerY);
	}
	ctx.drawImage(source, x, y, transform.width, transform.height);
	ctx.restore();
}

function transformHash(transform: QuadTransformDescriptor): string {
	return `${transform.centerX}:${transform.centerY}:${transform.width}:${transform.height}:${transform.rotationDegrees}:${transform.flipX ? 1 : 0}:${transform.flipY ? 1 : 0}`;
}

// Stable identity key for CanvasImageSource. Using a WeakMap → counter keeps
// hash string length bounded and avoids holding sources alive.
const identityKeys = new WeakMap<object, number>();
let nextIdentity = 1;
function identityKey(source: CanvasImageSource): string {
	if (typeof source === "object" && source !== null) {
		let key = identityKeys.get(source);
		if (key === undefined) {
			key = nextIdentity++;
			identityKeys.set(source, key);
		}
		return `@${key}`;
	}
	return "@?";
}
