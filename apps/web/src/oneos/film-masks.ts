/**
 * The masks on Film's OWN clip, edited in Cut and written back in FILM'S shape (OneOS doctrine files/989, part 2 "Masks, both ways";
 * Mona 2026-11-09: "yes, so this becomes a tool choice not a file type choicer"). Film keeps a clip's masks on its Opacity
 * (`metadata.filmcraft.effects[opacity].masks`, filmcraft `project/src/mask.rs` `Mask`): a closed cubic Bezier path in clip pixels (the
 * medium's own pixels) or a text, a feather and an expansion measured in clip or canvas pixels (`units`), an opacity in percent, an
 * inversion, a mode (how it combines with the masks above it) and a tracking method. Cut opens each as its own mask on the element:
 *
 * | Film | Cut |
 * |---|---|
 * | a path (vertices in clip pixels, tangents relative) | a `custom` mask (points in fractions of the element about its centre) |
 * | a text (`MaskText`, laid in a box of the clip) | a `text` mask on the element's box |
 * | feather, expansion, units Clip / Canvas | `feather`, `expansion`, `units: "clip"` / absent (the canvas's pixels, Cut's own) |
 * | opacity (percent), inverted, mode, track_method, name | `opacity` (0..1), `inverted`, `mode`, `track`, `name` |
 *
 * A save writes back ONLY what Cut changed: a mask Cut did not change is Film's mask exactly; a changed one keeps every parameter of Film's
 * that Cut did not change and rewrites the rest (a reshaped mask is the path Cut's own definition draws, the paths of `mask-paths.json`; a
 * text is Film's text in the element's box); a mask Cut adds is Film's mask of the same shape. What Film's mask has no place for is refused by
 * name, nothing written: a stroke (`mask-not-in-film`). What Cut's masks have no place for locks the track, named: keyframes on a mask
 * (Cut's masks hold none), a mask on an effect rather than the clip, a medium whose pixel size the file does not carry. Pure.
 */

type J = Record<string, any>;

/** The element's own pixels: Film's clip pixels of the medium (its width and height). */
export interface Box { w: number; h: number }

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const json = (v: unknown) => JSON.stringify(v);
const r9 = (x: number) => { const y = Math.round(x * 1e9) / 1e9; return Object.is(y, -0) ? 0 : y; };
const num = (p: J, k: string, d: number): number => (typeof p?.[k] === "number" ? p[k] : d);
const str = (p: J, k: string, d: string): string => (typeof p?.[k] === "string" ? p[k] : d);

/** Film's circle tangent (filmcraft `mask::KAPPA`). */
const KAPPA = 0.5522847498307934;

/** Film's masks on its clip (the Opacity's), or [] when it holds none. */
export function filmMasks(effects: J[]): J[] {
	const op = effects.find((e) => isObj(e) && e.effect === "opacity");
	return Array.isArray(op?.masks) ? op.masks : [];
}

/** The medium's pixel size Film wrote on the clip's reference (`metadata.filmcraft.info.video`), or null. */
export function mediumBox(clip: J): Box | null {
	const v = clip?.media_references?.DEFAULT_MEDIA?.metadata?.filmcraft?.info?.video;
	if (!isObj(v) || typeof v.width !== "number" || typeof v.height !== "number" || v.width <= 0 || v.height <= 0) return null;
	const par = v.par;
	// Film's clip pixels are the stored pixels; Cut's fractions are of the picture as shown. Only square pixels are the same box.
	if (Array.isArray(par) && par[0] !== par[1]) return null;
	return { w: v.width, h: v.height };
}

