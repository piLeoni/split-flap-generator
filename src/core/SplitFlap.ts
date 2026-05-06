import InitCanvasKit from "canvaskit-wasm";
import type { CanvasKit, CanvasKitInitOptions, Path } from "canvaskit-wasm";
import { load as cheerioLoad } from "cheerio";
import { createFlapClipOutlinePath } from "../utils/createSatoriElements.js";
import { pathFromCheerioSvgLineElement, pathFromCheerioSvgPathElement } from "../utils/pathFromCheerioSvgPathElement.js";
import { mm2px } from "../utils/conversions.js";
import { resolveProductionGridLayout } from "../utils/productionGridLayout.js";
import {
    collectProductionFlaps3DCellParts,
    generateProductionFlaps3DFromCellParts,
    generateProductionFlaps3DGridFromCellParts,
    generateProductionFlaps3D as meshesFromProductionFaceCells,
    generateProductionFlaps3DGrid as meshesGridFromProductionFaceCells,
} from "../utils/generateProductionFlaps3D.js";
import type { GenerateFlap3DOutput } from "../utils/generateFlap3D.js";

import type {
    FlapContent,
    FlapContentInput,
    FlapImageGridCell,
    FlapRenderResult,
    FlapProductionResult,
    FlapStyle,
    FlapsOptions,
    PaintedPathSegment,
    ProductionFaceCells2D,
    ProductionFlap3d
} from "./types.js";
import { paintFromSvgPathAttribs } from "../utils/svgPathPaint.js";
import { normalizeStyle } from "../styles/normalizeStyle.js";
import { extractFontFamiliesFromTree } from "../utils/extractFontFamiliesFromTree.js";
import { FontRegistry } from "../fonts/registry.js";
import { textRenderer } from "../renderers/textRenderer.js";
import { htmlRenderer } from "../renderers/htmlRenderer.js";
import { svgRenderer } from "../renderers/svgRenderer.js";
import { DEFAULT_FLAP_FACE_CLASS, renderFlapCellFaceInner } from "./flapCellSvg.js";
import { escapeXmlAttr } from "../utils/svgPathPaint.js";
import { emitFlapMaskPath, emitWrappedContent, flapSvgClass } from "../utils/emitClippedContentPath.js";
import { finalizePrintSvg } from "../utils/finalizePrintSvg.js";

export class SplitFlap {
    private CK: CanvasKit | null = null;
    private flaps: FlapRenderResult[] = [];
    private options: FlapsOptions | null = null;
    private readonly fonts = new FontRegistry();

    async init(input: FlapsOptions, canvasKitInit?: CanvasKitInitOptions): Promise<void> {
        this.CK = await InitCanvasKit(canvasKitInit);
        this.options = {
            ...input,
            style: normalizeStyle(input.style),
        };
        this.fonts.setGoogleFontsCssBaseUrl(input.googleFontsCssBaseUrl);
        await this.fonts.warmup(input.defaultFonts ?? []);
    }

    async createFLAP(input: FlapContent): Promise<FlapRenderResult> {
        if (!this.options) throw new Error("Options not present");
        if (!this.CK) throw new Error("CanvasKit not initialized");

        const normalizedInput = input as FlapContentInput;
        const style = normalizeStyle({ ...this.options.style, ...input.style });
        if ("HTMLContent" in input) {
            await this.fonts.ensureFamilyNames(extractFontFamiliesFromTree(input.HTMLContent));
        }
        await this.fonts.ensureFromStyles([style]);

        const options = { ...this.options, style };
        const fonts = this.fonts.getFonts();
        const rendered = await this.renderToSvg({ ...normalizedInput, style }, options, fonts, this.CK);

        const flap = createFlapClipOutlinePath(this.options);
        const flapIndex = this.flaps.length;
        if (rendered.isBlank) {
            const blank = this.buildResult({ flap, top: [], bottom: [], style, flapIndex });
            this.flaps.push(blank);
            return blank;
        }

        const defaultContentFill = this.resolveContentColor(style);
        const topBottom = this.clipRenderedPaths(this.CK, rendered.svg, rendered.invertedSvg, flap, defaultContentFill);
        if (topBottom.top.length === 0 && topBottom.bottom.length === 0) {
            throw new Error(
                "No clipped geometry for this flap: after intersecting content with the flap mask, both halves are empty. " +
                "Common causes: CSS transform/position moves the glyph outside the flap; the character has no outline in the loaded fonts; " +
                "or Satori emitted no drawable paths.",
            );
        }
        const output = this.buildResult({
            flap,
            top: topBottom.top,
            bottom: topBottom.bottom,
            style,
            flapIndex,
        });
        this.flaps.push(output);
        return output;
    }

