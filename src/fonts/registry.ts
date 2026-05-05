import { fetchAllSatoriFontOptionsForFamily } from "../utils/fetchFonts.js";
import type { FlapStyle, FontStyle, SatoriFontOption, SatoriFontWeight } from "../core/types.js";
import { parseFontFamilies } from "../styles/normalizeStyle.js";

function fontKey(name: string, weight: SatoriFontWeight, style: FontStyle): string {
    return `${name.toLowerCase()}::${weight}::${style}`;
}

export class FontRegistry {
    private readonly cache = new Map<string, SatoriFontOption>();
    private readonly knownFamilies = new Set<string>();
    /** Families we already tried to load and got zero usable faces (skip repeat work until reload). */
    private readonly failedFamilies = new Set<string>();
    private googleFontsCssBaseUrl: string | undefined;
    private readonly fallbackFamilies: string[];

    /**
     * Default fallbacks: Roboto Mono (primary look), Noto Sans (coverage). `getFonts()` moves all
     * “Noto Sans” slots to the end so decorative families loaded later (e.g. from `fontFamily`) are not
     * last in Satori’s list — Satori tends to use the last face for unqualified text, which would otherwise
     * break symbols (e.g. U+2592) when that face has no outline.
     */
    constructor(fallbackFamilies: string[] = ["Roboto Mono", "Noto Sans"]) {
        this.fallbackFamilies = fallbackFamilies;
    }

    /** See {@link FlapsOptions.googleFontsCssBaseUrl}. */
    setGoogleFontsCssBaseUrl(url: string | undefined): void {
        this.googleFontsCssBaseUrl = url?.trim() || undefined;
    }

    async warmup(families: string[]): Promise<void> {
        const allFamilies = [...families, ...this.fallbackFamilies];
        for (const family of allFamilies) {
            await this.ensureFamily(family);
        }
    }

    async ensureFromStyles(styles: Array<FlapStyle | undefined>): Promise<void> {
        const discovered = new Set<string>();
        for (const style of styles) {
            for (const family of parseFontFamilies(style)) discovered.add(family);
        }
        for (const family of discovered) {
            await this.ensureFamily(family);
        }
    }

    /** Load families referenced only inside a rich `node` tree (nested `style.fontFamily`). */
    async ensureFamilyNames(families: string[]): Promise<void> {
        for (const family of families) {
            await this.ensureFamily(family);
        }
    }

    getFonts(): SatoriFontOption[] {
        const all = Array.from(this.cache.values());
        const isNotoSans = (name: string) => name.trim().toLowerCase() === "noto sans";
        const head: SatoriFontOption[] = [];
        const tail: SatoriFontOption[] = [];
        for (const f of all) {
            (isNotoSans(f.name) ? tail : head).push(f);
        }
        /** Satori effectively defaults to the last face for unqualified text; keep broad coverage last. */
        return [...head, ...tail];
    }

    private async ensureFamily(family: string): Promise<void> {
        const normalizedFamily = family.trim();
        const key = normalizedFamily.toLowerCase();
        if (!normalizedFamily || this.knownFamilies.has(key) || this.failedFamilies.has(key)) return;

        const loaded = await fetchAllSatoriFontOptionsForFamily(normalizedFamily, {
            googleFontsCssBaseUrl: this.googleFontsCssBaseUrl,
        });
        if (loaded.length === 0) {
            this.failedFamilies.add(key);
            return;
        }

        this.knownFamilies.add(key);
        for (const opt of loaded) {
            this.cache.set(fontKey(normalizedFamily, opt.weight, opt.style), opt);
        }
    }
}
