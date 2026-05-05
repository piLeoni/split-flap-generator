import type { FontStyle, SatoriFontOption, SatoriFontWeight } from "../core/types.js";
import { GOOGLE_FONTS_TTF_FALLBACK_MAP } from "./googleFontsTtfFallbackMap.js";

/** Google serves WOFF2 to modern browsers; this UA keeps a single `format('truetype')` face (needed for Satori). */
const GOOGLE_FONTS_CSS_UA = "curl/8.0";

const GOOGLE_FONTS_CSS_ORIGIN = "https://fonts.googleapis.com";
const FONT_DIAG_PREFIX = "[split-flap/fonts]";

export type GoogleFontsFetchOptions = {
    /** Optional CSS2 base URL (same semantics as `FlapsOptions.googleFontsCssBaseUrl` on `SplitFlap.init`). */
    googleFontsCssBaseUrl?: string;
};

/** Replace `https://fonts.googleapis.com` so CSS is fetched via a same-origin proxy (server sets non-browser `User-Agent`). */
function rewriteGoogleFontsCssUrl(url: string, baseUrl?: string): string {
    if (!baseUrl?.trim()) return url;
    if (!url.startsWith(GOOGLE_FONTS_CSS_ORIGIN)) return url;
    return `${baseUrl.replace(/\/$/, "")}${url.slice(GOOGLE_FONTS_CSS_ORIGIN.length)}`;
}

const STANDARD_WEIGHTS: readonly number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function buildFullItalWghtAxis(): string {
    const pairs: string[] = [];
    for (const ital of [0, 1] as const) {
        for (const w of STANDARD_WEIGHTS) {
            pairs.push(`${ital},${w}`);
        }
    }
    return `ital,wght@${pairs.join(";")}`;
}

/**
 * Google Fonts CSS2 rejects all-lowercase typos (e.g. `roboto mono`). Title-case **only** when the string is
 * entirely lowercase so real names like `UnifrakturCook` or `IBM Plex Sans` stay intact.
 */