const MODES = ["None", "Add", "Subtract", "Intersect", "Lighten", "Darken", "Difference"];
const TRACKS: Record<string, string> = { Position: "position", PositionRotation: "position-rotation", PositionScaleRotation: "position-scale-rotation" };
const TRACKS_BACK = Object.fromEntries(Object.entries(TRACKS).map(([k, v]) => [v, k]));
const LABEL: Record<string, string> = { split: "Split", "cinematic-bars": "Cinematic Bars", rectangle: "Rectangle", ellipse: "Ellipse", heart: "Heart", diamond: "Diamond", star: "Star", text: "Text" };
/** A mask's look: what is not its shape. */
const LOOK = ["feather", "inverted", "strokeColor", "strokeWidth", "strokeAlign", "mode", "opacity", "expansion", "units"];
const keyed = (p: J) => Array.isArray(p?.keyframes) && p.keyframes.length > 0;
const float = (p: J, d: number) => (typeof p?.value?.Float === "number" ? p.value.Float : d);

/** Why Cut cannot show Film's masks on this clip without damage, or null. */
export function filmMasksLock(effects: J[], box: Box | null, name: string): string | null {
	const other = effects.find((e) => isObj(e) && e.effect !== "opacity" && Array.isArray(e.masks) && e.masks.length);
	if (other) return `effect-mask-not-in-cut: Film masks its ${other.effect} on "${name}", where Cut's masks are the element's, not an effect's`;
	const masks = filmMasks(effects);
	if (!masks.length) return null;
	if (!box) return `mask-size-unknown: the file does not carry the square pixel size of "${name}"'s medium, so Film's masks have no place in Cut's fractions of it`;
	for (const m of masks) {
		for (const k of ["path", "feather", "opacity", "expansion"]) if (keyed(m[k])) return `mask-keyframes-not-in-cut: Film animates the ${k} of the mask "${m.name}" on "${name}", and Cut's masks hold no keyframes`;
		const path = m.path?.value?.Path;
		if (!isObj(path)) return `the mask "${m.name}" on "${name}" has no path`;
		if (m.text && path.vertices?.length) return `text-mask-path-not-in-cut: the text mask "${m.name}" on "${name}" holds a path beside its text, and Cut's text mask is its text alone`;
		if (!MODES.includes(m.mode ?? "Add") || !(m.track_method === undefined || m.track_method in TRACKS)) return `the mask "${m.name}" on "${name}" has a mode or tracking Cut does not know`;
		if (m.text && !["none", "underline", "line-through", undefined].includes(m.text.decoration)) return `the text mask "${m.name}" on "${name}" has a decoration Cut does not know`;
	}
	return null;
}

/** Film's text as Cut's text mask's own parameters on the element's box (filmcraft `cut_masks::cut_text`; the box is the whole clip). */
function cutText(t: J, b: Box): J {
	const [fx, fy, fw, fh] = t.frame as number[];
	const same = fx === 0 && fy === 0 && fw === b.w && fh === b.h;
	const c = t.center ?? { x: 0, y: 0 };
	const [cx, cy, size] = same ? [c.x, c.y, t.size] : [(fx + fw / 2 + c.x * fw - b.w / 2) / b.w, (fy + fh / 2 + c.y * fh - b.h / 2) / b.h, (t.size * fh) / b.h];
	return {
		content: t.content, fontSize: r9(size), fontFamily: t.family, fontWeight: t.bold ? "bold" : "normal", fontStyle: t.italic ? "italic" : "normal",
		textDecoration: t.decoration ?? "none", letterSpacing: r9(t.letter_spacing ?? 0), lineHeight: r9(t.line_height), centerX: r9(cx), centerY: r9(cy),
		rotation: r9(t.rotation ?? 0), scale: r9(t.scale),
	};
}

