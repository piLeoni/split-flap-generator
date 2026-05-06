/**
 * 3D production pipeline:
 * SVG paths -> Clipper planar ownership -> JSCAD depth-aware solids -> OBJ/MTL.
 */

import { Clipper, ClipperOffset, EndType, FillRule, JoinType, Path64, Paths64, Point64 } from "clipper2-js";
import { booleans, colors, extrusions, geometries, transforms } from "@jscad/modeling";
import type Geom2 from "@jscad/modeling/src/geometries/geom2/type.js";
import type Geom3 from "@jscad/modeling/src/geometries/geom3/type.js";
// @ts-expect-error Package ships without TypeScript declarations.
import * as objSerializer from "@jscad/obj-serializer";
import { load } from "cheerio";
import { SVGPathData } from "svg-pathdata";
import { flapSvgClass } from "./emitClippedContentPath.js";

const { geom2 } = geometries;
const { subtract, union } = booleans;
const { extrudeLinear } = extrusions;
const { colorize, cssColors } = colors;
const { mirrorZ, translate } = transforms;

const serializeObj = objSerializer.serialize as (
    options: { triangulate?: boolean },
    ...geoms: Geom3[]
) => string[];

const CSS_COLORS = cssColors as Readonly<Record<string, readonly [number, number, number]>>;
const CLIPPER_SCALE = 1_000;
const FLATTEN_STEP_PX = 0.8;
const MIN_RING_POINTS = 3;
const PX_PER_MM = 96 / 25.4;
const OBJ_EXPORT_SCALE = 0.001;
const CUT_SAFETY_MARGIN_MM = 0.02;
const DEFAULT_INTERNAL_XY_CLEARANCE_MM = 0.05;
const DEFAULT_INTERNAL_Z_CLEARANCE_MM = 0;

export const FLAP_FACE_LAYER_ORDER = ["topFlap", "topContent", "bottomFlap", "bottomContent"] as const;
export type FlapFaceLayerKey = (typeof FLAP_FACE_LAYER_ORDER)[number];
export type FlapFaceLayerGeoms = { [K in FlapFaceLayerKey]: Geom2[] | null };
export type GenerateFlap3DInput = {
    faceSvg: string;
    flapThickness: number;
    embossDepth: number;
    /** Millimetres — lateral XY separation between flap pockets and content solids. Default `0.05`. */
    internalXYClearanceMm?: number;
    /** Millimetres — optional bottom-side Z gap inside each pocket while keeping visible surface flush. Default `0`. */
    internalZClearanceMm?: number;
    /** File name prefix; OBJ/MTL stems are `${meshName}_full`. Default `mesh`. */
    meshName?: string;
};

/** In-memory Wavefront OBJ body and optional MTL (empty string when the mesh uses no materials). */
export type GenerateFlap3DOutput = {
    meshFileStem: string;
    obj: string;
    mtl: string;
    /** `${meshFileStem}.mtl` */
    mtlFileName: string;
};

type Point2 = [number, number];
type ClassifiedPath = { d: string; fill: string; classes: string[] };
type SideBuild = {
    flapGeoms: Geom2[];
    flapFill: string;
    cutFootprint: Geom2[];
    visiblePieces: Array<{ geoms: Geom2[]; fill: string }>;
};
type Rgba = [number, number, number, number];
type VisiblePiece = { geoms: Geom2[]; fill: string };

function collectUsemtlNames(objBody: string): string[] {
    const names = new Set<string>();
    const re = /^usemtl\s+(\S+)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(objBody)) !== null) names.add(m[1]!);
    return [...names];
}

function kdLine(name: string): [number, number, number] {
    const c = CSS_COLORS[name];
    if (c) return [c[0], c[1], c[2]];
    if (name === "default") return [CSS_COLORS.gray[0], CSS_COLORS.gray[1], CSS_COLORS.gray[2]];
    return [CSS_COLORS.gray[0], CSS_COLORS.gray[1], CSS_COLORS.gray[2]];
}

