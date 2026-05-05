import type { FlapsOptions } from "../core/types.js";

export type FlapSvgTemplateInput = Pick<FlapsOptions, "width" | "height">;

/**
 * Minimal SVG shell: root `width`/`height` in mm and matching `viewBox` (user units = mm).
 * No decorative rects — scale comes from these dimensions plus `init()` mm when importing.
 */
export function generateFlapSvgTemplate(input: FlapSvgTemplateInput): string {
    const w = input.width;
    const h = input.height;
    if (!(w > 0) || !(h > 0)) throw new Error("generateFlapSvgTemplate: width and height must be positive");

    const wStr = String(w);
    const hStr = String(h);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${wStr}mm"
     height="${hStr}mm"
     viewBox="0 0 ${wStr} ${hStr}">
</svg>
`;
}