/** Cut's text mask as Film's text in the element's box (filmcraft `cut_masks::film_text`), or why Film's text cannot hold it. */
function filmText(p: J, b: Box): J | string {
	const w = str(p, "fontWeight", "normal"), s = str(p, "fontStyle", "normal"), d = str(p, "textDecoration", "none");
	if (w !== "normal" && w !== "bold") return `a text mask's weight "${w}"`;
	if (s !== "normal" && s !== "italic") return `a text mask's style "${s}"`;
	if (!["none", "underline", "line-through"].includes(d)) return `a text mask's decoration "${d}"`;
	return {
		content: str(p, "content", ""), family: str(p, "fontFamily", "Arial"), bold: w === "bold", italic: s === "italic", decoration: d,
		size: num(p, "fontSize", 15), letter_spacing: num(p, "letterSpacing", 0), line_height: num(p, "lineHeight", 1.2), frame: [0, 0, b.w, b.h],
		center: { x: num(p, "centerX", 0), y: num(p, "centerY", 0) }, rotation: num(p, "rotation", 0), scale: num(p, "scale", 1),
	};
}

/** Film's masks on its clip as Cut's masks on the element (`filmMasksLock` first: this assumes Cut can hold them). */
export function cutMasksOf(effects: J[], b: Box): J[] {
	return filmMasks(effects).map((m, i) => {
		const path = m.path.value.Path;
		const mode = (m.mode ?? "Add") as string;
		const params: J = { feather: float(m.feather, 0), inverted: m.inverted === true, strokeColor: "#ffffff", strokeWidth: 0, strokeAlign: "center" };
		let type: string;
		if (m.text) {
			type = "text";
			Object.assign(params, cutText(m.text, b));
		} else {
			type = "custom";
			// Film fills an open path as if closed unless it is off (mode None); Cut draws a custom path only when it is closed.
			Object.assign(params, {
				path: (path.vertices as J[]).map((v, k) => ({
					id: `film-p${k}`, x: r9(v.p.x / b.w - 0.5), y: r9(v.p.y / b.h - 0.5),
					inX: r9((v.t_in?.x ?? 0) / b.w), inY: r9((v.t_in?.y ?? 0) / b.h), outX: r9((v.t_out?.x ?? 0) / b.w), outY: r9((v.t_out?.y ?? 0) / b.h),
				})),
				closed: path.closed !== false || mode !== "None", centerX: 0, centerY: 0, rotation: 0, scale: 1,
			});
		}
		params.mode = mode.toLowerCase();
		params.opacity = r9(float(m.opacity, 100) / 100);
		params.expansion = float(m.expansion, 0);
		if (m.units !== "Canvas") params.units = "clip";
		return { id: `film-mask-${i}`, name: m.name, track: TRACKS[m.track_method ?? "PositionScaleRotation"], type, params };
	});
}

type V = { x: number; y: number };
const rotAbout = (x: number, y: number, cx: number, cy: number, a: number): V => {
	const dx = x - cx, dy = y - cy;
	return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
};
const corner = (p: V): J => ({ p, t_in: { x: 0, y: 0 }, t_out: { x: 0, y: 0 } });
const poly = (ps: V[]): J => ({ vertices: ps.map(corner), closed: true });
const boxLike = (p: J, w: number, h: number) => ({
	cx: w / 2 + num(p, "centerX", 0) * w, cy: h / 2 + num(p, "centerY", 0) * h,
	mw: Math.max(num(p, "width", 0.6), 0.01) * w, mh: Math.max(num(p, "height", 0.6), 0.01) * h, rot: (num(p, "rotation", 0) * Math.PI) / 180,
});
const rect = (cx: number, cy: number, hw: number, hh: number, rot: number) =>
	poly([[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]].map(([x, y]) => rotAbout(x, y, cx, cy, rot)));