function buildObjMtlPair(objBody: string, mtlFileName: string): { obj: string; mtl: string } {
    const names = collectUsemtlNames(objBody);
    if (names.length === 0) {
        return { obj: objBody, mtl: "" };
    }
    let mtl = "# Wavefront MTL — Kd allineati ai nomi CSS usati da JSCAD OBJ\n";
    for (const name of names) {
        const [r, g, b] = kdLine(name);
        mtl += `\nnewmtl ${name}\n`;
        mtl += `illum 1\n`;
        mtl += `Kd ${r} ${g} ${b}\n`;
        mtl += `Ka ${r} ${g} ${b}\n`;
        mtl += `Ks 0 0 0\n`;
        mtl += `d 1\n`;
    }

    let obj = objBody;
    if (!/^mtllib\s/m.test(obj)) {
        const firstNl = obj.indexOf("\n");
        if (firstNl === -1) obj = `mtllib ${mtlFileName}\n${obj}`;
        else {
            const head = obj.slice(0, firstNl);
            const tail = obj.slice(firstNl + 1);
            if (head.startsWith("#")) obj = `${head}\nmtllib ${mtlFileName}\n${tail}`;
            else obj = `mtllib ${mtlFileName}\n${obj}`;
        }
    }

    return { obj, mtl };
}

function parseClassNames(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
        .split(/\s+/g)
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
}

function classifySvgPaths(faceSvg: string): ClassifiedPath[] {
    const $ = load(faceSvg, { xml: true });
    const out: ClassifiedPath[] = [];
    $("path").each((_, node) => {
        const d = $(node).attr("d")?.trim() ?? "";
        if (!d) return;
        out.push({
            d,
            fill: $(node).attr("fill")?.trim() || "default",
            classes: parseClassNames($(node).attr("class")),
        });
    });
    return out;
}

function uniqueRing(ring: Point2[]): Point2[] {
    const uniq: Point2[] = [];
    let prev: Point2 | null = null;
    for (const p of ring) {
        if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
        uniq.push(p);
        prev = p;
    }
    if (uniq.length >= 2) {
        const first = uniq[0]!;
        const last = uniq[uniq.length - 1]!;
        if (first[0] === last[0] && first[1] === last[1]) uniq.pop();
    }
    return uniq;
}

function cubicAt(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return [
        mt2 * mt * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t2 * t * p3[0],
        mt2 * mt * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t2 * t * p3[1],
    ];
}

function dist(a: Point2, b: Point2): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.hypot(dx, dy);
}

function sampleSteps(a: Point2, b: Point2, c: Point2, d: Point2): number {
    const est = dist(a, b) + dist(b, c) + dist(c, d);
    return Math.max(4, Math.ceil(est / FLATTEN_STEP_PX));
}

function toRings(d: string): Point2[][] {
    const commands = new SVGPathData(d).toAbs().normalizeHVZ().normalizeST().qtToC().aToC().commands;
    const rings: Point2[][] = [];
    let ring: Point2[] = [];
    let start: Point2 = [0, 0];
    let curr: Point2 = [0, 0];
    for (const c of commands) {
        switch (c.type) {
            case SVGPathData.MOVE_TO: {
                if (ring.length >= MIN_RING_POINTS) rings.push(uniqueRing(ring));
                curr = [c.x, c.y];
                start = [c.x, c.y];
                ring = [[c.x, c.y]];
                break;
            }
            case SVGPathData.LINE_TO: {
                curr = [c.x, c.y];
                ring.push(curr);
                break;
            }
            case SVGPathData.CURVE_TO: {
                const p0 = curr;
                const p1: Point2 = [c.x1, c.y1];
                const p2: Point2 = [c.x2, c.y2];
                const p3: Point2 = [c.x, c.y];
                const steps = sampleSteps(p0, p1, p2, p3);
                for (let i = 1; i <= steps; i++) ring.push(cubicAt(p0, p1, p2, p3, i / steps));
                curr = p3;
                break;
            }
            case SVGPathData.CLOSE_PATH: {
                ring.push(start);
                if (ring.length >= MIN_RING_POINTS) rings.push(uniqueRing(ring));
                ring = [];
                curr = start;
                break;
            }
            default:
                break;
        }
    }
    if (ring.length >= MIN_RING_POINTS) rings.push(uniqueRing(ring));
    return rings.filter((r) => r.length >= MIN_RING_POINTS);
}

function scaleInt(n: number): number {
    return Math.round(n * CLIPPER_SCALE);
}

