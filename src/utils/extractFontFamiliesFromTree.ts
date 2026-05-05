import type { FlapStyle } from "../core/types.js";
import { parseFontFamilies } from "../styles/normalizeStyle.js";

/** Collect `fontFamily` values from Satori-style trees and React/JSX elements (`props.style` + `props.children`). */
export function extractFontFamiliesFromTree(root: unknown): string[] {
    const discovered = new Set<string>();
    function walk(n: unknown): void {
        if (n == null || typeof n === "boolean") return;
        if (typeof n === "string" || typeof n === "number") return;
        if (Array.isArray(n)) {
            for (const x of n) walk(x);
            return;
        }
        if (typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        const props = o.props;
        if (props && typeof props === "object") {
            const p = props as Record<string, unknown>;
            const style = p.style;
            if (style && typeof style === "object") {
                for (const fam of parseFontFamilies(style as FlapStyle)) discovered.add(fam);
            }
            walk(p.children);
        }
    }
    walk(root);
    return [...discovered];
}