/** A split's half-plane on the side its normal points, cut to a box `w + h` beyond every edge (filmcraft `cut_masks::split`). */
function split(p: J, w: number, h: number): J {
	const m = w + h, bw = w + 2 * m, bh = h + 2 * m;
	const cx = (num(p, "centerX", 0) * w) / bw, cy = (num(p, "centerY", 0) * h) / bh;
	const a = (num(p, "rotation", 0) * Math.PI) / 180;
	const snap = (x: number) => (Math.abs(x) < 1e-10 ? 0 : x);
	const nx = snap(Math.cos(a)), ny = snap(Math.sin(a));
	const lx = bw / 2 + cx * bw, ly = bh / 2 + cy * bh;
	const side = (x: number, y: number) => (x - lx) * nx + (y - ly) * ny;
	const hit = (x1: number, y1: number, x2: number, y2: number): [number, number] | null => {
		const d1 = side(x1, y1), d2 = side(x2, y2), den = d1 - d2;
		if (Math.abs(den) < 1e-10) return null;
		const t = d1 / den;
		return t >= 0 && t <= 1 ? [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t] : null;
	};
	const v: Array<[number, number]> = [];
	for (const [x1, y1, x2, y2] of [[0, 0, bw, 0], [bw, 0, bw, bh], [bw, bh, 0, bh], [0, bh, 0, 0]]) {
		const i1 = side(x1, y1) >= 0, i2 = side(x2, y2) >= 0;
		if (i1 && i2) v.push([x2, y2]);
		else if (i1) { const q = hit(x1, y1, x2, y2); if (q) v.push(q); }
		else if (i2) { const q = hit(x1, y1, x2, y2); if (q) { v.push(q); v.push([x2, y2]); } }
	}
	const area = Math.abs(v.reduce((s, _, i) => s + v[i][0] * v[(i + 1) % v.length][1] - v[(i + 1) % v.length][0] * v[i][1], 0)) * 0.5;
	if (v.length < 3 || area < 0.5) return { vertices: [], closed: true };
	return poly(v.map(([x, y]) => ({ x: x - m, y: y - m })));
}

/**
 * The path of one of Cut's masks in the element's own pixels (`w` x `h`), as its definition draws it: a port of filmcraft
 * `cut_masks::cut_mask_path`, pinned like it to the editor's own `buildPath` (`fixtures/mask-paths.json`). A text mask has no path.
 */
