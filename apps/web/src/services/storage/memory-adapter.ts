import type { StorageAdapter } from "./types";

/**
 * OneOS host mode (doctrine files/989, files/999): the project and its media live in this window's memory only, never in IndexedDB or
 * OPFS. The file is the host's; a save goes to the host as a new version (`oneos/host-mode.ts`).
 */
export class MemoryAdapter<T> implements StorageAdapter<T> {
	private readonly items = new Map<string, T>();

	async get(key: string): Promise<T | null> {
		return this.items.has(key) ? (this.items.get(key) as T) : null;
	}

	async set(key: string, value: T): Promise<void> {
		this.items.set(key, value);
	}

	async remove(key: string): Promise<void> {
		this.items.delete(key);
	}

	async list(): Promise<string[]> {
		return [...this.items.keys()];
	}

	async getAll(): Promise<T[]> {
		return [...this.items.values()];
	}

	async clear(): Promise<void> {
		this.items.clear();
	}
}
