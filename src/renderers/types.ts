import type { CanvasKit } from "canvaskit-wasm";
import type { FlapContentInput, FlapsOptions, SatoriFontOption } from "../core/types.js";

export interface RenderPayload {
    svg: string;
    invertedSvg: string;
    isBlank: boolean;
}

export interface ContentRenderer<T extends FlapContentInput> {
    supports: (content: FlapContentInput) => content is T;
    render: (
        content: T,
        options: FlapsOptions,
        fonts: SatoriFontOption[],
        canvasKit: CanvasKit,
    ) => Promise<RenderPayload>;
}
