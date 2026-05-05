import type { PaintedPathSegment } from "../core/types.js";
import { escapeXmlAttr } from "./svgPathPaint.js";

/** Classi usate in SVG per parsing / 3D (stesso string in build + consumer). */
export const flapSvgClass = {
    topFlap: "topFlap",
    bottomFlap: "bottomFlap",
    topContent: "topContent",
    bottomContent: "bottomContent",
} as const;

/** Mezza maschera: un `<path/>` con `d`, `fill` da lamiera, **solo** `class` (no id sul path). */
export function emitFlapMaskPath(d: string, fill: string, className: string): string {
    const c = escapeXmlAttr(className);
    return `<path class="${c}" fill-rule="evenodd" d="${escapeXmlAttr(d)}" fill="${escapeXmlAttr(fill)}" />`;
}

/** Avvolge markup arbitrario in `<g class="…">` (raro; preferire `class` sui path via {@link emitWrappedContent}). */
export function wrapWithClass(className: string, inner: string): string {
    return `<g class="${escapeXmlAttr(className)}">\n${inner}\n</g>`;
}

/**
 * Single definition of the SVG **content** `<path/>` (glyphs, user SVG) after
 * `finalizePrintSvg` → clip: only `d` is replaced; `fill` / `stroke` are copied
 * from the same elements in the finalized SVG in `clipAllPathElements`.
 * For die masks use {@link emitFlapMaskPath} at `buildResult` / production pairing.
 */
export function emitClippedContentPathElement(s: PaintedPathSegment, className?: string): string {
    const fill = escapeXmlAttr(s.fill);
    const d = escapeXmlAttr(s.path);
    let extra = "";
    if (s.stroke) extra += ` stroke="${escapeXmlAttr(s.stroke)}"`;
    if (s.strokeWidth) extra += ` stroke-width="${escapeXmlAttr(s.strokeWidth)}"`;
    const cls = className ? ` class="${escapeXmlAttr(className)}"` : "";
    return `<path${cls} fill-rule="evenodd" d="${d}" fill="${fill}"${extra} />`;
}

export function emitClippedContentPathElements(segments: PaintedPathSegment[], className?: string): string {
    return segments.map((s) => emitClippedContentPathElement(s, className)).join("\n");
}

export function emitWrappedContent(className: string, segments: PaintedPathSegment[]): string {
    if (segments.length === 0) return "";
    return emitClippedContentPathElements(segments, className);
}
