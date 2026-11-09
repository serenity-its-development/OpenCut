/**
 * A text's animatable typography (OneOS files/989, Mona 2026-11-09: "Build text animation in Cut"): its size and tracking are numbers Cut
 * eases; its font, content, alignment, weight, style and decoration are held from key to key (discrete channels), as Film's graphic text
 * layer keys them. Shared by the editor's two property registries (`animation/property-registry.ts`, `timeline/animation-properties.ts`).
 */
import type {
	AnimationBindingKind,
	AnimationInterpolation,
	AnimationValue,
	TextAnimationPropertyPath,
} from "@/animation/types";
import type { TextElement, TimelineElement } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "@/text/typography";

interface Definition {
	kind: AnimationBindingKind;
	defaultInterpolation: AnimationInterpolation;
	numericRanges?: Partial<Record<string, { min?: number; max?: number; step?: number }>>;
	supportsElement: ({ element }: { element: TimelineElement }) => boolean;
	getValue: ({ element }: { element: TimelineElement }) => AnimationValue | null;
	coerceValue: ({ value }: { value: AnimationValue }) => AnimationValue | null;
	setValue: ({ element, value }: { element: TimelineElement; value: AnimationValue }) => TimelineElement;
}

const isText = ({ element }: { element: TimelineElement }) => element.type === "text";

function number(field: "fontSize" | "letterSpacing", range: { min?: number; max?: number }, fallback: number): Definition {
	return {
		kind: "number",
		defaultInterpolation: "linear",
		numericRanges: { value: range },
		supportsElement: isText,
		getValue: ({ element }) => (element.type === "text" ? (element[field] ?? fallback) : null),
		coerceValue: ({ value }) =>
			typeof value === "number" && !Number.isNaN(value)
				? Math.min(range.max ?? Number.POSITIVE_INFINITY, Math.max(range.min ?? Number.NEGATIVE_INFINITY, value))
				: null,
		setValue: ({ element, value }) => (element.type === "text" ? { ...element, [field]: value as number } : element),
	};
}

function held<K extends "fontFamily" | "content" | "textAlign" | "fontWeight" | "fontStyle" | "textDecoration">(
	field: K,
	allowed: ReadonlyArray<TextElement[K]> | null,
): Definition {
	return {
		kind: "discrete",
		defaultInterpolation: "hold",
		supportsElement: isText,
		getValue: ({ element }) => (element.type === "text" ? element[field] : null),
		// A value outside the field's own (an alignment Cut has not) is refused, never coerced to another.
		coerceValue: ({ value }) =>
			typeof value === "string" && (allowed === null || (allowed as ReadonlyArray<string>).includes(value)) ? value : null,
		setValue: ({ element, value }) => (element.type === "text" ? { ...element, [field]: value } : element),
	};
}

export const TEXT_PROPERTY_DEFINITIONS: Record<TextAnimationPropertyPath, Definition> = {
	fontSize: number("fontSize", { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE }, DEFAULTS.text.element.fontSize),
	letterSpacing: number("letterSpacing", {}, DEFAULTS.text.letterSpacing),
	fontFamily: held("fontFamily", null),
	content: held("content", null),
	textAlign: held("textAlign", ["left", "center", "right"]),
	fontWeight: held("fontWeight", ["normal", "bold"]),
	fontStyle: held("fontStyle", ["normal", "italic"]),
	textDecoration: held("textDecoration", ["none", "underline", "line-through"]),
};