function unscaleInt(n: number): number {
    return n / CLIPPER_SCALE;
}

function svgPxToModelMm(pt: Point2): Point2 {
    // SVG is +Y down in px; model space is +Y up in mm.
    return [pt[0] / PX_PER_MM, -pt[1] / PX_PER_MM];
}

function ringToPath64(ring: Point2[]): Path64 {
    const path64 = new Path64();
    for (const p of ring) {
        const [xMm, yMm] = svgPxToModelMm(p);
        path64.push(new Point64(scaleInt(xMm), scaleInt(yMm)));
    }
    return Clipper.stripDuplicates(path64, true);
}

function paths64FromPathData(d: string): Paths64 {
    const out = new Paths64();
    const rings = toRings(d);
    for (const ring of rings) {
        const p = ringToPath64(ring);
        if (p.length >= MIN_RING_POINTS) out.push(p);
    }
    return out;
}

function appendPaths(target: Paths64, source: Paths64): Paths64 {
    for (const p of source) target.push(p);
    return target;
}

function unionPaths(a: Paths64, b?: Paths64): Paths64 {
    if (b && b.length > 0) return Clipper.Union(a, b, FillRule.EvenOdd);
    return Clipper.Union(a, undefined, FillRule.EvenOdd);
}

function differencePaths(subject: Paths64, clip: Paths64): Paths64 {
    if (subject.length === 0) return new Paths64();
    if (clip.length === 0) return subject;
    return Clipper.Difference(subject, clip, FillRule.EvenOdd);
}

function offsetPaths(paths: Paths64, deltaMm: number): Paths64 {
    if (paths.length === 0 || deltaMm === 0) return paths;
    const deltaInt = Math.round(deltaMm * CLIPPER_SCALE);
    if (deltaInt === 0) return paths;
    const offset = new ClipperOffset();
    offset.addPaths(paths, JoinType.Round, EndType.Polygon);
    const out = new Paths64();
    offset.execute(deltaInt, out);
    return out;
}

function ringCentroid(ring: [number, number][]): [number, number] {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
        sx += x;
        sy += y;
    }
    const n = ring.length;
    return [sx / n, sy / n];
}

function ringSignedArea(ring: [number, number][]): number {
    let a = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % n]!;
        a += x1 * y2 - x2 * y1;
    }
    return a / 2;
}

