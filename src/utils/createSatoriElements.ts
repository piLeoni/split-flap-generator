import { mm2px } from "./conversions.js";
import type { FlapsOptions, TextFlapContent } from "../core/types.js";

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

/** Geometry for the upper half outline of a split-flap module (pixel space). */
export type FlapTopHalfOutlineParams = {
    width: number;
    flapHeight: number;
    flapCornerRadius: number;
    flangeHeight: number;
    notchInset: number;
    notchInnerHeight: number;
};

/** SVG `d` for the top-half flap outline used as the CanvasKit clip mask. */
export function createFlapTopHalfOutlinePath(p: FlapTopHalfOutlineParams): string {
    const w = p.width;
    const H = p.flapHeight;
    const r = clamp(p.flapCornerRadius, 0, Math.min(w / 2, H / 2));
    const f = Math.max(0, p.flangeHeight);
    const inset = clamp(p.notchInset, 0, w / 2 - 1e-6);
    const inner = Math.max(0, p.notchInnerHeight);

    const yNotchTop = H - f - inner;
    if (w <= 0 || H <= 0 || yNotchTop <= r) return "";

    return [
        `M ${r} 0`,
        `L ${w - r} 0`,
        `A ${r} ${r} 0 0 1 ${w} ${r}`,
        `L ${w} ${yNotchTop}`,
        `L ${w - inset} ${yNotchTop}`,
        `L ${w - inset} ${H - f}`,
        `L ${w} ${H - f}`,
        `L ${w} ${H}`,
        `L 0 ${H}`,
        `L 0 ${H - f}`,
        `L ${inset} ${H - f}`,
        `L ${inset} ${yNotchTop}`,
        `L 0 ${yNotchTop}`,
        `L 0 ${r}`,
        `A ${r} ${r} 0 0 1 ${r} 0`,
        `Z`,
    ].join(" ");
}

/** Clip outline path string from module options (mm → px). */
export function createFlapClipOutlinePath(input: FlapsOptions): string {
    return createFlapTopHalfOutlinePath({
        width: mm2px(input.width),
        flapHeight: mm2px(input.height / 2 - input.flapsGap / 2),
        flapCornerRadius: mm2px(input.flapCornerRadius),
        flangeHeight: mm2px(input.flangeHeight),
        notchInset: mm2px(input.notchInset),
        notchInnerHeight: mm2px(input.notchInnerHeight),
    });
}

const flexCenter = (input: FlapsOptions) => ({
    display: "flex" as const,
    width: mm2px(input.width),
    height: mm2px(input.height),
    justifyContent: "center" as const,
    alignItems: "center" as const,
    position: "absolute" as const,
    fontSize: mm2px(input.height),
});

interface SatoriFlapMaskOptions extends FlapsOptions {
    inverted?: boolean;
    color?: string;
}

/** Satori element: SVG wrapper with flap mask path (e.g. previews). */
export function createSatoriFlapMaskSvg(input: SatoriFlapMaskOptions): {
    type: string;
    props: Record<string, unknown>;
} {
    return {
        type: "svg",
        props: {
            width: mm2px(input.width),
            height: mm2px(input.height),
            viewBox: `0 0 ${mm2px(input.width)} ${mm2px(input.height)}`,
            style: {
                position: "absolute",
                left: 0,
                top: 0,
                ...(input.inverted && { transform: "scaleY(-1)" }),
            },
            children: {
                type: "path",
                props: {
                    d: createFlapTopHalfOutlinePath({
                        width: mm2px(input.width),
                        flapHeight: mm2px(input.height / 2 - input.flapsGap / 2),
                        flapCornerRadius: mm2px(input.flapCornerRadius),
                        flangeHeight: mm2px(input.flangeHeight),
                        notchInset: mm2px(input.notchInset),
                        notchInnerHeight: mm2px(input.notchInnerHeight),
                    }),
                    fill: input.color || "#FFFFFF",
                },
            },
        },
    };
}

interface SatoriTextContent extends FlapsOptions {
    inverted?: boolean;
}
export function createSatoriTextContent(content: TextFlapContent, options: SatoriTextContent): {
    type: string;
    props: Record<string, unknown>;
} {
    return {
        type: "div",
        props: {
            style: {
                ...flexCenter(options),
                ...(options.inverted && { transform: "scaleY(-1)" }),
            },
            children: {
                type: "div",
                props: {
                    style: {
                        ...flexCenter(options),
                        ...options.style,
                        ...content.style,
                    },
                    children: content.textContent,
                },
            },
        },
    };
}

export function createSatoriElementsWrapper(
    input: FlapsOptions,
    children: unknown,
): { type: string; props: Record<string, unknown> } {
    return {
        type: "div",
        props: {
            style: flexCenter(input),
            children,
        },
    };
}
