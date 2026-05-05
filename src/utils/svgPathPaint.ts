export function parseInlineStyle(style: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!style?.trim()) return out;
    for (const part of style.split(";")) {
        const idx = part.indexOf(":");
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim().toLowerCase();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = v;
    }
    return out;
}

/** Extract fill/stroke from SVG path presentation attributes and inline `style`. */
export function paintFromSvgPathAttribs(
    attribs: Record<string, string | undefined>,
    fallbackFill: string,
): { fill?: string; stroke?: string; strokeWidth?: string } {
    const styleMap = parseInlineStyle(attribs.style);
    let fill = attribs.fill ?? styleMap.fill;
    const stroke = attribs.stroke ?? styleMap.stroke;
    const strokeWidth =
        attribs["stroke-width"] ?? styleMap["stroke-width"] ?? styleMap["stroke-width"] ?? styleMap.strokewidth;

    if (fill === "currentColor") fill = fallbackFill;
    const fillTrim = fill?.trim();
    const resolvedFill = fillTrim === undefined || fillTrim === "" ? fallbackFill : fillTrim;

    return {
        fill: resolvedFill,
        stroke: stroke?.trim() || undefined,
        strokeWidth: strokeWidth?.trim() || undefined,
    };
}

export function escapeXmlAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** True for CSS/SVG fills that are visually black (Satori often emits this for glyphs). */
export function isOpaqueBlackFill(fill: string | undefined): boolean {
    if (!fill?.trim()) return false;
    const x = fill.trim().toLowerCase();
    if (x === "black") return true;
    if (x === "#000" || x === "#000000") return true;
    if (x === "rgb(0,0,0)" || x === "rgba(0,0,0,1)") return true;
    return false;
}