/** Punto in poligono (non-zero winding); `ring` chiuso implicitamente. */
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
    const x = pt[0];
    const y = pt[1];
    let inside = false;
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[i]![0];
        const yi = ring[i]![1];
        const xj = ring[j]![0];
        const yj = ring[j]![1];
        const denom = yj - yi + Number.EPSILON;
        const intersect = yi !== yj && (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / denom + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Genitore = contorno più piccolo che **contiene ancora** il centroide di `ringIndex`,
 * ma con area **strettamente maggiore** di quella di `ringIndex` (altrimenti il centroide
 * della O esterna nel buco finirebbe “dentro” solo l’anello interno e l’albero si invertirebbe).
 */
function findContainingParentRingIndex(
    ringIndex: number,
    rings: [number, number][][],
    centroids: [number, number][],
): number {
    let best = -1;
    let bestArea = Infinity;
    const c = centroids[ringIndex]!;
    const childAbs = Math.abs(ringSignedArea(rings[ringIndex]!));
    for (let j = 0; j < rings.length; j++) {
        if (j === ringIndex) continue;
        if (!pointInRing(c, rings[j]!)) continue;
        const aj = Math.abs(ringSignedArea(rings[j]!));
        if (aj <= childAbs) continue;
        if (aj < bestArea) {
            bestArea = aj;
            best = j;
        }
    }
    return best;
}

function buildGeom2FromRingSubtree(i: number, rings: [number, number][][], children: number[][]): Geom2 {
    let g = geom2.fromPoints(rings[i]!) as Geom2;
    for (const c of children[i] ?? []) {
        const sub = children[c] ?? [];
        if (sub.length === 0) {
            g = subtractHoleRing(g, rings[c]!) as Geom2;
        } else {
            const holeG = buildGeom2FromRingSubtree(c, rings, children);
            try {
                g = subtract(g, holeG) as Geom2;
            } catch {
                try {
                    g = subtract(g, geom2.reverse(holeG) as Geom2) as Geom2;
                } catch {
                    /* mantieni g */
                }
            }
        }
    }
    return g;
}

function explodeRings(rings: [number, number][][]): Geom2[] {
    if (rings.length === 0) return [];
    if (rings.length === 1) return [geom2.fromPoints(rings[0]!) as Geom2];
    const centroids = rings.map(ringCentroid);
    const parent = rings.map((_, i) => findContainingParentRingIndex(i, rings, centroids));
    const children: number[][] = rings.map(() => []);
    for (let i = 0; i < rings.length; i++) {
        const p = parent[i]!;
        if (p >= 0) children[p]!.push(i);
    }
    const roots = rings.map((_, i) => i).filter((i) => parent[i]! < 0);
    return roots.map((r) => buildGeom2FromRingSubtree(r, rings, children));
}

function explodePath64(path64: Path64): [number, number][] {
    return path64.map((p) => [unscaleInt(p.x), unscaleInt(p.y)] as [number, number]);
}

function geomsFromPaths64(paths: Paths64): Geom2[] {
    const rings = paths
        .map(explodePath64)
        .map((r) => uniqueRing(r))
        .filter((r): r is [number, number][] => r.length >= MIN_RING_POINTS);
    return explodeRings(rings);
}

function flattenGeom2s(parts: Geom2[]): Geom2[] {
    const out: Geom2[] = [];
    for (const p of parts) {
        const rings = (geom2.toOutlines(p) as number[][][]).map((ring) =>
            ring.map((pt) => [pt[0]!, pt[1]!] as [number, number]),
        );
        out.push(...explodeRings(rings));
    }
    return out;
}

function subtractHoleRing(base: Geom2, holeRing: [number, number][]): Geom2 {
    let fallback: Geom2 | null = null;
    for (const revOuter of [false, true]) {
        const outer = revOuter ? (geom2.reverse(base) as Geom2) : base;
        for (const revHole of [false, true]) {
            try {
                let hole = geom2.fromPoints(holeRing) as Geom2;
                if (revHole) hole = geom2.reverse(hole) as Geom2;
                const out = subtract(outer, hole) as Geom2;
                if (out.sides.length === 0) continue;
                if (geom2.toOutlines(out).length >= 2) return out;
                fallback ??= out;
            } catch {
                // Offset-derived rings can produce non-closed intermediates; try next orientation.
            }
        }
    }
    return fallback ?? base;
}

function parseRgbPart(raw: string): number {
    const v = raw.trim();
    if (v.endsWith("%")) return Math.max(0, Math.min(1, Number(v.slice(0, -1)) / 100));
    return Math.max(0, Math.min(1, Number(v) / 255));
}

function parseAlphaPart(raw: string): number {
    const v = raw.trim();
    if (v.endsWith("%")) return Math.max(0, Math.min(1, Number(v.slice(0, -1)) / 100));
    return Math.max(0, Math.min(1, Number(v)));
}

function parseHexPair(hex: string): number {
    return Number.parseInt(hex, 16) / 255;
}

function rgba01FromFill(fill: string): [number, number, number, number] | null {
    const raw = fill.trim().toLowerCase();
    if (!raw || raw === "none" || raw === "transparent") return null;
    const named = CSS_COLORS[raw];
    if (named) return [named[0], named[1], named[2], 1];

    const hex = raw.startsWith("#") ? raw.slice(1) : "";
    if (hex.length === 3) {
        return [parseHexPair(`${hex[0]}${hex[0]}`), parseHexPair(`${hex[1]}${hex[1]}`), parseHexPair(`${hex[2]}${hex[2]}`), 1];
    }
    if (hex.length === 4) {
        return [
            parseHexPair(`${hex[0]}${hex[0]}`),
            parseHexPair(`${hex[1]}${hex[1]}`),
            parseHexPair(`${hex[2]}${hex[2]}`),
            parseHexPair(`${hex[3]}${hex[3]}`),
        ];
    }
    if (hex.length === 6) return [parseHexPair(hex.slice(0, 2)), parseHexPair(hex.slice(2, 4)), parseHexPair(hex.slice(4, 6)), 1];
    if (hex.length === 8) {
        return [
            parseHexPair(hex.slice(0, 2)),
            parseHexPair(hex.slice(2, 4)),
            parseHexPair(hex.slice(4, 6)),
            parseHexPair(hex.slice(6, 8)),
        ];
    }

    const rgb = raw.match(/^rgba?\((.+)\)$/);
    if (rgb) {
        const parts = rgb[1]!.split(",").map((x) => x.trim());
        if (parts.length >= 3) {
            const r = parseRgbPart(parts[0]!);
            const g = parseRgbPart(parts[1]!);
            const b = parseRgbPart(parts[2]!);
            const a = parts.length > 3 ? parseAlphaPart(parts[3]!) : 1;
            return [r, g, b, a];
        }
    }
    return null;
}

function extrudeParts(parts: Geom2[], heightMm: number, translateZMm = 0, colorRgba?: Rgba): Geom3[] {
    if (heightMm === 0) return [];
    const extrudeDown = heightMm < 0;
    const height = Math.abs(heightMm);
    const out: Geom3[] = [];
    for (const flat of flattenGeom2s(parts)) {
        try {
            let g = extrudeLinear({ height }, flat) as Geom3;
            if (extrudeDown) g = mirrorZ(g) as Geom3;
            const rgba = colorRgba;
            if (rgba) {
                try {
                    g = colorize(rgba, g) as Geom3;
                } catch {
                    /* keep uncolored solid */
                }
            }
            if (translateZMm !== 0) {
                g = translate([0, 0, translateZMm], g) as Geom3;
            }
            out.push(g);
        } catch {
            /* skip bad island */
        }
    }
    return out;
}

export function serializeFlap3DMeshParts(parts: Geom3[], meshFileStem: string): GenerateFlap3DOutput {
    const mtlFileName = `${meshFileStem}.mtl`;
    if (parts.length === 0) {
        return { meshFileStem, obj: "", mtl: "", mtlFileName };
    }
    // OBJ has no units; export in meters so Blender defaults don't look 1000x too large.
    const scaled = parts.map((g) => transforms.scale([OBJ_EXPORT_SCALE, OBJ_EXPORT_SCALE, OBJ_EXPORT_SCALE], g) as Geom3);
    const out = serializeObj({ triangulate: true }, ...scaled);
    const body = out[0];
    if (typeof body !== "string") throw new Error("OBJ serialize: expected string body");
    const { obj, mtl } = buildObjMtlPair(body, mtlFileName);
    return { meshFileStem, obj, mtl, mtlFileName };
}

/** All solids for one face (flaps + content), before OBJ export — use for custom placement (e.g. production grid). */
export function collectFlap3DFullMeshGeoms(input: GenerateFlap3DInput): Geom3[] {
    const paths = classifySvgPaths(input.faceSvg);
    const top = buildContentVisibility(paths, flapSvgClass.topContent);
    const bottom = buildContentVisibility(paths, flapSvgClass.bottomContent);
    const half = input.flapThickness / 2;
    const emboss = input.embossDepth;
    const xyClearance = Math.max(0, input.internalXYClearanceMm ?? DEFAULT_INTERNAL_XY_CLEARANCE_MM);
    const zClearance = Math.max(0, input.internalZClearanceMm ?? DEFAULT_INTERNAL_Z_CLEARANCE_MM);
    const contentDepth = Math.max(0, emboss - zClearance);
    const xyInsetForContent = xyClearance / 2;
    const topFlapColor = rgba01FromFill(top.flapFill) ?? undefined;
    const bottomFlapColor = rgba01FromFill(bottom.flapFill) ?? undefined;

    const topFlap3dRaw = extrudeParts(top.flapGeoms, half, 0, topFlapColor);
    const bottomFlap3dRaw = extrudeParts(bottom.flapGeoms, -half, 0, bottomFlapColor);
    const topFlapOwnCut = cutPocketFromFlap(
        topFlap3dRaw,
        top.cutFootprint,
        emboss,
        half - emboss,
        topFlapColor,
        xyInsetForContent,
    );
    const bottomFlapOwnCut = cutPocketFromFlap(
        bottomFlap3dRaw,
        bottom.cutFootprint,
        -emboss,
        emboss - half,
        bottomFlapColor,
        xyInsetForContent,
    );
    const crossesCenter = emboss > half;
    const topFlap3d = crossesCenter
        ? cutPocketFromFlap(topFlapOwnCut, bottom.cutFootprint, -emboss, emboss - half, topFlapColor, xyInsetForContent)
        : topFlapOwnCut;
    const bottomFlap3d = crossesCenter
        ? cutPocketFromFlap(bottomFlapOwnCut, top.cutFootprint, emboss, half - emboss, bottomFlapColor, xyInsetForContent)
        : bottomFlapOwnCut;

    const mergedTopVisible = mergeVisiblePiecesByFill(top.visiblePieces);
    const mergedBottomVisible = mergeVisiblePiecesByFill(bottom.visiblePieces);

    const topContent3d = mergedTopVisible.flatMap((piece) =>
        extrudeParts(
            insetGeoms(piece.geoms, xyInsetForContent),
            contentDepth,
            half - contentDepth,
            rgba01FromFill(piece.fill) ?? undefined,
        ),
    );
    const bottomContent3d = mergedBottomVisible.flatMap((piece) =>
        extrudeParts(
            insetGeoms(piece.geoms, xyInsetForContent),
            -contentDepth,
            contentDepth - half,
            rgba01FromFill(piece.fill) ?? undefined,
        ),
    );
    const mergedFlapsByMaterial = mergeSolidsByMaterial([...topFlap3d, ...bottomFlap3d]);
    const mergedContentByMaterial = mergeSolidsByMaterial([...topContent3d, ...bottomContent3d]);
    return [...mergedFlapsByMaterial, ...mergedContentByMaterial];
}

function geomsFromLayer(paths: ClassifiedPath[], className: string): Geom2[] {
    const layerPaths = paths.filter((p) => p.classes.includes(className));
    const merged = new Paths64();
    for (const p of layerPaths) appendPaths(merged, paths64FromPathData(p.d));
    const unified = unionPaths(merged);
    return geomsFromPaths64(unified);
}

export function deserializeFlapFaceLayers(faceSvg: string): FlapFaceLayerGeoms {
    const paths = classifySvgPaths(faceSvg);
    return {
        topFlap: geomsFromLayer(paths, flapSvgClass.topFlap),
        topContent: geomsFromLayer(paths, flapSvgClass.topContent),
        bottomFlap: geomsFromLayer(paths, flapSvgClass.bottomFlap),
        bottomContent: geomsFromLayer(paths, flapSvgClass.bottomContent),
    };
}

function buildContentVisibility(paths: ClassifiedPath[], contentClass: string): SideBuild {
    const flapClass = contentClass === flapSvgClass.topContent ? flapSvgClass.topFlap : flapSvgClass.bottomFlap;
    const flapPaths = paths.filter((p) => p.classes.includes(flapClass));
    const flap = geomsFromLayer(paths, flapClass);
    const flapFill = flapPaths.find((p) => p.fill && p.fill !== "none")?.fill ?? "default";
    const content = paths
        .filter((p) => p.classes.includes(contentClass))
        .map((p) => ({ fill: p.fill, paths: paths64FromPathData(p.d) }))
        .filter((p) => p.paths.length > 0);

    const inFrontFirst = [...content].reverse();
    let occupied = new Paths64();
    let footprint = new Paths64();
    const visiblePieces: Array<{ geoms: Geom2[]; fill: string }> = [];

    for (const c of inFrontFirst) {
        const visible = differencePaths(c.paths, occupied);
        if (visible.length > 0) visiblePieces.push({ geoms: geomsFromPaths64(visible), fill: c.fill });
        occupied = unionPaths(appendPaths(new Paths64(), occupied), c.paths);
        footprint = unionPaths(appendPaths(new Paths64(), footprint), c.paths);
    }

    return {
        flapGeoms: flap,
        flapFill,
        cutFootprint: geomsFromPaths64(footprint),
        visiblePieces,
    };
}

function geomsToPaths64(parts: Geom2[]): Paths64 {
    const out = new Paths64();
    for (const p of parts) {
        const rings = geom2.toOutlines(p) as number[][][];
        for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < MIN_RING_POINTS) continue;
            const path64 = new Path64();
            for (const pt of ring) {
                const x = pt[0];
                const y = pt[1];
                if (typeof x !== "number" || typeof y !== "number") continue;
                path64.push(new Point64(scaleInt(x), scaleInt(y)));
            }
            const stripped = Clipper.stripDuplicates(path64, true);
            if (stripped.length >= MIN_RING_POINTS) out.push(stripped);
        }
    }
    return out;
}

