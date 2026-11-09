import { PasteCommand } from "@/commands/timeline";
import type { ClipboardHandler } from "../types";
import { relinker } from "@/timeline/linked";
import { generateUUID } from "@/utils/id";

export const ElementsClipboardHandler = {
	type: "elements",

	canCopy({ selectedElements }) {
		return selectedElements.length > 0;
	},

	copy({ editor, selectedElements }) {
		if (selectedElements.length === 0) {
			return null;
		}

		const results = editor.timeline.getElementsWithTracks({
			elements: selectedElements,
		});
		const items = results.map(({ track, element }) => {
			const { id: _elementId, ...elementWithoutId } = element;
			return {
				trackId: track.id,
				trackType: track.type,
				element: elementWithoutId,
			};
		});

		if (items.length === 0) {
			return null;
		}

		return {
			type: "elements",
			items,
		};
	},

	paste(entry, context) {
		if (entry.items.length === 0) {
			return null;
		}

		// OneOS (files/989, "Build linked audio"): each paste's copies of linked elements are partners of each other only.
		const relink = relinker(generateUUID);
		return new PasteCommand({
			time: context.time,
			clipboardItems: entry.items.map((item) => ({ ...item, element: relink(item.element) })),
		});
	},
} satisfies ClipboardHandler<"elements">;
