import { load } from "cheerio";
import type { Element } from "domhandler";
import type { CanvasKit, Path } from "canvaskit-wasm";
import { pathFromCheerioSvgLineElement, pathFromCheerioSvgPathElement } from "./pathFromCheerioSvgPathElement.js";
import { escapeXmlAttr, paintFromSvgPathAttribs } from "./svgPathPaint.js";

function isTag(n: unknown): n is Element {
    return typeof n === "object" && n !== null && (n as Element).type === "tag";
}

function identity9(): number[] {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/** Row-major 3×3: x' = m0*x+m1*y+m2, y' = m3*x+m4*y+m5 */
function multiply9(a: number[], b: number[]): number[] {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            o[i * 3 + j] =
                a[i * 3 + 0] * b[0 * 3 + j] + a[i * 3 + 1] * b[1 * 3 + j] + a[i * 3 + 2] * b[2 * 3 + j];
        }
    }
    return o;
}

function parseNumbers(s: string): number[] {
    return s
        .trim()
        .split(/[\s,]+/)
        .map((x) => parseFloat(x))
        .filter((n) => Number.isFinite(n));
}

/**
 * SVG `transform` list: cumulative matrix is T_n * … * T_1 (first token in the string
 * applies to the geometry first).
 */
function parseTransformList(str: string | undefined): number[] | null {
    if (!str?.trim()) return null;
    let acc = identity9();
    const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(str))) {
        const fn = m[1].toLowerCase();
        const nums = parseNumbers(m[2]);
        let local = identity9();
        if (fn === "matrix" && nums.length >= 6) {
            const [a, b, c, d, e, f] = nums;
            local = [a, c, e, b, d, f, 0, 0, 1];
        } else if (fn === "translate") {
            const tx = nums[0] ?? 0;
            const ty = nums[1] ?? 0;
            local = [1, 0, tx, 0, 1, ty, 0, 0, 1];
        } else if (fn === "scale") {
            const sx = nums[0] ?? 1;
            const sy = nums[1] ?? sx;
            local = [sx, 0, 0, 0, sy, 0, 0, 0, 1];
        } else if (fn === "rotate") {
            const deg = nums[0] ?? 0;
            const rad = (deg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            let r = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
            if (nums.length >= 3) {
                const cx = nums[1];
                const cy = nums[2];
                const t1 = [1, 0, cx, 0, 1, cy, 0, 0, 1];
                const t2 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
                r = multiply9(multiply9(t1, r), t2);
            }
            local = r;
        }
        acc = multiply9(local, acc);
    }
    return acc;
}

