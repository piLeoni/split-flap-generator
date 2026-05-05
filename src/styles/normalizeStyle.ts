import { mm2px } from "../utils/conversions.js";
import type { FlapStyle } from "../core/types.js";

const MM_NUMERIC_STYLE_KEYS = new Set<string>([
    "fontSize",
    "lineHeight",
    "letterSpacing",
    "width",
    "height",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "margin",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "top",
    "left",
    "right",
    "bottom",
    "borderRadius",
]);

export function normalizeStyle(style: FlapStyle | undefined): FlapStyle | undefined {
    if (!style) return undefined;
    const normalized: FlapStyle = {};
    for (const [key, rawValue] of Object.entries(style)) {
        if (typeof rawValue === "number" && MM_NUMERIC_STYLE_KEYS.has(key)) {
            normalized[key] = `${mm2px(rawValue)}px`;
            continue;
        }
        normalized[key] = rawValue;
    }
    return normalized;
}

export function parseFontFamilies(style: FlapStyle | undefined): string[] {
    const raw = style?.fontFamily;
    if (typeof raw !== "string") return [];
    return raw
        .split(",")
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
}
