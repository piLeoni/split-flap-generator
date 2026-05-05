import { load } from "cheerio";

import type { FlapImageGridCell } from "./types.js";
import { escapeXmlAttr } from "../utils/svgPathPaint.js";
import {
    emitClippedContentPathElement,
    emitClippedContentPathElements,
    emitFlapMaskPath,
    emitWrappedContent,
    flapSvgClass,
    wrapWithClass,
} from "../utils/emitClippedContentPath.js";

export {
    emitClippedContentPathElement,
    emitClippedContentPathElements,
    emitFlapMaskPath,
    emitWrappedContent,
    flapSvgClass,
    wrapWithClass,
};

/** @alias emitClippedContentPathElements */
export const renderPaintedPathSegments = emitClippedContentPathElements;

/** `class` di default sul `<g id="flap-…">` in documento o in griglia. */
export const DEFAULT_FLAP_FACE_CLASS = "flap";

/**
 * Celle faccia: `height` + `flipBottomY` vanno scelti assieme.
 * - **Modulo (preview):** `height` = altezza modulo px, `flipBottomY: true` — mezza bassa in coordinate “ala”
 *   specchiata rispetto al centro del modulo.
 * - **Produzione 2D:** `height` = `flapWingHeightPx(...)`, `flipBottomY: false` — stesso rettangolo ala
 *   per sopra e sotto (sovrapposizione vetrino).
 */
export type FlapCellFaceInput = {
    width: number;
    height: number;
    /** Se `true`, avvolge lo stack basso in un `<g transform="… scale(1,-1)">` con centro in `(W/2,H/2)` — `H` deve essere l’altezza in cui ha senso il flip (modulo piena in preview, non ala+flip). */
    flipBottomY: boolean;
    flapTopSvg: string;
    contentTopSvg: string;
    flapBottomSvg: string;
    contentBottomSvg: string;
};

/** {@link FlapCellFaceInput} + `faceGroupId` per `id` sui `<path>` (`flap-0-topFlap`, …). */
export type FlapCellFaceInnerInput = FlapCellFaceInput & { faceGroupId: string };

/**
 * Inkscape / object lists use **`id` on `<path>`**, not `class` or parent `<g>`.
 * Assigns `id="baseId"` (one path) or `id="baseId-0"`, `baseId-1`, … (multiple).
 */
function injectPathIds(fragment: string, baseId: string): string {
    const trimmed = fragment.trim();
    if (!trimmed) return "";
    const wrapped = `<__frag xmlns="http://www.w3.org/2000/svg">${trimmed}</__frag>`;
    const $ = load(wrapped, { xml: true });
    const paths = $("path");
    const n = paths.length;
    if (n === 0) return trimmed;
    paths.each((i, el) => {
        const id = n === 1 ? baseId : `${baseId}-${i}`;
        $(el).attr("id", id);
    });
    return $("__frag").html() ?? trimmed;
}

/**
 * Contenuto interno di una faccia (stack sopra + sotto), senza root `<g>`/`<svg>`.
 * Componibili in un `<g id="…" class="…" transform="…">` in una griglia (nessun `<svg>` annidato).
 *
 * Solo **`<path>`** con **`id="{faceGroupId}-topFlap"`** ecc. (niente gruppi per livello). Con **`flipBottomY`**
 * l’unico `<g>` extra è quello dello **`scale(1,-1)`** sulla mezza bassa.
 */
export function renderFlapCellFaceInner(input: FlapCellFaceInnerInput): string {
    const W = input.width;
    const H = input.height;
    const flipLower = input.flipBottomY;
    const gid = input.faceGroupId;

    const upper = [
        injectPathIds(input.flapTopSvg, `${gid}-topFlap`),
        injectPathIds(input.contentTopSvg, `${gid}-topContent`),
    ]
        .filter(Boolean)
        .join("\n");

    const lowerFlat = [
        injectPathIds(input.flapBottomSvg, `${gid}-bottomFlap`),
        injectPathIds(input.contentBottomSvg, `${gid}-bottomContent`),
    ]
        .filter(Boolean)
        .join("\n");

    const lowerTransform =
        `transform="translate(${W / 2}, ${H / 2}) ` +
        `scale(1,-1) ` +
        `translate(${-W / 2}, ${-H / 2})"`;
    const lower = flipLower ? `<g ${lowerTransform}>\n${lowerFlat}\n</g>` : lowerFlat;

    return [upper, lower].join("\n");
}

/**
 * One standalone `<svg>` document: root svg → `<g id="…">` → `inner` (e.g. from {@link renderFlapCellFaceInner}).
 */
export function wrapFlapFaceInnerInSvgDocument(input: {
    width: number;
    height: number;
    faceGroupId: string;
    faceGroupClass?: string;
    inner: string;
}): string {
    const W = input.width;
    const H = input.height;
    const gid = escapeXmlAttr(input.faceGroupId);
    const fc = input.faceGroupClass;
    const classAttr =
        fc === ""
            ? ""
            : ` class="${escapeXmlAttr(fc === undefined ? DEFAULT_FLAP_FACE_CLASS : fc)}"`;
    return [
        `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`,
        `<g id="${gid}"${classAttr}>`,
        input.inner,
        `</g>`,
        `</svg>`,
    ].join("\n");
}

/** Flat grid cell → full `<svg>` (for 3D / file export). Strings pass through unchanged. */
export function flapGridCellToStandaloneFaceSvg(
    cell: FlapImageGridCell,
    cellW: number,
    cellH: number,
    faceGroupClass?: string,
): string {
    if (typeof cell === "string") return cell;
    return wrapFlapFaceInnerInSvgDocument({
        width: cellW,
        height: cellH,
        faceGroupId: cell.faceGroupId,
        faceGroupClass,
        inner: cell.inner,
    });
}

/**
 * Build one cell `<svg>` from four pre-built strings.
 *
 * **Upper stack:** `flapTopSvg`, then `contentTopSvg`.
 * **Lower stack:** `flapBottomSvg`, then `contentBottomSvg`.
 *
 * `faceGroupId`: unico in documento (`flap-0`… per preview modulo o produzione 2D).
 * `faceGroupClass` default [`DEFAULT_FLAP_FACE_CLASS`] (`"flap"`); stringa vuota = nessun `class`.
 */
export function renderFlapCellSvgDocument(
    input: FlapCellFaceInput & {
        faceGroupId: string;
        faceGroupClass?: string;
    },
): string {
    const inner = renderFlapCellFaceInner({
        width: input.width,
        height: input.height,
        flipBottomY: input.flipBottomY,
        flapTopSvg: input.flapTopSvg,
        contentTopSvg: input.contentTopSvg,
        flapBottomSvg: input.flapBottomSvg,
        contentBottomSvg: input.contentBottomSvg,
        faceGroupId: input.faceGroupId,
    });
    return wrapFlapFaceInnerInSvgDocument({
        width: input.width,
        height: input.height,
        faceGroupId: input.faceGroupId,
        faceGroupClass: input.faceGroupClass,
        inner,
    });
}