export function cutMaskPath(mask: J, w: number, h: number): J | string {
	const p = mask?.params;
	if (!isObj(p)) return "a mask without params";
	switch (mask.type) {
		case "split": return split(p, w, h);
		case "cinematic-bars": {
			const cx = w / 2 + num(p, "centerX", 0) * w, cy = h / 2 + num(p, "centerY", 0) * h;
			return rect(cx, cy, Math.max(num(p, "width", 1) * w, w) / 2, (Math.max(num(p, "height", 0.6), 0.01) * h) / 2, (num(p, "rotation", 0) * Math.PI) / 180);
		}
		case "rectangle": { const g = boxLike(p, w, h); return rect(g.cx, g.cy, g.mw / 2, g.mh / 2, g.rot); }
		case "diamond": {
			const { cx, cy, mw, mh, rot } = boxLike(p, w, h);
			return poly([[cx, cy - mh / 2], [cx + mw / 2, cy], [cx, cy + mh / 2], [cx - mw / 2, cy]].map(([x, y]) => rotAbout(x, y, cx, cy, rot)));
		}
		case "star": {
			const { cx, cy, mw, mh, rot } = boxLike(p, w, h);
			return poly(Array.from({ length: 10 }, (_, i) => {
				const [rx, ry] = i % 2 === 0 ? [mw / 2, mh / 2] : [(mw / 2) * 0.45, (mh / 2) * 0.45];
				const a = (i * Math.PI) / 5 - Math.PI / 2;
				return rotAbout(cx + rx * Math.cos(a), cy + ry * Math.sin(a), cx, cy, rot);
			}));
		}
		case "ellipse": {
			const { cx, cy, mw, mh, rot } = boxLike(p, w, h);
			const rx = mw / 2, ry = mh / 2;
			const r = (x: number, y: number): V => ({ x: x * Math.cos(rot) - y * Math.sin(rot), y: x * Math.sin(rot) + y * Math.cos(rot) });
			const local: Array<[[number, number], [number, number]]> = [[[0, -ry], [rx * KAPPA, 0]], [[rx, 0], [0, ry * KAPPA]], [[0, ry], [-rx * KAPPA, 0]], [[-rx, 0], [0, -ry * KAPPA]]];
			return { vertices: local.map(([[px, py], [tx, ty]]) => { const q = r(px, py), u = r(tx, ty); return { p: { x: cx + q.x, y: cy + q.y }, t_in: { x: -u.x, y: -u.y }, t_out: u }; }), closed: true };
		}
		case "heart": {
			const { cx, cy, mw, mh, rot } = boxLike(p, w, h);
			const hw = mw / 2, hh = mh / 2;
			const at = (lx: number, ly: number) => rotAbout(cx + lx, cy + ly, cx, cy, rot);
			const start = at(0, -hh * 0.475), rc1 = at(hw, -hh * 1.225), rc2 = at(hw, -hh * 0.125), bottom = at(0, hh * 0.725);
			const lc1 = at(-hw, -hh * 0.125), lc2 = at(-hw, -hh * 1.225);
			const d = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
			return { vertices: [{ p: start, t_in: d(lc2, start), t_out: d(rc1, start) }, { p: bottom, t_in: d(rc2, bottom), t_out: d(lc1, bottom) }], closed: true };
		}
		case "custom": {
			const cx = w / 2 + num(p, "centerX", 0) * w, cy = h / 2 + num(p, "centerY", 0) * h;
			const rot = (num(p, "rotation", 0) * Math.PI) / 180, scale = num(p, "scale", 1);
			const to = (x: number, y: number): V => { const sx = x * w * scale, sy = y * h * scale; return { x: cx + sx * Math.cos(rot) - sy * Math.sin(rot), y: cy + sx * Math.sin(rot) + sy * Math.cos(rot) }; };
			const pts: J[] = Array.isArray(p.path) ? p.path : [];
			return {
				vertices: pts.map((q) => {
					const x = num(q, "x", 0), y = num(q, "y", 0), a = to(x, y);
					const i = to(x + num(q, "inX", 0), y + num(q, "inY", 0)), o = to(x + num(q, "outX", 0), y + num(q, "outY", 0));
					return { p: a, t_in: { x: i.x - a.x, y: i.y - a.y }, t_out: { x: o.x - a.x, y: o.y - a.y } };
				}),
				closed: p.closed === true,
			};
		}
		case "text": return "a text mask, whose shape is its text, not a path";
		default: return `the mask "${String(mask.type)}", which is not one of Cut's`;
	}
}

/** A path as Film writes it: coordinates rounded as Cut writes its own, a zero tangent left out (filmcraft `MaskVertex`'s serde). */
function filmPath(path: J): J {
	const pt = (v: V) => ({ x: r9(v.x), y: r9(v.y) });
	return {
		vertices: (path.vertices as J[]).map((v) => {
			const out: J = { p: pt(v.p) };
			if (v.t_in.x !== 0 || v.t_in.y !== 0) out.t_in = pt(v.t_in);
			if (v.t_out.x !== 0 || v.t_out.y !== 0) out.t_out = pt(v.t_out);
			return out;
		}),
		closed: path.closed,
	};
}

/** A Film parameter holding `value` (its other fields kept). */
const setFloat = (p: J | undefined, x: number): J => ({ ...(p ?? {}), value: { Float: r9(x) } });
const shapeOf = (m: J): J => ({ type: m.type, params: Object.fromEntries(Object.entries(m.params ?? {}).filter(([k]) => !LOOK.includes(k))) });

/**
 * Cut's masks on Film's clip written back as Film's: `film` is Film's masks as the file holds them, `was` Cut's masks as they opened (or were
 * last saved, index for index with `film`), `now` as the person left them. A string is why Film cannot hold Cut's edit (`code: why`).
 */