function mergeVisiblePiecesByFill(pieces: VisiblePiece[]): Array<{ geoms: Geom2[]; fill: string }> {
    const byFill = new Map<string, Paths64>();
    for (const piece of pieces) {
        const acc = byFill.get(piece.fill) ?? new Paths64();
        const paths = geomsToPaths64(piece.geoms);
        appendPaths(acc, paths);
        byFill.set(piece.fill, acc);
    }
    const merged: Array<{ geoms: Geom2[]; fill: string }> = [];
    for (const [fill, paths] of byFill) {
        const unified = unionPaths(paths);
        merged.push({ fill, geoms: geomsFromPaths64(unified) });
    }
    return merged;
}

function insetGeoms(parts: Geom2[], insetMm: number): Geom2[] {
    if (parts.length === 0 || insetMm === 0) return parts;
    const insetPaths = offsetPaths(geomsToPaths64(parts), -Math.abs(insetMm));
    return geomsFromPaths64(insetPaths);
}

function rgbaFromGeom3(g: Geom3): Rgba | null {
    const c = (g as Geom3 & { color?: unknown }).color;
    if (!Array.isArray(c) || c.length < 3) return null;
    return [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1];
}

function rgbaKey(rgba: Rgba | null): string {
    if (!rgba) return "none";
    return rgba.map((v) => Number(v).toFixed(6)).join(",");
}

