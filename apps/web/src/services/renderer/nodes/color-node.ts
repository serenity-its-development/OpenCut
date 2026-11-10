import { BaseNode } from "./base-node";

export type ColorNodeParams = {
	color: string;
	/** OneOS (files/989, a dip's colour): drawn only for timeline ticks start..end; always when absent. */
	window?: { start: number; end: number };
};

/** Resolved per frame: drawn at that time (a node with no window always is). */
export class ColorNode extends BaseNode<ColorNodeParams, { drawn: true }> {}
