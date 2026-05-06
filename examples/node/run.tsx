/**
 * Node example: library usage first; any `node:fs` / `node:path` usage is isolated in `main()`.
 * Intended to read well in the published README.
 */

import path from "node:path";
import type { SatoriElementNode } from "../../src/core/types.js";
import { mm2px } from "../../src/utils/conversions.js";
import {
    SplitFlap,
    generateFlapSvgTemplate,
    type GenerateFlap3DOutput,
} from "../../src/index.js";

// ─── Physical layout of one flap tile (millimetres) ─────────────────────────

const FLAPS = {
    width: 54,
    height: 86,
    flapCornerRadius: 3,
    flapsGap: 2,
    flangeHeight: 1.3,
    notchInset: 3.2,
    notchInnerHeight: 15,
} as const;

export type DemoArtifacts = {
    flapTemplateSvg: string;
    previewSvg: string;
    productionSheets: string[];
    /** One OBJ/MTL per production sheet (same packing as `productionSheets`) — not one file per flap. */
    meshes3d: GenerateFlap3DOutput[];
};

// ─── Register flaps: text, colors, HTML (JSX), SVG string ─────────────────────

async function populateFlaps(sf: SplitFlap, assets: { cardSvg: string }): Promise<void> {
    // Same sequence as the README “Minimal usage” (kept in sync on purpose).
    for (const ch of " ABCDE".split("")) {
        await sf.createFLAP({ textContent: ch });
    }

    for (const backgroundColor of ["#1e3a5f", "#0f766e"] as const) {
        await sf.createFLAP({ textContent: " ", style: { backgroundColor } });
    }

    /**
     * Rich text via JSX: Satori styles semantic tags (`<b>`, `<i>`, …). `UnifrakturCook` loads like any
     * other `fontFamily` (see old `src/test.tsx`). This is the heavier HTML case we regression-smoke here.
     */
    const lastWord = "amet";
    await sf.createFLAP({
        // Padding on the Satori wrapper (`htmlRenderer` content node), not inside JSX: inner `%` sizes were
        // shrink-wrapped so padding never inset from the flap. Numbers here are **mm** → px in `normalizeStyle`.
        style: {
            backgroundColor: "#0DD",
            paddingTop: 4.5,
            paddingBottom: 4.5,
            paddingLeft: 6,
            paddingRight: 6,
        },
        HTMLContent: (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignContent: "space-between",
                    alignItems: "flex-start",
                    textAlign: "left",
                    fontSize: `${mm2px(13)}px`,
                    lineHeight: "1.05",
                }}
            >
                {"Lorem "}
                <b style={{ fontFamily: "UnifrakturCook" }}>ipsum </b>
                <i style={{ color: "blue" }}>dolor </i>
                <b style={{ color: "red", textTransform: "capitalize", textDecoration: "line-through" }}>
                    <i>sit </i>
                </b>
                {lastWord}
            </div>
        ) as unknown as SatoriElementNode,
    });

    await sf.createFLAP({ SVGContent: assets.cardSvg, style: { backgroundColor: "#f8fafc" } });
}

/** Everything stays in memory until you choose to persist it (see `main()` below). */
export async function buildDemoArtifacts(sf: SplitFlap, assets: { cardSvg: string }): Promise<DemoArtifacts> {
    await sf.init({
        ...FLAPS,
        flapThickness: 0.8,
        embossDepth: 0.4,
    });
    await populateFlaps(sf, assets);

    return {
        flapTemplateSvg: generateFlapSvgTemplate(FLAPS),
        previewSvg: sf.generateFlapsPreview({ cols: 8, gap: 2 }),
        productionSheets: sf.generateProductionFlaps2D({ gap: 2 }),
        meshes3d: sf.generateProductionFlaps3DGrid({ gap: 2, meshNamePrefix: "demo" }),
    };
}

/** Classic split-flap charset → production 2D sheets + 3D meshes (same cell order as `getProductionFaceCells2D`). */
const PRODUCTION_CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:/";

export type CharsetProductionArtifacts = {
    sheets: string[];
    meshes3d: GenerateFlap3DOutput[];
};

export async function buildCharsetProduction(): Promise<CharsetProductionArtifacts> {
    const sf = new SplitFlap();
    await sf.init({
        ...FLAPS,
        flapThickness: 0.8,
        embossDepth: 0.4,
    });
    for (const ch of PRODUCTION_CHARSET.split("")) {
        await sf.createFLAP({ textContent: ch });
    }
    return {
        sheets: sf.generateProductionFlaps2D({ cols: 5, rows: 5, gap: 2 }),
        meshes3d: sf.generateProductionFlaps3DGrid({ cols: 5, rows: 5, gap: 2, meshNamePrefix: "charset" }),
    };
}

// ─── Node: load the sample SVG and write outputs under `./out` ──────────────

/** Canonical card asset on `main` (same file as `examples/assets/card_54x86mm.svg` in the repo). */
const CARD_SVG_URL =
    "https://raw.githubusercontent.com/piLeoni/split-flap-generator/main/examples/assets/card_54x86mm.svg";

async function loadCardSvg(root: string, readLocalUtf8: () => string): Promise<string> {
    try {
        const res = await fetch(CARD_SVG_URL, { redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } catch {
        return readLocalUtf8();
    }
}

function writeObjMtl(dir: string, meshes: GenerateFlap3DOutput[], fs: typeof import("node:fs")): void {
    for (const m of meshes) {
        if (!m.obj) continue;
        fs.writeFileSync(`${dir}/${m.meshFileStem}.obj`, m.obj, "utf8");
        if (m.mtl) fs.writeFileSync(`${dir}/${m.mtlFileName}`, m.mtl, "utf8");
    }
}

async function main(): Promise<void> {
    const { default: fs } = await import("node:fs");

    const root = process.cwd();
    const localCard = () => fs.readFileSync(path.join(root, "examples", "assets", "card_54x86mm.svg"), "utf8");
    const cardSvg = await loadCardSvg(root, localCard);

    const demo = await buildDemoArtifacts(new SplitFlap(), { cardSvg });

    const outDir = path.join(root, "out");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "flap_template.svg"), demo.flapTemplateSvg);
    fs.writeFileSync(path.join(outDir, "preview.svg"), demo.previewSvg);
    demo.productionSheets.forEach((svg, i) => {
        fs.writeFileSync(path.join(outDir, `preview_production_${i}.svg`), svg);
    });

    const charset = await buildCharsetProduction();
    charset.sheets.forEach((svg, i) => {
        fs.writeFileSync(path.join(outDir, `production_charset_${i}.svg`), svg);
    });

    const dir3d = path.join(outDir, "3d");
    if (fs.existsSync(dir3d)) fs.rmSync(dir3d, { recursive: true });
    fs.mkdirSync(dir3d, { recursive: true });
    writeObjMtl(dir3d, demo.meshes3d, fs);
    writeObjMtl(dir3d, charset.meshes3d, fs);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
