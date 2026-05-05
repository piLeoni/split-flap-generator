import { load as cheerioLoad } from "cheerio";
import { isOpaqueBlackFill, paintFromSvgPathAttribs } from "./svgPathPaint.js";

/**
 * Satori/flatten output often leaves `currentColor`, missing fills, and black glyph fills.
 * After this pass, every drawable path/line in the **content** SVG has explicit
 * `fill` (paths) or `stroke` (lines) — same shapes that follow into CanvasKit clip.
 */
export function finalizePrintSvg(
    svg: string,
    contentFill: string,
    replaceSatoriBlackGlyph: boolean,
): string {
    if (!svg.trim()) return svg;
    const $ = cheerioLoad(svg, { xmlMode: true });

    $("path").each((_, el) => {
        const $el = $(el);
        const attribs = $el.attr() as Record<string, string | undefined>;
        let paint = paintFromSvgPathAttribs(attribs, contentFill);
        if (replaceSatoriBlackGlyph && isOpaqueBlackFill(paint.fill)) {
            paint = { ...paint, fill: contentFill };
        }
        if (typeof paint.fill === "string" && paint.fill) {
            $el.attr("fill", paint.fill);
        }
        if (paint.stroke) $el.attr("stroke", paint.stroke);
        if (paint.strokeWidth) $el.attr("stroke-width", paint.strokeWidth);
    });

    $("line").each((_, el) => {
        const $el = $(el);
        const attribs = $el.attr() as Record<string, string | undefined>;
        const paint = paintFromSvgPathAttribs(attribs, contentFill);
        const stroke = (paint.stroke ?? paint.fill ?? contentFill).trim();
        $el.attr("stroke", stroke);
        if (paint.strokeWidth) $el.attr("stroke-width", paint.strokeWidth);
    });

    // CheerioAPI: `xml()` for SVG, `html()` as fallback
    return $.xml();
}