export function filmMasksFrom(film: J[], was: J[], now: J[], b: Box | null, name: string): J[] | string {
	if (json(was) === json(now)) return film;
	if (!b) return `mask-size-unknown: the file does not carry the square pixel size of "${name}"'s medium, so Cut's masks have no place in Film's clip pixels`;
	return now.map((n, i) => {
		const wi = was.findIndex((w) => w.id === n.id);
		const w = wi >= 0 ? was[wi] : null;
		if (w && json(w) === json(n) && film[wi]) return film[wi];
		const p = n.params ?? {};
		const label = n.name ?? LABEL[n.type] ?? "Custom";
		if (num(p, "strokeWidth", 0) > 0) return `mask-not-in-film: Cut strokes the mask "${label}" on "${name}", and Film's masks have no stroke`;
		const m: J = w && film[wi] ? clone(film[wi]) : {
			name: label, path: { value: { Path: { vertices: [], closed: true } } }, feather: { value: { Float: 0 } }, opacity: { value: { Float: 100 } },
			expansion: { value: { Float: 0 } }, inverted: false, mode: "Add", track_method: "PositionScaleRotation",
		};
		const changed = (k: string, d: unknown) => !w || json(w.params?.[k] ?? d) !== json(p[k] ?? d);
		if (!w || json(shapeOf(w)) !== json(shapeOf(n))) {
			if (n.type === "text") {
				const t = filmText(p, b);
				if (typeof t === "string") return `mask-not-in-film: ${t} on the mask "${label}" of "${name}" is not one of Film's`;
				const had = w?.type === "text" && m.text ? filmText(w.params ?? {}, b) : null;
				if (had && typeof had !== "string") {
					// Film's text with only what Cut changed rewritten (Film's own box and centre kept where Cut did not move them).
					// Its place is one thing: Cut's centre and size are on the element's box, so a move or resize writes the box with them.
					const placed = ["center", "size"].some((k) => json(had[k]) !== json(t[k]));
					for (const k of Object.keys(t)) if (json(had[k]) !== json(t[k]) || (placed && ["center", "size", "frame"].includes(k))) m.text[k] = t[k];
				} else {
					m.text = t;
					m.path = { ...m.path, value: { Path: { vertices: [], closed: true } } };
				}
			} else {
				const path = cutMaskPath(n, b.w, b.h);
				if (typeof path === "string") return `mask-not-in-film: ${path}`;
				delete m.text;
				m.path = { ...m.path, value: { Path: filmPath(path) } };
			}
		}
		const open = n.type === "custom" && p.closed !== true;
		if (changed("mode", "add") || (open && m.mode !== "None")) {
			const mode = open ? "None" : str(p, "mode", "add");
			const film = MODES.find((x) => x.toLowerCase() === mode);
			if (!film) return `mask-not-in-film: the mask mode "${mode}" of "${label}" on "${name}" is not one of Film's`;
			m.mode = film;
		}
		if (changed("units", "canvas")) {
			if (p.units === "clip") delete m.units;
			else m.units = "Canvas";
		}
		if (changed("feather", 0) || changed("units", "canvas")) m.feather = setFloat(m.feather, num(p, "feather", 0));
		if (changed("expansion", 0) || changed("units", "canvas")) m.expansion = setFloat(m.expansion, num(p, "expansion", 0));
		if (changed("opacity", 1)) m.opacity = setFloat(m.opacity, num(p, "opacity", 1) * 100);
		if (changed("inverted", false)) m.inverted = p.inverted === true;
		if (!w || (w.name ?? null) !== (n.name ?? null)) m.name = label;
		if (!w || (w.track ?? null) !== (n.track ?? null)) {
			const t = n.track === undefined ? "PositionScaleRotation" : TRACKS_BACK[n.track];
			if (!t) return `mask-not-in-film: the tracking "${n.track}" of "${label}" on "${name}" is not one of Film's`;
			m.track_method = t;
		}
		return m;
	}).reduce<J[] | string>((acc, m) => (typeof acc === "string" ? acc : typeof m === "string" ? m : [...acc, m]), []);
}