function mergeSolidsByMaterial(parts: Geom3[]): Geom3[] {
    const buckets = new Map<string, { rgba: Rgba | null; geoms: Geom3[] }>();
    for (const g of parts) {
        const rgba = rgbaFromGeom3(g);
        const key = rgbaKey(rgba);
        const bucket = buckets.get(key);
        if (bucket) bucket.geoms.push(g);
        else buckets.set(key, { rgba, geoms: [g] });
    }

    const out: Geom3[] = [];
    for (const bucket of buckets.values()) {
        let merged: Geom3[] = bucket.geoms;
        if (bucket.geoms.length > 1) {
            try {
                merged = [union(...bucket.geoms) as Geom3];
            } catch {
                merged = bucket.geoms;
            }
        }
        for (let g of merged) {
            if (bucket.rgba) {
                try {
                    g = colorize(bucket.rgba, g) as Geom3;
                } catch {
                    /* keep uncolored */
                }
            }
            out.push(g);
        }
    }
    return out;
}

function cutPocketFromFlap(
    flaps: Geom3[],
    cut2d: Geom2[],
    depthMm: number,
    translateZMm: number,
    flapColor?: [number, number, number, number],
    lateralGapMm = 0,
): Geom3[] {
    if (flaps.length === 0 || cut2d.length === 0 || depthMm === 0) return flaps;
    const cutPaths = geomsToPaths64(cut2d);
    const expandedCutPaths = offsetPaths(cutPaths, CUT_SAFETY_MARGIN_MM + Math.max(0, lateralGapMm));
    const expandedCut2d = geomsFromPaths64(expandedCutPaths);
    const pockets = extrudeParts(expandedCut2d, depthMm, translateZMm);
    if (pockets.length === 0) return flaps;
    const out: Geom3[] = [];
    for (const flap of flaps) {
        let carved = flap;
        for (const pocket of pockets) {
            try {
                carved = subtract(carved, pocket) as Geom3;
            } catch {
                // keep current carved solid and try next cutter
            }
        }
        if (flapColor) {
            try {
                carved = colorize(flapColor, carved) as Geom3;
            } catch {
                /* keep uncolored solid */
            }
        }
        out.push(carved);
    }
    return out;
}

export function generateFlap3D(input: GenerateFlap3DInput): GenerateFlap3DOutput {
    const parts = collectFlap3DFullMeshGeoms(input);
    const meshFileStem = `${input.meshName ?? "mesh"}_full`;
    return serializeFlap3DMeshParts(parts, meshFileStem);
}
