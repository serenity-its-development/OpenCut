/**
 * What a Cut project holds that Cut does not own (OneOS doctrine files/989; Mona 2026-11-09: "yes, so this becomes a tool choice not a file
 * type choicer"): a Cut project another tool saved (Film's `metadata.filmcraft`, any other editor's key, at ANY level: the collection, a
 * scene's timeline, its stack, a track, a lane, a clip, a gap, a medium's reference, a bookmark) is still a Cut project. Cut opens it whole
 * and carries every such key untouched, on the part that holds it, through every save.
 *
 * Measured against Cut's own writer: `foreignOf(file, written)` walks the file beside what Cut's writer gives back for it, part by part (a
 * scene by its id, a track by its id, an element by its id, a lane by its number, a gap by the element after it, a bookmark by its place)
 * and collects every key the file holds that the writer does not write. Anything else that differs (a value Cut writes otherwise, a part
 * Cut would drop, a key Cut writes that the file lacks) is damage, named by where it is, and the file is not opened as a Cut project.
 * `carry(written, foreign)` puts the keys back on the same parts of a later save; a part the person removed takes its keys with it.
 * Pure: no DOM, no storage, no network.
 */

type J = Record<string, any>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Each part's foreign keys, by the part's path (made of identities, never of positions that a move would change). */
export type Foreign = Map<string, J>;

/** The identity of each element of an array, as Cut's writer names it (else its place). */
function idents(arr: unknown[]): string[] {
	const own = (v: unknown): string | null => {
		if (!isObj(v)) return null;
		const oc = isObj(v.metadata) && isObj(v.metadata.opencut) ? v.metadata.opencut : null;
		if (!oc) return null;
		if (isObj(oc.scene) && typeof oc.scene.id === "string") return `scene:${oc.scene.id}`;
		if (isObj(oc.track) && typeof oc.track.id === "string") return `track:${oc.track.id}`;
		if (isObj(oc.element) && typeof oc.element.id === "string") return `element:${oc.element.id}`;
		if (typeof oc.lane === "number") return `lane:${oc.lane}`;
		return null;
	};
	const out: string[] = [];
	let marks = 0;
	arr.forEach((v, i) => {
		const id = own(v);
		if (id) { out.push(id); return; }
		if (isObj(v) && v.OTIO_SCHEMA === "Gap.1") {
			const next = arr.slice(i + 1).map(own).find((x) => x !== null);
			out.push(`gap-before:${next ?? "end"}`);
			return;
		}
		if (isObj(v) && isObj(v.metadata?.opencut?.bookmark)) { out.push(`bookmark:${marks++}`); return; }
		out.push(`#${i}`);
	});
	return out;
}

/** The keys `file` holds that Cut's `written` form of it does not, by part; or where it would be damaged (a string). */
export function foreignOf(file: unknown, written: unknown): Foreign | string {
	const found: Foreign = new Map();
	const walk = (a: unknown, b: unknown, at: string): string | null => {
		if (Array.isArray(a) && Array.isArray(b)) {
			const ia = idents(a), ib = idents(b);
			if (ia.length !== ib.length || ia.some((x, i) => x !== ib[i])) return `${at || "/"} holds parts Cut's writer does not give back (${ia.join(", ")} against ${ib.join(", ")})`;
			for (let i = 0; i < a.length; i++) {
				const why = walk(a[i], b[i], `${at}/${ia[i]}`);
				if (why) return why;
			}
			return null;
		}
		if (isObj(a) && isObj(b)) {
			for (const k of Object.keys(b)) if (!(k in a)) return `${at}.${k} is written by Cut but the file lacks it`;
			for (const [k, v] of Object.entries(a)) {
				if (!(k in b)) {
					const mine = found.get(at) ?? {};
					mine[k] = clone(v);
					found.set(at, mine);
					continue;
				}
				const why = walk(v, b[k], `${at}.${k}`);
				if (why) return why;
			}
			return null;
		}
		return a === b ? null : `${at || "/"} is ${JSON.stringify(a)} in the file and ${JSON.stringify(b)} as Cut writes it`;
	};
	const why = walk(file, written, "");
	return why ?? found;
}

/** `written` with every foreign key put back on the part that held it (a part no longer there takes its keys with it). */
export function carry(written: J, foreign: Foreign): J {
	if (!foreign.size) return written;
	const out = clone(written);
	const walk = (v: unknown, at: string) => {
		if (Array.isArray(v)) {
			const ids = idents(v);
			v.forEach((x, i) => walk(x, `${at}/${ids[i]}`));
			return;
		}
		if (!isObj(v)) return;
		for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
		const mine = foreign.get(at);
		if (mine) for (const [k, x] of Object.entries(mine)) if (!(k in v)) v[k] = clone(x);
	};
	walk(out, "");
	return out;
}