    /** Satori/flatten output → `finalizePrintSvg` (explicit paint) → clip (new `d` only) → `emitClippedContentPathElement` in the cell doc. */
    private async renderToSvg(
        input: FlapContentInput,
        options: FlapsOptions,
        fonts: ReturnType<FontRegistry["getFonts"]>,
        CK: CanvasKit,
    ) {
        const merged = normalizeStyle({ ...options.style, ...input.style });
        const contentFill = this.resolveContentColor(merged);
        const fixSatoriBlackGlyphs = "textContent" in input || "HTMLContent" in input;

        const finish = (p: { svg: string; invertedSvg: string; isBlank: boolean }) => {
            if (p.isBlank) return p;
            return {
                isBlank: false,
                svg: finalizePrintSvg(p.svg, contentFill, fixSatoriBlackGlyphs),
                invertedSvg: finalizePrintSvg(p.invertedSvg, contentFill, fixSatoriBlackGlyphs),
            };
        };

        if ("textContent" in input) {
            return finish(await textRenderer.render(input, options, fonts, CK));
        }
        if ("HTMLContent" in input) {
            return finish(await htmlRenderer.render(input, options, fonts, CK));
        }
        if ("SVGContent" in input) {
            return finish(await svgRenderer.render(input, options, fonts, CK));
        }
        throw new Error("No renderer for content payload");
    }

    clearFlaps(): void {
        this.flaps = [];
    }

    getFlaps(): FlapRenderResult[] {
        return this.flaps;
    }

    /** Preview cell for one flap: full module viewBox with lower half mirrored for visual continuity. */
    generateFlapPreview(input: FlapRenderResult): FlapImageGridCell {
        if (!this.options) throw new Error("Options not set");
        const W = mm2px(this.options.width);
        const H = mm2px(this.options.height);
        const faceGroupId = `flap-${input.flapIndex}`;
        return {
            faceGroupId,
            inner: renderFlapCellFaceInner({
                width: W,
                height: H,
                faceGroupId,
                flipBottomY: true,
                flapTopSvg: input.flapTopSvg,
                contentTopSvg: input.contentTopSvg,
                flapBottomSvg: input.flapBottomSvg,
                contentBottomSvg: input.contentBottomSvg,
            }),
        };
    }

    /**
     * Grid compositor: each `cells[i]` can be either a flat face `{ faceGroupId, inner }`
     * (sheet root → translated `<g>` → face `<g id="flap-…">` → paths), or a legacy `<svg>…</svg>` string.
     * Preview and production pipelines both use flat face cells.
     */
    generateImageGrid(input: {
        cols: number;
        gap: number;
        cellW: number;
        cellH: number;
        cells: FlapImageGridCell[];
        /** `class` on each flat face `<g id="flap-…">`; default `flap` (`DEFAULT_FLAP_FACE_CLASS`). Empty string disables class output. */
        faceGroupClass?: string;
    }): string {
        const cols = Math.max(1, Math.floor(input.cols));
        const n = input.cells.length;
        const rows = n === 0 ? 0 : Math.ceil(n / cols);
        const gapPx = input.gap;
        const { cellW, cellH } = input;
        const totalW = gapPx * 2 + cols * cellW + (cols - 1) * gapPx;
        const totalH = rows === 0 ? gapPx * 2 : gapPx * 2 + rows * cellH + (rows - 1) * gapPx;
        const fc = input.faceGroupClass;
        const flatClass = fc === "" ? "" : escapeXmlAttr(fc === undefined ? DEFAULT_FLAP_FACE_CLASS : fc);
        const classPart = fc === "" ? "" : ` class="${flatClass}"`;
        const items = input.cells
            .map((cell, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = gapPx + col * (cellW + gapPx);
                const y = gapPx + row * (cellH + gapPx);
                if (typeof cell === "object" && cell !== null && "inner" in cell) {
                    const id = escapeXmlAttr(cell.faceGroupId);
                    return (
                        `<g id="${id}"${classPart} ` +
                        `transform="translate(${x} ${y})">\n${cell.inner}\n</g>`
                    );
                }
                return `<g transform="translate(${x} ${y})">${cell as string}</g>`;
            })
            .join("");
        return `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg">${items}</svg>`;
    }

