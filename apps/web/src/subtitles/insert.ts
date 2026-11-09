import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import type { CreateTextElement } from "@/timeline";
import { type MediaTime, mediaTimeFromSeconds } from "@/wasm";
import { buildCaptionElement, captionTimes, captionTrackDataFor } from "@/oneos/captions";

/**
 * OneOS (files/989, Mona 2026-11-10: "Caption track in the .otio"; for a transcription, "Yes, caption track"): an SRT's cues and a
 * transcription's captions become a CAPTION track (Film's, in the .otio both tools edit), in the language the person stated, each a caption
 * drawn in the track's one style (`oneos/captions.ts`), named by its text. Which captions go here: `captionsGoTo`.
 */
export function insertCaptionChunksAsCaptionTrack({
	editor,
	captions,
	language,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	language?: string;
}): string | null {
	if (captions.length === 0) {
		return null;
	}
	const data = captionTrackDataFor({ language });
	const addTrackCommand = new AddTrackCommand("caption", 0, data);
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const times = captionTimes(captions, (seconds) => mediaTimeFromSeconds({ seconds }));
	const insertCommands = captions.map(
		(caption, i) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: {
					...buildCaptionElement({ caption, style: data.style, canvasSize }),
					startTime: times[i].start as MediaTime,
					duration: times[i].duration as MediaTime,
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
