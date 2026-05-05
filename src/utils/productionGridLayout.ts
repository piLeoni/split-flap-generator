/**
 * Shared layout for 2D production SVG sheets and 3D packing: how many columns, optional row cap,
 * and row-major slices of the global cell list.
 */

export type ProductionGridSheetRange = {
    /** Index into the global row-major cell array. */
    cellOffset: number;
    /** Cells on this sheet (≤ `cols * rowCap` when chunking). */
    cellLength: number;
};

export type ProductionGridLayout = {
    /** Column count for every sheet (current behavior: constant across sheets). */
    cols: number;
    /** Present only when both `cols` and `rows` were passed: max rows per physical sheet. */
    rowCap?: number;
    /** One entry per output sheet; empty if `cellCount === 0` in chunked mode. */
    sheets: ProductionGridSheetRange[];
};

/**
 * Row count implied by `generateImageGrid`-style packing for one sheet.
 */
export function productionGridSheetRowCount(cols: number, cellLength: number): number {
    const c = Math.max(1, cols);
    const n = Math.max(0, cellLength);
    return n === 0 ? 0 : Math.ceil(n / c);
}

/**
 * - **Both `cols` and `rows`:** chunk into sheets of at most `cols × rows` cells.
 * - **Only `cols`:** one sheet; rows follow from `cellCount`.
 * - **Only `rows`:** one sheet; `cols = ceil(cellCount / rows)`.
 * - **Neither:** one roughly square sheet (`cols = ceil(√cellCount)`).
 */
export function resolveProductionGridLayout(input: {
    cellCount: number;
    cols?: number;
    rows?: number;
}): ProductionGridLayout {
    const n = Math.max(0, Math.floor(input.cellCount));
    const hasCols = typeof input.cols === "number" && !Number.isNaN(input.cols);
    const hasRows = typeof input.rows === "number" && !Number.isNaN(input.rows);

    if (hasCols && hasRows) {
        const cols = Math.max(1, Math.floor(input.cols!));
        const rowCap = Math.max(1, Math.floor(input.rows!));
        const perSheet = cols * rowCap;
        const sheets: ProductionGridSheetRange[] = [];
        for (let off = 0; off < n; off += perSheet) {
            sheets.push({ cellOffset: off, cellLength: Math.min(perSheet, n - off) });
        }
        return { cols, rowCap, sheets };
    }

    let cols: number;
    if (hasCols) {
        cols = Math.max(1, Math.floor(input.cols!));
    } else if (hasRows) {
        const rows = Math.max(1, Math.floor(input.rows!));
        cols = n === 0 ? 1 : Math.max(1, Math.ceil(n / rows));
    } else {
        cols = n === 0 ? 1 : Math.max(1, Math.ceil(Math.sqrt(n)));
    }

    return { cols, sheets: [{ cellOffset: 0, cellLength: n }] };
}