/** Leading number from width/height (`54mm` → 54). Must stay in document user units, not CSS px. */
function parseSvgSizeNumber(raw: string | undefined, fallback: number): number {
    const n = parseFloat(String(raw ?? "").trim());
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readSvgViewport(root: Element, fallbackVw: number, fallbackVh: number): { vx: number; vy: number; vw: number; vh: number } {
    const vbRaw = root.attribs?.viewbox ?? root.attribs?.viewBox;
    if (vbRaw?.trim()) {
        const vb = parseNumbers(vbRaw);
        if (vb.length === 4) return { vx: vb[0], vy: vb[1], vw: vb[2], vh: vb[3] };
    }
    return {
        vx: 0,
        vy: 0,
        vw: parseSvgSizeNumber(root.attribs?.width, fallbackVw),
        vh: parseSvgSizeNumber(root.attribs?.height, fallbackVh),
    };
}

function tagLocalName(name: string): string {
    const i = name.indexOf(":");
    return i === -1 ? name : name.slice(i + 1);
}

function findRectById(el: Element, id: string): Element | null {
    if (
        el.type === "tag" &&
        el.attribs?.id === id &&
        tagLocalName(el.name).toLowerCase() === "rect"
    ) {
        return el;
    }
    for (const ch of el.children ?? []) {
        if (!isTag(ch)) continue;
        const f = findRectById(ch, id);
        if (f) return f;
    }
    return null;
}

/**
 * Prefer a full-page `<rect>` (template markers) over `viewBox` alone so Inkscape edits to
 * viewBox do not change the scale basis when the page rect still matches the module.
 */
function readLogicalPageExtent(root: Element): { vx: number; vy: number; vw: number; vh: number } | null {
    for (const id of ["page-bounds", "page-frame", "page"] as const) {
        const rect = findRectById(root, id);
        if (!rect) continue;
        const a = rect.attribs ?? {};
        const vw = parseSvgSizeNumber(a.width, 0);
        const vh = parseSvgSizeNumber(a.height, 0);
        if (!(vw > 0 && vh > 0)) continue;
        const vx = Number.isFinite(parseFloat(String(a.x ?? "0"))) ? parseFloat(String(a.x ?? "0")) : 0;
        const vy = Number.isFinite(parseFloat(String(a.y ?? "0"))) ? parseFloat(String(a.y ?? "0")) : 0;
        return { vx, vy, vw, vh };
    }
    return null;
}

/** Both root `width` and `height` as `…mm` (Inkscape page size). */
function parseRootWidthHeightMm(widthAttr: string | undefined, heightAttr: string | undefined): { w: number; h: number } | null {
    const mm = /^([\d.+-]+(?:e[-+]?\d+)?)\s*mm$/i;
    const mw = widthAttr?.trim() ? mm.exec(widthAttr.trim()) : null;
    const mh = heightAttr?.trim() ? mm.exec(heightAttr.trim()) : null;
    if (!mw || !mh) return null;
    const w = parseFloat(mw[1]);
    const h = parseFloat(mh[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
}

function hasUsableViewBox(root: Element): boolean {
    const vbRaw = root.attribs?.viewbox ?? root.attribs?.viewBox;
    if (!vbRaw?.trim()) return false;
    return parseNumbers(vbRaw).length === 4;
}

/**
 * Page size for uniform scale:
 * 1) `#page-bounds` / `#page-frame` / `#page` rects (explicit page in the file)
 * 2) `moduleMm` — same mm as `SplitFlap.init()` / `createFLAP` (authoritative when rects absent)
 * 3) `viewBox` + root `width`/`height` heuristics (bare SVGs)
 */
function resolvePageExtent(
    root: Element,
    moduleMm: { w: number; h: number } | undefined,
): { vx: number; vy: number; vw: number; vh: number } {
    const logical = readLogicalPageExtent(root);
    if (logical) return logical;

    if (moduleMm && moduleMm.w > 0 && moduleMm.h > 0) {
        return { vx: 0, vy: 0, vw: moduleMm.w, vh: moduleMm.h };
    }

    const fromView = readSvgViewport(root, 100, 100);
    const declared = parseRootWidthHeightMm(root.attribs?.width, root.attribs?.height);
    if (!declared) return fromView;

    if (!hasUsableViewBox(root)) {
        return { vx: 0, vy: 0, vw: declared.w, vh: declared.h };
    }

    const sizeMismatch =
        Math.abs(fromView.vw - declared.w) > 0.2 || Math.abs(fromView.vh - declared.h) > 0.2;
    if (sizeMismatch) {
        return { vx: 0, vy: 0, vw: declared.w, vh: declared.h };
    }

    return fromView;
}

/** If root declares `54mm`×`86mm` but viewBox is `53.999999`×`85.999998`, snap so scale matches the page. */
function snapViewBoxToDeclaredMm(
    vw: number,
    vh: number,
    widthAttr: string | undefined,
    heightAttr: string | undefined,
): { vw: number; vh: number } {
    const mm = /^([\d.+-]+(?:e[-+]?\d+)?)\s*mm$/i;
    const mw = widthAttr?.trim() ? mm.exec(widthAttr.trim()) : null;
    const mh = heightAttr?.trim() ? mm.exec(heightAttr.trim()) : null;
    if (!mw || !mh) return { vw, vh };
    const wMm = parseFloat(mw[1]);
    const hMm = parseFloat(mh[1]);
    if (!Number.isFinite(wMm) || !Number.isFinite(hMm)) return { vw, vh };
    let outW = vw;
    let outH = vh;
    if (Math.abs(vw - wMm) < 0.05) outW = wMm;
    if (Math.abs(vh - hMm) < 0.05) outH = hMm;
    return { vw: outW, vh: outH };
}

/** Map viewBox user units → flap pixel rect [0,targetW]×[0,targetH] (uniform scale, centered). */
function fitViewBoxMatrix(vx: number, vy: number, vw: number, vh: number, targetW: number, targetH: number): number[] {
    if (vw <= 0 || vh <= 0 || targetW <= 0 || targetH <= 0) return identity9();
    const sx = targetW / vw;
    const sy = targetH / vh;
    const maxS = Math.max(sx, sy);
    const s =
        maxS > 0 && Math.abs(sx - sy) / maxS < 1e-5 ? (sx + sy) / 2 : Math.min(sx, sy);
    if (!Number.isFinite(s) || s <= 0) return identity9();
    const tx = (targetW - vw * s) / 2 - vx * s;
    const ty = (targetH - vh * s) / 2 - vy * s;
    return [s, 0, tx, 0, s, ty, 0, 0, 1];
}

const flipY9 = (H: number): number[] => [1, 0, 0, 0, -1, H, 0, 0, 1];

function pathToTransformedD(CK: CanvasKit, d: string, m: number[]): string | null {
    const local = CK.Path.MakeFromSVGString(d);
    if (!local) return null;
    const pb = new CK.PathBuilder();
    pb.addPath(local, m);
    const out = pb.snapshot();
    local.delete();
    const s = out.toSVGString()?.trim() ?? "";
    out.delete();
    return s || null;
}

function pathFromLineEl(CK: CanvasKit, el: Element, m: number[]): Path | null {
    const a = el.attribs ?? {};
    const svgMat = `matrix(${m[0]},${m[3]},${m[1]},${m[4]},${m[2]},${m[5]})`;
    return pathFromCheerioSvgLineElement(CK, { attribs: { ...a, transform: svgMat } });
}

function pathToD(CK: CanvasKit, p: Path): string | null {
    const s = p.toSVGString()?.trim() ?? "";
    return s || null;
}

function rectToD(x: number, y: number, w: number, h: number): string {
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function circleToD(cx: number, cy: number, r: number): string {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
}

function ellipseToD(cx: number, cy: number, rx: number, ry: number): string {
    return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy}`;
}

function parsePoints(s: string | undefined): [number, number][] {
    if (!s?.trim()) return [];
    const nums = parseNumbers(s);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    return out;
}

type EmitSeg = { d: string; fill?: string; stroke?: string; strokeWidth?: string };

function visitElement(
    CK: CanvasKit,
    el: Element,
    parentM: number[],
    defaultFill: string,
    out: EmitSeg[],
): void {
    const name = el.name.toLowerCase();
    if (
        name === "defs" ||
        name === "clippath" ||
        name === "mask" ||
        name === "title" ||
        name === "desc" ||
        name === "style" ||
        name === "script" ||
        name === "metadata"
    ) {
        return;
    }

    const local = parseTransformList(el.attribs?.transform);
    const m = local ? multiply9(parentM, local) : parentM;

    if (name === "g" || name === "svg") {
        for (const ch of el.children) {
            if (isTag(ch)) visitElement(CK, ch, m, defaultFill, out);
        }
        return;
    }

    const attribs = { ...(el.attribs ?? {}) } as Record<string, string | undefined>;
    const paint = paintFromSvgPathAttribs(attribs, defaultFill);

    if (name === "path") {
        const p = pathFromCheerioSvgPathElement(CK, { attribs: { d: attribs.d, transform: undefined } });
        if (!p) return;
        const pb = new CK.PathBuilder();
        pb.addPath(p, m);
        const snap = pb.snapshot();
        p.delete();
        const d = pathToD(CK, snap);
        snap.delete();
        if (d) out.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
        return;
    }

    if (name === "line") {
        const lp = pathFromLineEl(CK, el, m);
        if (!lp) return;
        const d = pathToD(CK, lp);
        lp.delete();
        if (d) out.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
        return;
    }

    if (name === "rect") {
        const x = parseFloat(attribs.x ?? "0");
        const y = parseFloat(attribs.y ?? "0");
        const w = parseFloat(attribs.width ?? "0");
        const h = parseFloat(attribs.height ?? "0");
        if (!(w > 0 && h > 0)) return;
        const d0 = rectToD(x, y, w, h);
        const d = pathToTransformedD(CK, d0, m);
        if (d) out.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
        return;
    }

    if (name === "circle") {
        const cx = parseFloat(attribs.cx ?? "0");
        const cy = parseFloat(attribs.cy ?? "0");
        const r = parseFloat(attribs.r ?? "0");
        if (!(r > 0)) return;
        const d0 = circleToD(cx, cy, r);
        const d = pathToTransformedD(CK, d0, m);
        if (d) out.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
        return;
    }

    if (name === "ellipse") {
        const cx = parseFloat(attribs.cx ?? "0");
        const cy = parseFloat(attribs.cy ?? "0");
        const rx = parseFloat(attribs.rx ?? "0");
        const ry = parseFloat(attribs.ry ?? "0");
        if (!(rx > 0 && ry > 0)) return;
        const d0 = ellipseToD(cx, cy, rx, ry);
        const d = pathToTransformedD(CK, d0, m);
        if (d) out.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
        return;
    }

    if (name === "polygon" || name === "polyline") {
        const pts = parsePoints(attribs.points);
        if (pts.length < 2) return;
        let d0 = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length; i++) d0 += ` L ${pts[i][0]} ${pts[i][1]}`;
        if (name === "polygon") d0 += " Z";
        const d = pathToTransformedD(CK, d0, m);
        if (d) out.push({ d, fill: paint.fill, stroke: paint.stroke, strokeWidth: paint.strokeWidth });
        return;
    }

    for (const ch of el.children ?? []) {
        if (isTag(ch)) visitElement(CK, ch, m, defaultFill, out);
    }
}

function buildClipSvg(W: number, H: number, segments: EmitSeg[]): string {
    const body = segments
        .map((s) => {
            let extra = "";
            if (s.stroke) extra += ` stroke="${escapeXmlAttr(s.stroke)}"`;
            if (s.strokeWidth) extra += ` stroke-width="${escapeXmlAttr(s.strokeWidth)}"`;
            return `<path fill-rule="evenodd" d="${escapeXmlAttr(s.d)}" fill="${escapeXmlAttr(s.fill ?? "#000")}"${extra} />`;
        })
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

function transformSegments(CK: CanvasKit, segments: EmitSeg[], m: number[]): EmitSeg[] {
    const out: EmitSeg[] = [];
    for (const s of segments) {
        const local = CK.Path.MakeFromSVGString(s.d);
        if (!local) continue;
        const pb = new CK.PathBuilder();
        pb.addPath(local, m);
        const snap = pb.snapshot();
        local.delete();
        const d = pathToD(CK, snap);
        snap.delete();
        if (d) out.push({ ...s, d });
    }
    return out;
}

/**
 * Satori rasterizes nested `<svg>` as `<image>`, which the flap clipper ignores (it only
 * intersects `<path>` / `<line>`). Flatten user SVG into path-only documents in module px.
 */
export function flattenUserSvgForClip(
    CK: CanvasKit,
    svgMarkup: string,
    widthPx: number,
    heightPx: number,
    defaultFill = "#000000",
    /** When set (normal path: flap `width`/`height` mm from `init`), scale user space to the module even if Inkscape mangles `viewBox`. */
    moduleMm?: { widthMm: number; heightMm: number },
): { normal: string; inverted: string } {
    const trimmed = svgMarkup.trim();
    const wrapped = /^<\s*svg\b/i.test(trimmed) ? trimmed : `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>`;

    const $ = load(wrapped, { xmlMode: true });
    const root = $("svg").first().get(0);
    if (!isTag(root)) return { normal: "", inverted: "" };

    const moduleDims =
        moduleMm && moduleMm.widthMm > 0 && moduleMm.heightMm > 0
            ? { w: moduleMm.widthMm, h: moduleMm.heightMm }
            : undefined;
    let { vx, vy, vw, vh } = resolvePageExtent(root, moduleDims);
    ({ vw, vh } = snapViewBoxToDeclaredMm(vw, vh, root.attribs?.width, root.attribs?.height));
    const M_fit = fitViewBoxMatrix(vx, vy, vw, vh, widthPx, heightPx);
    const rootLocal = parseTransformList(root.attribs?.transform);
    const M0 = rootLocal ? multiply9(M_fit, rootLocal) : M_fit;

    const segments: EmitSeg[] = [];
    for (const ch of root.children) {
        if (isTag(ch)) visitElement(CK, ch, M0, defaultFill, segments);
    }

    const normal = buildClipSvg(widthPx, heightPx, segments);
    const flipped = transformSegments(CK, segments, flipY9(heightPx));
    const inverted = buildClipSvg(widthPx, heightPx, flipped);
    return { normal, inverted };
}
