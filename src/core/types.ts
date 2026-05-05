export type StyleValue = string | number;
export type FlapStyle = Record<string, StyleValue | undefined>;

export interface FlapsOptions {
    height: number;
    width: number;
    flapCornerRadius: number;
    flapsGap: number;
    flangeHeight: number;
    notchInset: number;
    notchInnerHeight: number;
    style?: FlapStyle;
    /**
     * Optional origin (or path prefix) used **instead of** `https://fonts.googleapis.com` when fetching CSS2
     * (same path + query). In the browser, Google’s CSS is normally WOFF2-only; a dev proxy that rewrites
     * `User-Agent` to a non-browser value (e.g. `curl/8.0`) restores `format('truetype')` faces for Satori.
     */
    googleFontsCssBaseUrl?: string;
    defaultFonts?: string[];
    /** Millimetres — defaults for `generateProductionFlaps3D()` when you omit that argument (or override per call). */
    flapThickness?: number;
    /** Millimetres — emboss / relief depth (half-depth per side in the 3D pipeline). */
    embossDepth?: number;
}

export interface TextFlapContent {
    textContent: string;
    style?: FlapStyle;
}

/** One node in the object tree Satori expects (`type` + `props.style` + `props.children`). */
export type SatoriElementChild = string | number | SatoriElementNode;

export interface SatoriElementNode {
    type: string;
    props?: {
        style?: FlapStyle;
        children?: SatoriElementChild | SatoriElementChild[];
    };
}

/**
 * Inject the same **element tree** Satori’s npm example uses — the thing JSX compiles into.
 * In a `.tsx` file you can write `<div style={{ color: "black" }}>{value}</div>` and pass it here (see repo
 * `examples/node/run.tsx`). Use **`{value}`** for interpolation inside JSX. A **template literal**
 * `` `<div>${value}</div>` `` is only a **string** of characters, not a tree; Satori won’t treat it as markup.
 */
export interface HtmlFlapContent {
    HTMLContent: SatoriElementNode;
    style?: FlapStyle;
}

export interface SvgFlapContent {
    SVGContent: string;
    style?: FlapStyle;
}

export type FlapContentInput = TextFlapContent | HtmlFlapContent | SvgFlapContent;
export type FlapContent = FlapContentInput;

/** Single SVG path `d` string in pixel space. */
export interface FlapPathData {
    path: string;
}

/** One clipped content region: geometry and explicit paint (resolved before clip / SVG output). */
export interface PaintedPathSegment {
    path: string;
    fill: string;
    stroke?: string;
    strokeWidth?: string;
}

/**
 * Vector output for one flap tile: clip outline plus top/bottom clipped content halves.
 */
export interface FlapRenderResult {
    /** 0-based flap index, used for stable face-group ids and 3D export ordering. */
    flapIndex: number;
    /** Top-half flap outline used as clip mask (same space as `FlapsOptions` geometry). */
    flap: FlapPathData;
    /** Upper half clipped content; one entry per source `<path>`. */
    contentTop: PaintedPathSegment[];
    /** Lower half (Y flipped when composited in previews). */
    contentBottom: PaintedPathSegment[];
    /**
     * Final &lt;path&gt;… markup for top/bottom, emitted at `createFLAP` (same as {@link contentTop} / `emitClippedContentPathElements`).
     * The cell view only splices these strings — it does not re-serialize segment rows.
     */
    contentTopSvg: string;
    contentBottomSvg: string;
    /** Half-module flap mask path already emitted via `emitFlapMaskPath` in `createFLAP`. */
    flapTopSvg: string;
    flapBottomSvg: string;
    style?: FlapStyle;
}
/**
 * 2D production face cell (pair flap *i* / *i+1*): four pre-emitted SVG strips.
 * The unique face id index is applied by grid/renderer code, not stored here.
 */
export interface FlapProductionResult {
    flapTopSvg: string;
    contentTopSvg: string;
    flapBottomSvg: string;
    contentBottomSvg: string;
}

/**
 * One element in {@link SplitFlap.generateImageGrid}:
 * - `string` = legacy standalone cell SVG document (`<svg>…</svg>`) nested into the grid;
 * - object = flat face cell (preview + production): `faceGroupId` (e.g. `flap-0`) and `inner` markup.
 */
export type FlapImageGridCell = string | { faceGroupId: string; inner: string };

/** Flat face cell `{ id, inner }` without a root `<svg>` wrapper (alternative to full SVG docs in {@link FlapImageGridCell}). */
export type ProductionFlatFaceCell = Extract<FlapImageGridCell, { faceGroupId: string; inner: string }>;

/**
 * Production payload: flat cells `{ faceGroupId, inner }` for grid packing (no nested `<svg>` per cell),
 * plus `pairs` if callers need the four original strips. For OBJ/MTL paths, the library wraps faces in a
 * minimal `<svg>` document when required by downstream helpers.
 * `cellW` / `cellH` are 2D grid pitch dimensions for each `cells[i].inner` path coordinate space.
 */
export type ProductionFaceCells2D = {
    cellW: number;
    cellH: number;
    cells: FlapImageGridCell[];
    pairs: FlapProductionResult[];
};


export type ProductionFlap3d = {
    flapThickness: number;
    embossDepth: number;
}

/** CSS `font-style` for Satori. */
export type FontStyle = "normal" | "italic";

/** Standard CSS weights Satori accepts (see `FontOptions` in `satori`). */
export type SatoriFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

/** One binary font (TTF) registered with Satori for a family + weight + style slice. */
export interface SatoriFontOption {
    name: string;
    data: ArrayBuffer;
    weight: SatoriFontWeight;
    style: FontStyle;
}
