import type { CanvasKit } from "canvaskit-wasm";
import type { ContentRenderer, RenderPayload } from "./types.js";
import type { SvgFlapContent, FlapsOptions, SatoriFontOption } from "../core/types.js";
import { mm2px } from "../utils/conversions.js";
import { flattenUserSvgForClip } from "../utils/flattenUserSvgForClip.js";

export const svgRenderer: ContentRenderer<SvgFlapContent> = {
    supports(content): content is SvgFlapContent {
        return "SVGContent" in content;
    },
    async render(content, options, _fonts, canvasKit: CanvasKit): Promise<RenderPayload> {
        const isBlank = content.SVGContent.trim() === "";
        if (isBlank) return { svg: "", invertedSvg: "", isBlank: true };

        const W = mm2px(options.width);
        const H = mm2px(options.height);
        const defaultFill = typeof content.style?.color === "string" ? content.style.color : "#000000";
        const { normal, inverted } = flattenUserSvgForClip(canvasKit, content.SVGContent, W, H, defaultFill, {
            widthMm: options.width,
            heightMm: options.height,
        });
        return { svg: normal, invertedSvg: inverted, isBlank: false };
    },
};