    generateFlapsPreview(input: { cols: number; gap: number }): string {
        if (!this.options) throw new Error("Options not set");
        const cellW = mm2px(this.options.width);
        const cellH = mm2px(this.options.height);
        const gapPx = mm2px(input.gap);
        return this.generateImageGrid({
            cols: input.cols,
            gap: gapPx,
            cellW,
            cellH,
            cells: this.flaps.map((f) => this.generateFlapPreview(f)),
        });
    }

    /**
     * Pairs consecutive flaps for 2D production: upper window = flap *i* (`top` vectors),
     * lower window = flap *i+1*’s `bottom` vectors (same half as in a single `generateFlapPreview` lower half).
     * Renders as one viewBox so both sides overlay like the physical front glass.
     */
    getProductionFlaps2D(): FlapProductionResult[] {
        if (!this.flaps.length) throw new Error("No flaps were produced");
        const n = this.flaps.length;
        const out: FlapProductionResult[] = [];
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            out.push({
                flapTopSvg: this.flaps[i].flapTopSvg,
                contentTopSvg: this.flaps[i].contentTopSvg,
                flapBottomSvg: this.flaps[j].flapBottomSvg,
                contentBottomSvg: this.flaps[j].contentBottomSvg,
            });
        }
        return out;
    }

    /**
     * One production face `<svg>…</svg>` per flap pair (pixel viewBox/size), with aligned `pairs`
     * and the same cell pitch used by the 2D production grid.
     */
    getProductionFaceCells2D(): ProductionFaceCells2D {
        if (!this.options) throw new Error("Options not set");
        const o = this.options;
        const cellW = mm2px(o.width);
        const cellH = mm2px(o.height / 2 - o.flapsGap / 2);
        const pairs = this.getProductionFlaps2D();
        const cells: FlapImageGridCell[] = pairs.map((p, i) => {
            const faceGroupId = `flap-${i}`;
            return {
                faceGroupId,
                inner: renderFlapCellFaceInner({
                    width: cellW,
                    height: cellH,
                    faceGroupId,
                    flapTopSvg: p.flapTopSvg,
                    contentTopSvg: p.contentTopSvg,
                    flapBottomSvg: p.flapBottomSvg,
                    contentBottomSvg: p.contentBottomSvg,
                    flipBottomY: false,
                }),
            };
        });
        return { cellW, cellH, cells, pairs };
    }

    /** Packs `face.cells` into one or more sheet grids (flat `{ faceGroupId, inner }` cells or legacy `<svg>` strings). */
    packProductionFaceCellsToSheets(
        face: ProductionFaceCells2D,
        input: { cols?: number; rows?: number; gap: number },
    ): string[] {
        const gapPx = mm2px(input.gap);
        const { cellW, cellH, cells } = face;
        const layout = resolveProductionGridLayout({
            cellCount: cells.length,
            cols: input.cols,
            rows: input.rows,
        });
        return layout.sheets.map((sh) =>
            this.generateImageGrid({
                cols: layout.cols,
                gap: gapPx,
                cellW,
                cellH,
                cells: cells.slice(sh.cellOffset, sh.cellOffset + sh.cellLength),
            }),
        );
    }

    /**
     * Production sheets: row-major cells, each from {@link getProductionFaceCells2D} (translated `<g>` wrappers, no nested cell `<svg>`).
     * Layout is computed by {@link resolveProductionGridLayout}. Face order `flap-0`… matches `face.cells`.
     */
    generateProductionFlaps2D(input: { cols?: number; rows?: number; gap: number }): string[] {
        return this.packProductionFaceCellsToSheets(this.getProductionFaceCells2D(), input);
    }

    /**
     * Generates one in-memory mesh assembly per cell in {@link getProductionFaceCells2D}
     * (OBJ + optional MTL), with stems like `flap-{i}_full` used by example exports.
     * Use **`init({ flapThickness, embossDepth })`** for defaults, or pass **`{ flapThickness, embossDepth }`** here.
     */
    generateProductionFlaps3D(input: Partial<ProductionFlap3d> = {}) {
        if (!this.options) throw new Error("Options not set");
        const flapThickness = input.flapThickness ?? this.options.flapThickness;
        const embossDepth = input.embossDepth ?? this.options.embossDepth;
        const internalXYClearanceMm = input.internalXYClearanceMm ?? this.options.internalXYClearanceMm;
        const internalZClearanceMm = input.internalZClearanceMm ?? this.options.internalZClearanceMm;
        if (typeof flapThickness !== "number" || typeof embossDepth !== "number") {
            throw new Error(
                "generateProductionFlaps3D: set flapThickness and embossDepth on init(options) or pass them to this method.",
            );
        }
        const face = this.getProductionFaceCells2D();
        return meshesFromProductionFaceCells(face.cells, {
            flapThickness,
            embossDepth,
            internalXYClearanceMm,
            internalZClearanceMm,
            meshNamePrefix: "flap",
            cellW: face.cellW,
            cellH: face.cellH,
        });
    }

    /**
     * One OBJ/MTL per production **sheet**, cells laid out like {@link generateProductionFlaps2D} (same `gap` / `cols` / `rows` as 2D).
     * Stems: `flap_sheet-{i}_grid` unless you pass `meshNamePrefix`.
     */
    generateProductionFlaps3DGrid(
        input: { cols?: number; rows?: number; gap: number } & Partial<ProductionFlap3d> & { meshNamePrefix?: string },
    ) {
        if (!this.options) throw new Error("Options not set");
        const flapThickness = input.flapThickness ?? this.options.flapThickness;
        const embossDepth = input.embossDepth ?? this.options.embossDepth;
        const internalXYClearanceMm = input.internalXYClearanceMm ?? this.options.internalXYClearanceMm;
        const internalZClearanceMm = input.internalZClearanceMm ?? this.options.internalZClearanceMm;
        if (typeof flapThickness !== "number" || typeof embossDepth !== "number") {
            throw new Error(
                "generateProductionFlaps3DGrid: set flapThickness and embossDepth on init(options) or pass them to this method.",
            );
        }
        const face = this.getProductionFaceCells2D();
        return meshesGridFromProductionFaceCells(face.cells, {
            flapThickness,
            embossDepth,
            internalXYClearanceMm,
            internalZClearanceMm,
            gap: input.gap,
            cols: input.cols,
            rows: input.rows,
            cellW: face.cellW,
            cellH: face.cellH,
            meshNamePrefix: input.meshNamePrefix ?? "flap",
        });
    }

    /**
     * SVG → solids **once** per cell, then both outputs. Use this if you need per-face OBJs **and** sheet grids;
     * do not call {@link generateProductionFlaps3D} and {@link generateProductionFlaps3DGrid} separately or you pay twice.
     */
    generateProductionFlaps3DExport(input: {
        gap: number;
        cols?: number;
        rows?: number;
        meshNamePrefixPerFace?: string;
        meshNamePrefixGrid?: string;
    } & Partial<ProductionFlap3d>): { perFace: GenerateFlap3DOutput[]; grid: GenerateFlap3DOutput[] } {
        if (!this.options) throw new Error("Options not set");
        const flapThickness = input.flapThickness ?? this.options.flapThickness;
        const embossDepth = input.embossDepth ?? this.options.embossDepth;
        const internalXYClearanceMm = input.internalXYClearanceMm ?? this.options.internalXYClearanceMm;
        const internalZClearanceMm = input.internalZClearanceMm ?? this.options.internalZClearanceMm;
        if (typeof flapThickness !== "number" || typeof embossDepth !== "number") {
            throw new Error(
                "generateProductionFlaps3DExport: set flapThickness and embossDepth on init(options) or pass them to this method.",
            );
        }
        const face = this.getProductionFaceCells2D();
        const slab = { flapThickness, embossDepth, internalXYClearanceMm, internalZClearanceMm };
        const cellParts = collectProductionFlaps3DCellParts(face.cells, slab, face.cellW, face.cellH);
        return {
            perFace: generateProductionFlaps3DFromCellParts(cellParts, input.meshNamePrefixPerFace ?? "flap"),
            grid: generateProductionFlaps3DGridFromCellParts(cellParts, {
                gap: input.gap,
                cols: input.cols,
                rows: input.rows,
                cellW: face.cellW,
                cellH: face.cellH,
                meshNamePrefix: input.meshNamePrefixGrid ?? "flap",
            }),
        };
    }

    private clipRenderedPaths(
        CK: CanvasKit,
        svg: string,
        invertedSvg: string,
        flap: string,
        defaultFill: string,
    ): { top: PaintedPathSegment[]; bottom: PaintedPathSegment[] } {
        const flapPath = CK.Path.MakeFromSVGString(flap);
        if (!flapPath) throw new Error("Error generating clipping paths");

        const top = this.clipAllPathElements(CK, svg, flapPath, defaultFill);
        const bottom = this.clipAllPathElements(CK, invertedSvg, flapPath, defaultFill);
        flapPath.delete();
        return { top, bottom };
    }

    /** Paint (fill/stroke) is read from the same finalized SVG Satori/flatten output as `renderToSvg`; only `d` is replaced by the clip. */
    private clipAllPathElements(CK: CanvasKit, svg: string, flapPath: Path, defaultFill: string): PaintedPathSegment[] {
        const $ = cheerioLoad(svg, { xmlMode: true });
        const out: PaintedPathSegment[] = [];
        const pushClipped = (
            path: Path,
            paint: { fill?: string; stroke?: string; strokeWidth?: string },
            fillOverride?: string,
        ) => {
            const clipped = CK.Path.MakeFromOp(path, flapPath, CK.PathOp.Intersect);
            path.delete();
            if (!clipped) return;

            const d = clipped.toSVGString()?.trim() ?? "";
            clipped.delete();
            if (!d) return;

            const fill: string = fillOverride ?? paint.fill ?? defaultFill;
            out.push({
                path: d,
                fill,
                stroke: paint.stroke,
                strokeWidth: paint.strokeWidth,
            });
        };

        $("path").each((_, el) => {
            const attribs = $(el).attr() as Record<string, string | undefined>;
            const paint = paintFromSvgPathAttribs(attribs, defaultFill);
            const path = pathFromCheerioSvgPathElement(CK, el as { attribs: { d?: string; transform?: string } });
            if (!path) return;
            pushClipped(path, paint);
        });

        /** Satori draws `text-decoration` as `<line stroke="…">`; those are not `<path>`. */
        $("line").each((_, el) => {
            const attribs = $(el).attr() as Record<string, string | undefined>;
            const paint = paintFromSvgPathAttribs(attribs, defaultFill);
            const linePath = pathFromCheerioSvgLineElement(CK, el as { attribs: Record<string, string | undefined> });
            if (!linePath) return;
            const underlineFill = paint.stroke ?? paint.fill ?? defaultFill;
            pushClipped(linePath, { ...paint, fill: underlineFill, stroke: undefined }, underlineFill);
        });

        return out;
    }

    private buildResult(input: {
        flap: string;
        top: PaintedPathSegment[];
        bottom: PaintedPathSegment[];
        style?: FlapStyle;
        flapIndex: number;
    }): FlapRenderResult {
        const d = input.flap || "error";
        const dieFill = this.resolveFlapBackground(input.style);
        return {
            flapIndex: input.flapIndex,
            flap: { path: d },
            contentTop: input.top,
            contentBottom: input.bottom,
            contentTopSvg: emitWrappedContent(flapSvgClass.topContent, input.top),
            contentBottomSvg: emitWrappedContent(flapSvgClass.bottomContent, input.bottom),
            flapTopSvg: emitFlapMaskPath(d, dieFill, flapSvgClass.topFlap),
            flapBottomSvg: emitFlapMaskPath(d, dieFill, flapSvgClass.bottomFlap),
            style: input.style,
        };
    }

    private resolveFlapBackground(style?: FlapStyle): string {
        const bg = style?.backgroundColor;
        if (typeof bg === "string") return bg;
        return "black";
    }

    private resolveContentColor(style?: FlapStyle): string {
        const color = style?.color;
        return typeof color === "string" ? color : "white";
    }

    private deletePath(...paths: Array<Path | null | undefined>): void {
        for (const p of paths) p?.delete();
    }
}
