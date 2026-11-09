import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import type { CreateTextElement } from "@/timeline";
import { mediaTimeFromSeconds } from "@/wasm";
import { buildCaptionElement, newCaptionTrackData } from "@/oneos/captions";

/**
 * OneOS (files/989, Mona 2026-11-10: "Caption track in the .otio"): an SRT's cues become a CAPTION track (Film's, in the .otio both tools
 * edit), each cue a caption drawn in the track's one style (`oneos/captions.ts`), named by its text. An ASS file's cues carry styles of their
 * own, which a caption track (one style) cannot hold, so they stay text elements on a text track.
 */
export function insertCaptionChunksAsCaptionTrack({
	editor,
	captions,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
}): string | null {
	if (captions.length === 0) {
		return null;
	}
	const addTrackCommand = new AddTrackCommand("caption", 0);
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const data = newCaptionTrackData();
	const insertCommands = captions.map(
		(caption) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: {
					...buildCaptionElement({ caption, style: data.style, canvasSize }),
					startTime: mediaTimeFromSeconds({ seconds: caption.startTime }),
					duration: mediaTimeFromSeconds({ seconds: caption.duration }),
				} as CreateTextElement,
			}),
	);
	editor.command.execute({
		command: new BatchCommand([addTrackCommand, ...insertCommands]),
	});
	return trackId;
}

export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
}): string | null {
	if (captions.length === 0) {
		return null;
	}

	const addTrackCommand = new AddTrackCommand("text", 0);
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const insertCommands = captions.map(
		(caption, index) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: buildSubtitleTextElement({
					index,
					caption,
					canvasSize,
				}),
			}),
	);
	editor.command.execute({
		command: new BatchCommand([addTrackCommand, ...insertCommands]),
	});

	return trackId;
}
