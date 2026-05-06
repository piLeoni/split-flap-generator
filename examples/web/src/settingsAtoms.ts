import { atomWithStorage } from "jotai/utils";

const PREFIX = "split-flap-web:v1";

/** Same order as `PRODUCTION_CHARSET` in `examples/node/run.tsx` (leading space = blank flap). */
export const DEFAULT_CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:/";

/** Default Satori text styles for plain `textContent` flaps. */
export const DEFAULT_FLAP_STYLE_JSON = `{
  "color": "#fff",
  "backgroundColor": "#000",
  "fontFamily": "Roboto Mono",
  "fontWeight": 600
}`;

/** mm — physical tile (defaults match the Node demo). */
export type TileMm = {
    width: number;
    height: number;
    flapCornerRadius: number;
    flapsGap: number;
    flangeHeight: number;
    notchInset: number;
    notchInnerHeight: number;
};

export const DEFAULT_TILE: TileMm = {
    width: 54,
    height: 86,
    flapCornerRadius: 3,
    flapsGap: 2,
    flangeHeight: 1.3,
    notchInset: 3.2,
    notchInnerHeight: 15,
};

function parseTileMm(raw: unknown): TileMm {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_TILE };
    const o = raw as Record<string, unknown>;
    const out: TileMm = { ...DEFAULT_TILE };
    for (const k of Object.keys(DEFAULT_TILE) as (keyof TileMm)[]) {
        const v = o[k];
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
}

const tileMmStorage = {
    getItem(key: string, initial: TileMm): TileMm {
        if (typeof localStorage === "undefined") return initial;
        try {
            const s = localStorage.getItem(key);
            if (s == null) return initial;
            return parseTileMm(JSON.parse(s));
        } catch {
            return initial;
        }
    },
    setItem(key: string, value: TileMm) {
        localStorage.setItem(key, JSON.stringify(value));
    },
    removeItem(key: string) {
        localStorage.removeItem(key);
    },
};

const storageOpts = { getOnInit: true as const };

export const charsetAtom = atomWithStorage(`${PREFIX}:charset`, DEFAULT_CHARSET, undefined, storageOpts);

export const tileAtom = atomWithStorage(`${PREFIX}:tile`, { ...DEFAULT_TILE }, tileMmStorage, storageOpts);

export const flapThicknessAtom = atomWithStorage(`${PREFIX}:flapThickness`, 0.8, undefined, storageOpts);

export const embossDepthAtom = atomWithStorage(`${PREFIX}:embossDepth`, 0.4, undefined, storageOpts);

export const gridGapAtom = atomWithStorage(`${PREFIX}:gridGap`, 2, undefined, storageOpts);

export const autoPreviewColsAtom = atomWithStorage(`${PREFIX}:autoPreviewCols`, true, undefined, storageOpts);

export const previewColsAtom = atomWithStorage(`${PREFIX}:previewCols`, 8, undefined, storageOpts);

export const sheetColsAtom = atomWithStorage(`${PREFIX}:sheetCols`, 8, undefined, storageOpts);

export const sheetRowsAtom = atomWithStorage(`${PREFIX}:sheetRows`, 4, undefined, storageOpts);

export const flapStyleJsonAtom = atomWithStorage(`${PREFIX}:flapStyleJson`, DEFAULT_FLAP_STYLE_JSON, undefined, storageOpts);

/** “Geometry, grids & typography” panel */
export const geometrySectionOpenAtom = atomWithStorage(`${PREFIX}:ui:geometryOpen:v2`, false, undefined, storageOpts);

/** Nested “Font and flap style (JSON)” panel */
export const fontStyleSectionOpenAtom = atomWithStorage(`${PREFIX}:ui:fontStyleOpen`, false, undefined, storageOpts);
