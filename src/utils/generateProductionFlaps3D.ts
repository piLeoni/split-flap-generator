import { transforms } from "@jscad/modeling";
import type Geom3 from "@jscad/modeling/src/geometries/geom3/type.js";

import { flapGridCellToStandaloneFaceSvg } from "../core/flapCellSvg.js";
import type { FlapImageGridCell, ProductionFlap3d } from "../core/types.js";
import { mm2px } from "./conversions.js";
import {
    collectFlap3DFullMeshGeoms,
    serializeFlap3DMeshParts,
    type GenerateFlap3DOutput,
} from "./generateFlap3D.js";
import { resolveProductionGridLayout } from "./productionGridLayout.js";

const { translate } = transforms;

function productionCellsToFaceSvgs(
    cells: FlapImageGridCell[],
    cellW: number | undefined,
    cellH: number | undefined,
): string[] {
    return cells.map((c) => {
        if (typeof c === "string") return c;
        if (cellW === undefined || cellH === undefined) {
            throw new Error(
                "generateProductionFlaps3D: pass cellW and cellH when cells are { faceGroupId, inner } objects",
            );
        }
        return flapGridCellToStandaloneFaceSvg(c, cellW, cellH);
    });
}

/** Same scale as {@link generateFlap3D}: SVG px → model mm (Y flipped). */
const PX_PER_MM = 96 / 25.4;

function gridOffsetPxToTranslateMm(oxPx: number, oyPx: number): [number, number, number] {
    return [oxPx / PX_PER_MM, -oyPx / PX_PER_MM, 0];
}

export type GenerateProductionFlaps3DInput = ProductionFlap3d & {
    /** Stems become `${meshNamePrefix}-${i}_full`. Default `flap`. */
    meshNamePrefix?: string;
    /** Required when any `cells[i]` is `{ faceGroupId, inner }` (ignored for full `<svg>` strings). */
    cellW?: number;
    cellH?: number;
};

export type GenerateProductionFlaps3DGridInput = ProductionFlap3d & {
    /** Millimetres — same as {@link SplitFlap.packProductionFaceCellsToSheets} / {@link SplitFlap.generateProductionFlaps2D}. */
    gap: number;
    cols?: number;
    rows?: number;
    /** Pixel pitch — use {@link ProductionFaceCells2D}.`cellW` / `cellH`. */
    cellW: number;
    cellH: number;
    /** Stems become `${meshNamePrefix}_sheet-{i}_grid`. Default `flap`. */
    meshNamePrefix?: string;
};

/** Layout slice of {@link GenerateProductionFlaps3DGridInput} — use with pre-collected {@link collectProductionFlaps3DCellParts}. */
export type ProductionFlaps3DGridLayoutInput = Omit<
    GenerateProductionFlaps3DGridInput,
    keyof ProductionFlap3d
>;

/**
 * Run SVG → solids **once** per cell. Reuse with {@link generateProductionFlaps3DFromCellParts}
 * and/or {@link generateProductionFlaps3DGridFromCellParts} so you never pay the Clipper/JSCAD
 * build twice for the same cells.
 */
export function collectProductionFlaps3DCellParts(
    cells: FlapImageGridCell[],
    slab: ProductionFlap3d,
    cellW?: number,
    cellH?: number,
): Geom3[][] {
    const svgs = productionCellsToFaceSvgs(cells, cellW, cellH);
    return svgs.map((faceSvg) =>
        collectFlap3DFullMeshGeoms({
            faceSvg,
            flapThickness: slab.flapThickness,
            embossDepth: slab.embossDepth,
            internalXYClearanceMm: slab.internalXYClearanceMm,
            internalZClearanceMm: slab.internalZClearanceMm,
        }),
    );
}