function googleFontsCssFamilyParameter(family: string): string {
    const t = family.trim();
    if (!t) return t;
    if (t !== t.toLowerCase()) return t;
    return t
        .split(/\s+/)
        .map((word) =>
            /^\d+$/.test(word) ? word : word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
}

function buildAxisCss2Url(family: string, weight: string, style: FontStyle): string {
    const enc = encodeURIComponent(googleFontsCssFamilyParameter(family));
    const ital = style === "italic" ? 1 : 0;
    return `${GOOGLE_FONTS_CSS_ORIGIN}/css2?family=${enc}:ital,wght@${ital},${weight}&display=swap`;
}

function buildDefaultCss2Url(family: string): string {
    return `${GOOGLE_FONTS_CSS_ORIGIN}/css2?family=${encodeURIComponent(googleFontsCssFamilyParameter(family))}&display=swap`;
}

function extractTtfUrlFromFaceBlock(body: string): string | null {
    if (!/format\(\s*['"]truetype['"]\s*\)/.test(body)) return null;
    const m = body.match(/url\(\s*([^)]+?)\s*\)\s*format\(\s*['"]truetype['"]\s*\)/);
    if (!m) return null;
    return m[1].replace(/^["']|["']$/g, "").trim();
}

function parseFontFaces(css: string): { weight: string; style: FontStyle; ttfUrl: string }[] {
    const out: { weight: string; style: FontStyle; ttfUrl: string }[] = [];
    const re = /@font-face\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
        const body = m[1];
        const ttfUrl = extractTtfUrlFromFaceBlock(body);
        if (!ttfUrl) continue;
        const weightMatch = body.match(/font-weight:\s*([\d\s]+)/)?.[1]?.trim() ?? "400";
        const firstWeight = weightMatch.split(/\s+/)[0] ?? "400";
        const weight = /^\d+$/.test(firstWeight) ? firstWeight : "400";
        const rawStyle = body.match(/font-style:\s*(normal|italic|oblique)/)?.[1] ?? "normal";
        const style: FontStyle = rawStyle === "italic" || rawStyle === "oblique" ? "italic" : "normal";
        out.push({ weight, style, ttfUrl });
    }
    return out;
}

function isStandardWeight(n: number): n is SatoriFontWeight {
    return n >= 100 && n <= 900 && n % 100 === 0;
}

/** Browsers ignore a custom `User-Agent` on `fetch`, so Google’s CSS only lists `woff2` — Satori needs SFNT (TTF/OTF). */
function isDomDocumentEnv(): boolean {
    return typeof globalThis !== "undefined" && typeof (globalThis as { document?: unknown }).document !== "undefined";
}

function fontDiag(...args: unknown[]): void {
    if (!isDomDocumentEnv()) return;
    console.warn(FONT_DIAG_PREFIX, ...args);
}

/**
 * Static TTF URLs (`fonts.gstatic.com`, `access-control-allow-origin: *`) when Google CSS has no
 * `format('truetype')` faces in the browser. Do **not** use variable (fvar) fonts here — Satori’s
 * bundled parser can throw while reading some `fvar` tables (e.g. `parseFvarAxis`).
 *
 * Pinned to CSS served for `wght@400` / `normal` as of 2026; if Google bumps paths, refresh these URLs.
 */
const BROWSER_TTF_FALLBACK: Readonly<Record<string, string>> = {
    "roboto mono":
        "https://fonts.gstatic.com/s/robotomono/v31/L0xuDF4xlVMF-BfR8bXMIhJHg45mwgGEFl0_3vqPQw.ttf",
    "noto sans":
        "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf",
    /** Google only ships 400/700; one static TTF is enough for Satori’s SFNT path. */
    tangerine:
        "https://fonts.gstatic.com/s/tangerine/v18/IurY6Y5j_oScZZow4VOBDg.ttf",
};

/** Map common misspellings to a pinned `BROWSER_TTF_FALLBACK` key (same TTF URL, `name` stays the user’s string). */
const PINNED_FAMILY_ALIASES: Readonly<Record<string, string>> = {
    tangerin: "tangerine",
};

function pinnedTtfUrlForFamily(displayName: string): string | undefined {
    const k = displayName.trim().toLowerCase();
    const canonical = PINNED_FAMILY_ALIASES[k] ?? k;
    return BROWSER_TTF_FALLBACK[canonical] ?? GOOGLE_FONTS_TTF_FALLBACK_MAP[canonical];
}

/**
 * One static TTF per family, registered for every standard weight × ital slot Satori might ask for.
 * Reuses the same `ArrayBuffer` reference to avoid copying large binaries.
 */
async function fetchBrowserFallbackTtfFamily(displayName: string): Promise<SatoriFontOption[]> {
    if (!isDomDocumentEnv()) return [];
    const url = pinnedTtfUrlForFamily(displayName);
    if (!url) {
        fontDiag(`No fallback TTF URL mapped for family "${displayName}"`);
        return [];
    }
    let res: Response;
    try {
        res = await fetch(url);
    } catch (err) {
        fontDiag(`Fallback TTF fetch failed for "${displayName}"`, { url, error: err });
        return [];
    }
    if (!res.ok) {
        fontDiag(`Fallback TTF HTTP error for "${displayName}"`, {
            url,
            status: res.status,
            statusText: res.statusText,
        });
        return [];
    }
    const data = await res.arrayBuffer();
    const name = displayName.trim();
    const out: SatoriFontOption[] = [];
    for (const w of STANDARD_WEIGHTS) {
        if (!isStandardWeight(w)) continue;
        for (const style of ["normal", "italic"] as FontStyle[]) {
            out.push({ name, data, weight: w, style });
        }
    }
    return out;
}

/**
 * Load every TTF face Google returns for a family (all standard `ital,wght` pairs that exist).
 */
export async function fetchAllSatoriFontOptionsForFamily(
    displayName: string,
    opts?: GoogleFontsFetchOptions,
): Promise<SatoriFontOption[]> {
    const name = displayName.trim();
    /** Pinned `fonts.gstatic.com` TTFs first: avoids `fonts.googleapis.com` fetch (WOFF2-only CSS + noisy errors in the browser). */
    if (isDomDocumentEnv()) {
        const pinned = await fetchBrowserFallbackTtfFamily(name);
        if (pinned.length > 0) return pinned;
    }

    const familyParam = googleFontsCssFamilyParameter(displayName);
    const axisUrl = `${GOOGLE_FONTS_CSS_ORIGIN}/css2?family=${encodeURIComponent(familyParam)}:${buildFullItalWghtAxis()}&display=swap`;
    let css = await fetchGoogleFontsCss(axisUrl, opts?.googleFontsCssBaseUrl);
    if (!css) css = await fetchGoogleFontsCss(buildDefaultCss2Url(displayName), opts?.googleFontsCssBaseUrl);
    if (!css) {
        fontDiag(`Google Fonts CSS unavailable for "${displayName}", trying fallback map`);
        return fetchBrowserFallbackTtfFamily(displayName);
    }

    const byKey = new Map<string, { weight: string; style: FontStyle; ttfUrl: string }>();
    for (const f of parseFontFaces(css)) {
        const k = `${f.weight}::${f.style}`;
        if (!byKey.has(k)) byKey.set(k, f);
    }

    const slots = await Promise.all(
        [...byKey.values()].map(async (f) => {
            try {
                const res = await fetch(f.ttfUrl);
                if (!res.ok) return null;
                const data = await res.arrayBuffer();
                const w = parseInt(f.weight, 10);
                if (!isStandardWeight(w)) return null;
                const opt: SatoriFontOption = { name, data, weight: w, style: f.style };
                return opt;
            } catch {
                return null;
            }
        }),
    );

    const loaded = slots.filter((x): x is SatoriFontOption => x != null);
    if (loaded.length > 0) return loaded;

    fontDiag(`TTF faces listed but none loaded for "${displayName}", trying fallback map`);
    return fetchBrowserFallbackTtfFamily(displayName);
}

function pickFace(
    faces: { weight: string; style: FontStyle; ttfUrl: string }[],
    weight: string,
    style: FontStyle,
): string | null {
    const exact = faces.find((f) => f.weight === weight && f.style === style);
    return exact?.ttfUrl ?? null;
}

async function fetchGoogleFontsCss(url: string, googleFontsCssBaseUrl?: string): Promise<string> {
    const finalUrl = rewriteGoogleFontsCssUrl(url, googleFontsCssBaseUrl);
    /** Direct `fonts.googleapis.com` from a document cannot force TTF CSS; proxied URLs are same-origin and get TTF on the server. */
    const isDirectGoogleInBrowser =
        isDomDocumentEnv() && finalUrl.startsWith(`${GOOGLE_FONTS_CSS_ORIGIN}/`);
    const headers: HeadersInit = isDirectGoogleInBrowser ? {} : { "User-Agent": GOOGLE_FONTS_CSS_UA };
    const res = await fetch(finalUrl, { headers });
    const text = await res.text();
    if (!res.ok || !text.includes("@font-face")) {
        fontDiag("Google Fonts CSS fetch did not return usable @font-face", {
            requestUrl: finalUrl,
            status: res.status,
            statusText: res.statusText,
            hasFontFace: text.includes("@font-face"),
            usedProxy: !!googleFontsCssBaseUrl,
        });
        return "";
    }
    return text;
}

/**
 * Download a Google Font TTF for Satori. Uses fonts.googleapis.com CSS2 (full glyph coverage) instead of
 * third-party metadata that can point at heavy-subset files (e.g. symbol fonts with only “latin”).
 */
export async function fetchFont(
    family: string,
    weight = "400",
    style: FontStyle = "normal",
    opts?: GoogleFontsFetchOptions,
): Promise<ArrayBuffer> {
    const base = opts?.googleFontsCssBaseUrl;
    const w = weight.toString();
    const axisCss = await fetchGoogleFontsCss(buildAxisCss2Url(family, w, style), base);
    let faces = axisCss ? parseFontFaces(axisCss) : [];
    let ttfUrl = pickFace(faces, w, style);

    if (!ttfUrl) {
        const fallbackCss = await fetchGoogleFontsCss(buildDefaultCss2Url(family), base);
        faces = fallbackCss ? parseFontFaces(fallbackCss) : [];
        ttfUrl = pickFace(faces, w, style);
    }

    if (!ttfUrl) {
        const fb = await fetchBrowserFallbackTtfFamily(family);
        const match = fb.find((f) => f.weight === parseInt(w, 10) && f.style === style);
        if (match) return match.data;
        throw new Error(`No TTF URL for ${family} (${w} ${style}) from Google Fonts CSS`);
    }

    const fontRes = await fetch(ttfUrl);
    if (!fontRes.ok) throw new Error(`Failed to download font binary for ${family}`);
    return fontRes.arrayBuffer();
}

export async function generateFontOptions(fonts: string[], opts?: GoogleFontsFetchOptions): Promise<SatoriFontOption[]> {
    const output: SatoriFontOption[] = [];
    for (const family of fonts) {
        output.push(...(await fetchAllSatoriFontOptionsForFamily(family, opts)));
    }
    return output;
}
