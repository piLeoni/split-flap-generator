import type { CanvasKit } from "canvaskit-wasm";
import type { ContentRenderer, RenderPayload } from "./types.js";
import type { HtmlFlapContent, FlapsOptions, SatoriFontOption, SatoriElementNode } from "../core/types.js";
import { createSatoriElementsWrapper } from "../utils/createSatoriElements.js";
import { mm2px } from "../utils/conversions.js";
import { runSatori } from "../utils/runSatori.js";

function createSatoriOptions(options: FlapsOptions, fonts: SatoriFontOption[]) {
    return {
        width: mm2px(options.width),
        height: mm2px(options.height),
        fonts,
    };
}

function hasRenderableText(node: SatoriElementNode): boolean {
    const c = node.props?.children;
    if (c === undefined || c === null) return false;
    if (typeof c === "string") return c.trim().length > 0;
    if (typeof c === "number") return true;
    if (Array.isArray(c)) {
        return c.some((x) =>
            typeof x === "string" ? x.trim().length > 0 : typeof x === "number" || hasRenderableText(x),
        );
    }
    return hasRenderableText(c);
}

export const htmlRenderer: ContentRenderer<HtmlFlapContent> = {
    supports(content): content is HtmlFlapContent {
        return "HTMLContent" in content;
    },
    async render(content, options, fonts, _canvasKit: CanvasKit): Promise<RenderPayload> {
        if (!hasRenderableText(content.HTMLContent)) return { svg: "", invertedSvg: "", isBlank: true };

        // Two layers: outer is the fixed Satori viewport; inner is full-size with `border-box` so
        // `createFLAP({ style: { padding… } })` reliably insets HTML (padding on the outer flex node was a no-op).
        const innerMatte = {
            type: "div",
            props: {
                style: {
                    width: "100%",
                    height: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "stretch",
                    ...content.style,
                },
                children: content.HTMLContent,
            },
        };
        const contentNode = {
            type: "div",
            props: {
                style: {
                    display: "flex",
                    width: mm2px(options.width),
                    height: mm2px(options.height),
                    position: "absolute",
                    fontSize: mm2px(options.height),
                },
                children: innerMatte,
            },
        };
        const invertedNode = {
            type: "div",
            props: {
                style: {
                    display: "flex",
                    width: mm2px(options.width),
                    height: mm2px(options.height),
                    transform: "scaleY(-1)",
                },
                children: contentNode,
            },
        };
        const satoriOptions = createSatoriOptions(options, fonts);
        const svg = await runSatori(createSatoriElementsWrapper(options, [contentNode]), satoriOptions);
        const invertedSvg = await runSatori(createSatoriElementsWrapper(options, [invertedNode]), satoriOptions);
        return { svg, invertedSvg, isBlank: false };
    },
};
