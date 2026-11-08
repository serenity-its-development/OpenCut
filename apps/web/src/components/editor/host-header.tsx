"use client";

/**
 * The header of Cut inside OneOS: the file's name, Save (a new version of the file, through the host), the export (a new file beside it),
 * and, named, every track Cut carries but does not edit. Ctrl/Cmd+S saves.
 */
import { useEffect } from "react";
import { Button } from "../ui/button";
import { ExportButton } from "./export-button";
import type { HostMode, HostState } from "@/oneos/host-mode";

export function HostHeader({ host, state }: { host: HostMode; state: Extract<HostState, { stage: "open" }> }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void host.save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [host]);

	return (
		<header className="flex flex-col gap-1 px-4 py-2">
			<div className="flex h-10 items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-medium" title={state.name}>
						{state.name}
					</span>
					{state.readOnly && <span className="text-muted-foreground text-xs">Read-only</span>}
					{state.dirty && !state.readOnly && <span className="text-muted-foreground text-xs">Unsaved changes</span>}
				</div>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="outline" disabled={state.readOnly || state.saving} onClick={() => void host.save()}>
						{state.saving ? "Saving..." : "Save"}
					</Button>
					<ExportButton />
				</div>
			</div>
			{state.notice && (
				<p role="alert" className="text-destructive text-xs">
					{state.notice}
				</p>
			)}
			{state.locked.length > 0 && (
				<details className="text-muted-foreground text-xs">
					<summary>
						{state.locked.length === 1 ? "1 track is" : `${state.locked.length} tracks are`} kept exactly as the file has them and not edited here
					</summary>
					<ul className="mt-1 list-disc pl-5">
						{state.locked.map((l) => (
							<li key={`${l.scene}/${l.track}`}>
								{l.scene} / {l.track}: {l.reason}
							</li>
						))}
					</ul>
				</details>
			)}
		</header>
	);
}
