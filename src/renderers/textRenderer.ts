import type { CanvasKit } from "canvaskit-wasm";
import type { ContentRenderer, RenderPayload } from "./types.js";
import type { TextFlapContent, FlapsOptions, SatoriFontOption } from "../core/types.js";
import { createSatoriElementsWrapper, createSatoriTextContent } from "../utils/createSatoriElements.js";
import { mm2px } from "../utils/conversions.js";
import { runSatori } from "../utils/runSatori.js";

function createSatoriOptions(options: FlapsOptions, fonts: SatoriFontOption[]) {
    return {
        width: mm2px(options.width),
        height: mm2px(options.height),
        fonts,
    };
}

export const textRenderer: ContentRenderer<TextFlapContent> = {
    supports(content): content is TextFlapContent {
        return "textContent" in content;
    },
    async render(content, options, fonts, _canvasKit: CanvasKit): Promise<RenderPayload> {
        const isBlank = content.textContent.trim() === "";
        if (isBlank) return { svg: "", invertedSvg: "", isBlank: true };

        const normalNode = createSatoriTextContent(content, options);
        const invertedNode = createSatoriTextContent(content, { ...options, inverted: true });
        const satoriOptions = createSatoriOptions(options, fonts);
        const svg = await runSatori(createSatoriElementsWrapper(options, [normalNode]), satoriOptions);
        const invertedSvg = await runSatori(createSatoriElementsWrapper(options, [invertedNode]), satoriOptions);
        return { svg, invertedSvg, isBlank: false };
    },
};