/** One OBJ/MTL per cell from solids you already built (e.g. {@link collectProductionFlaps3DCellParts}). */
export function generateProductionFlaps3DFromCellParts(
    cellParts: Geom3[][],
    meshNamePrefix = "flap",
): GenerateFlap3DOutput[] {
    return cellParts.map((parts, i) => serializeFlap3DMeshParts(parts, `${meshNamePrefix}-${i}_full`));
}

/**
 * One OBJ/MTL per **sheet** from pre-collected cell solids — same placement as
 * {@link generateProductionFlaps3DGrid} but no second SVG pass.
 */
export function generateProductionFlaps3DGridFromCellParts(
    cellParts: Geom3[][],
    input: ProductionFlaps3DGridLayoutInput,
): GenerateFlap3DOutput[] {
    if (cellParts.length === 0) return [];

    const layout = resolveProductionGridLayout({
        cellCount: cellParts.length,
        cols: input.cols,
        rows: input.rows,
    });
    const gapPx = mm2px(input.gap);
    const { cellW, cellH } = input;
    const prefix = input.meshNamePrefix ?? "flap";

    const out: GenerateFlap3DOutput[] = [];
    for (let si = 0; si < layout.sheets.length; si++) {
        const sh = layout.sheets[si]!;
        if (sh.cellLength === 0) continue;

        const slice = cellParts.slice(sh.cellOffset, sh.cellOffset + sh.cellLength);
        const parts: Geom3[] = [];
        for (let i = 0; i < slice.length; i++) {
            const col = i % layout.cols;
            const row = Math.floor(i / layout.cols);
            const oxPx = gapPx + col * (cellW + gapPx);
            const oyPx = gapPx + row * (cellH + gapPx);
            const t = gridOffsetPxToTranslateMm(oxPx, oyPx);
            for (const g of slice[i]!) {
                parts.push(translate(t, g) as Geom3);
            }
        }

        const stem = `${prefix}_sheet-${si}_grid`;
        out.push(serializeFlap3DMeshParts(parts, stem));
    }
    return out;
}

/**
 * One OBJ/MTL assembly per production face — same order as {@link SplitFlap.getProductionFaceCells2D}.`cells`.
 * Cells are **`FlapImageGridCell`**: flat `{ faceGroupId, inner }` (pass **`cellW` / `cellH`**) or full `<svg>` strings from disk.
 */
export function generateProductionFlaps3D(
    cells: FlapImageGridCell[],
    input: GenerateProductionFlaps3DInput,
): GenerateFlap3DOutput[] {
    const slab: ProductionFlap3d = {
        flapThickness: input.flapThickness,
        embossDepth: input.embossDepth,
        internalXYClearanceMm: input.internalXYClearanceMm,
        internalZClearanceMm: input.internalZClearanceMm,
    };
    const cellParts = collectProductionFlaps3DCellParts(cells, slab, input.cellW, input.cellH);
    return generateProductionFlaps3DFromCellParts(cellParts, input.meshNamePrefix ?? "flap");
}

/**
 * One OBJ/MTL per **sheet**, with cells placed like {@link SplitFlap.generateImageGrid} / {@link resolveProductionGridLayout}
 * (row-major, same gaps and chunking as 2D production SVG).
 */
export function generateProductionFlaps3DGrid(
    cells: FlapImageGridCell[],
    input: GenerateProductionFlaps3DGridInput,
): GenerateFlap3DOutput[] {
    if (cells.length === 0) return [];
    const slab: ProductionFlap3d = {
        flapThickness: input.flapThickness,
        embossDepth: input.embossDepth,
        internalXYClearanceMm: input.internalXYClearanceMm,
        internalZClearanceMm: input.internalZClearanceMm,
    };
    const cellParts = collectProductionFlaps3DCellParts(cells, slab, input.cellW, input.cellH);
    return generateProductionFlaps3DGridFromCellParts(cellParts, {
        gap: input.gap,
        cols: input.cols,
        rows: input.rows,
        cellW: input.cellW,
        cellH: input.cellH,
        meshNamePrefix: input.meshNamePrefix,
    });
}
