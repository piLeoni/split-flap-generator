import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { FlapStyle } from "split-flap-generator";
import { SplitFlap } from "split-flap-generator";
import canvaskitWasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import { FlapStyleEditor } from "./FlapStyleEditor";
import {
    autoPreviewColsAtom,
    charsetAtom,
    embossDepthAtom,
    flapStyleJsonAtom,
    flapThicknessAtom,
    fontStyleSectionOpenAtom,
    geometrySectionOpenAtom,
    gridGapAtom,
    previewColsAtom,
    sheetColsAtom,
    sheetRowsAtom,
    type TileMm,
    tileAtom,
} from "./settingsAtoms";
import { Scene3D } from "./Scene3D";

const DEBOUNCE_MS = 320;

function fontFamiliesFromStyle(style: FlapStyle): string[] {
    const raw = style.fontFamily;
    if (typeof raw !== "string") return [];
    return raw
        .split(",")
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
}

function parseFlapStyleJson(raw: string): { style: FlapStyle; error: string | null } {
    const t = raw.trim();
    if (t === "" || t === "{}") return { style: {}, error: null };
    try {
        const v = JSON.parse(t) as unknown;
        if (!v || typeof v !== "object" || Array.isArray(v)) {
            return { style: {}, error: "Root value must be a JSON object" };
        }
        const style: FlapStyle = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (typeof val === "string" || typeof val === "number") style[k] = val;
            else if (val === null || val === undefined) continue;
            else return { style: {}, error: `Property "${k}" must be a string or number` };
        }
        return { style, error: null };
    } catch (e) {
        return { style: {}, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
}

function charsFromInput(text: string): string[] {
    const normalized = text.trim() === "" ? " " : text.replace(/\n/g, " ");
    return [...normalized];
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

/** Let the browser paint `busy` state before heavy synchronous work on the main thread. */
function flushPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    });
}

function downloadTextFile(filename: string, body: string, mime: string): void {
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

type MeshBundle = {
    obj: string;
    mtl: string;
    stem: string;
    mtlFileName: string;
};

type NumFieldProps = {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (n: number) => void;
};

type SheetPagerProps = {
    index: number;
    total: number;
    busy: boolean;
    noun?: string;
    onChange: (next: number) => void;
};

function SheetPager({ index, total, busy, noun = "Sheet", onChange }: SheetPagerProps) {
    if (total < 1) return null;
    const canPrev = index > 0;
    const canNext = index < total - 1;
    return (
        <div class="flex flex-wrap items-center justify-center gap-3 py-1">
            <button
                type="button"
                class="btn btn-sm btn-square btn-outline"
                disabled={busy || !canPrev}
                aria-label={`Previous ${noun}`}
                onClick={() => onChange(index - 1)}
            >
                ‹
            </button>
            <span class="min-w-[7rem] text-center text-sm font-medium tabular-nums text-base-content/80">
                {noun} {index + 1} / {total}
            </span>
            <button
                type="button"
                class="btn btn-sm btn-square btn-outline"
                disabled={busy || !canNext}
                aria-label={`Next ${noun}`}
                onClick={() => onChange(index + 1)}
            >
                ›
            </button>
        </div>
    );
}

function NumField({ label, value, min, max, step, onChange }: NumFieldProps) {
    return (
        <div class="form-control w-full">
            <label class="label min-h-0 cursor-default py-0">
                <span class="label-text text-xs font-medium text-base-content/80">{label}</span>
            </label>
            <input
                type="number"
                class="input input-bordered input-sm w-full bg-base-100 font-mono text-sm"
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(value) ? value : min}
                onInput={(e) => {
                    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                    onChange(Number.isFinite(v) ? clamp(v, min, max) : min);
                }}
            />
        </div>
    );
}

export function App() {
    const [input, setInput] = useAtom(charsetAtom);
    const [tile, setTile] = useAtom(tileAtom);
    const [flapThickness, setFlapThickness] = useAtom(flapThicknessAtom);
    const [embossDepth, setEmbossDepth] = useAtom(embossDepthAtom);
    const [gridGap, setGridGap] = useAtom(gridGapAtom);
    const [autoPreviewCols, setAutoPreviewCols] = useAtom(autoPreviewColsAtom);
    const [previewCols, setPreviewCols] = useAtom(previewColsAtom);
    const [sheetCols, setSheetCols] = useAtom(sheetColsAtom);
    const [sheetRows, setSheetRows] = useAtom(sheetRowsAtom);
    const [flapStyleJson, setFlapStyleJson] = useAtom(flapStyleJsonAtom);
    const [styleDraftJson, setStyleDraftJson] = useState(flapStyleJson);
    const [styleDraftError, setStyleDraftError] = useState<string | null>(() => parseFlapStyleJson(flapStyleJson).error);
    const [geometryOpen, setGeometryOpen] = useAtom(geometrySectionOpenAtom);
    const [fontStyleOpen, setFontStyleOpen] = useAtom(fontStyleSectionOpenAtom);
    const [styleJsonError, setStyleJsonError] = useState<string | null>(null);

    const [busy2d, setBusy2d] = useState(false);
    const [busy3d, setBusy3d] = useState(false);
    const [err2d, setErr2d] = useState<string | null>(null);
    const [err3d, setErr3d] = useState<string | null>(null);
    const [previewSvg, setPreviewSvg] = useState("");
    const [sheets2d, setSheets2d] = useState<string[]>([]);
    const [prod2dIdx, setProd2dIdx] = useState(0);
    const [meshBundles, setMeshBundles] = useState<MeshBundle[] | null>(null);
    const [mesh3dIdx, setMesh3dIdx] = useState(0);
    const [sheetReady, setSheetReady] = useState(false);

    const sfRef = useRef<SplitFlap | null>(null);
    const gridRef = useRef<{ cols: number; rows: number; gap: number }>({ cols: 8, rows: 4, gap: 2 });
    const genRef = useRef(0);
    const mesh3dGuardRef = useRef(false);
    const hasStyleDraftChanges = styleDraftJson !== flapStyleJson;
    const canApplyStyleDraft = hasStyleDraftChanges && !styleDraftError;

    const onStyleDraftChange = useCallback((next: string) => {
        setStyleDraftJson(next);
        setStyleDraftError(parseFlapStyleJson(next).error);
    }, []);

    const applyStyleDraft = useCallback(() => {
        if (!canApplyStyleDraft) return;
        setFlapStyleJson(styleDraftJson);
    }, [canApplyStyleDraft, setFlapStyleJson, styleDraftJson]);

    const regenerate2d = useCallback(
        async (text: string, myGen: number) => {
            if (myGen !== genRef.current) return;
            setBusy2d(true);
            setErr2d(null);
            setErr3d(null);
            setStyleJsonError(null);
            setMeshBundles(null);
            setMesh3dIdx(0);
            setSheetReady(false);
            try {
                const chars = charsFromInput(text);
                const n = chars.length;

                const previewColsUse = autoPreviewCols
                    ? clamp(Math.ceil(Math.sqrt(n)), 1, 24)
                    : clamp(Math.round(previewCols), 1, 24);

                const sheetColsUse = clamp(Math.round(sheetCols), 1, 24);
                const sheetRowsUse = clamp(Math.round(sheetRows), 1, 24);

                const gapUse = clamp(gridGap, 0, 20);
                gridRef.current = { cols: sheetColsUse, rows: sheetRowsUse, gap: gapUse };

                const { style: jsonStyle, error: jsonErr } = parseFlapStyleJson(flapStyleJson);
                if (myGen !== genRef.current) return;
                setStyleJsonError(jsonErr);

                const mergedStyle: FlapStyle = { ...jsonStyle };

                const warmFonts = fontFamiliesFromStyle(mergedStyle);

                const sf = new SplitFlap();
                await sf.init(
                    {
                        ...tile,
                        flapThickness,
                        embossDepth,
                        ...(warmFonts.length > 0 ? { defaultFonts: warmFonts } : {}),
                        ...(import.meta.env.DEV && typeof window !== "undefined"
                            ? {
                                  googleFontsCssBaseUrl: new URL(
                                      "__split-flap-gfonts",
                                      `${window.location.origin}${import.meta.env.BASE_URL}`,
                                  ).href,
                              }
                            : {}),
                    },
                    {
                        locateFile: (file: string) => (file === "canvaskit.wasm" ? canvaskitWasmUrl : file),
                    },
                );

                for (const ch of chars) {
                    await sf.createFLAP({ textContent: ch, style: mergedStyle });
                }

                if (myGen !== genRef.current) return;

                sfRef.current = sf;
                setPreviewSvg(sf.generateFlapsPreview({ cols: previewColsUse, gap: gapUse }));
                const sheets = sf.generateProductionFlaps2D({ cols: sheetColsUse, rows: sheetRowsUse, gap: gapUse });
                setSheets2d(sheets);
                setProd2dIdx(0);
                setSheetReady(true);
            } catch (e) {
                if (myGen === genRef.current) {
                    sfRef.current = null;
                    setPreviewSvg("");
                    setSheets2d([]);
                    setProd2dIdx(0);
                    setSheetReady(false);
                    setErr2d(e instanceof Error ? e.message : String(e));
                }
            } finally {
                setBusy2d(false);
            }
        },
        [
            tile,
            flapThickness,
            embossDepth,
            gridGap,
            autoPreviewCols,
            previewCols,
            sheetCols,
            sheetRows,
            flapStyleJson,
        ],
    );

    useEffect(() => {
        setStyleDraftJson(flapStyleJson);
        setStyleDraftError(parseFlapStyleJson(flapStyleJson).error);
    }, [flapStyleJson]);

    useEffect(() => {
        const myGen = ++genRef.current;
        const t = window.setTimeout(() => {
            void regenerate2d(input, myGen);
        }, DEBOUNCE_MS);
        return () => window.clearTimeout(t);
    }, [input, regenerate2d]);

    const run3d = useCallback(async () => {
        if (mesh3dGuardRef.current || busy2d || !sheetReady) return;
        const sf = sfRef.current;
        if (!sf) {
            setErr3d("Wait for the 2D preview to finish.");
            return;
        }
        mesh3dGuardRef.current = true;
        setErr3d(null);
        setBusy3d(true);
        await flushPaint();
        try {
            const { cols, rows, gap } = gridRef.current;
            const meshes = sf.generateProductionFlaps3DGrid({
                gap,
                cols,
                rows,
                meshNamePrefix: "web",
            });
            const bundles: MeshBundle[] = [];
            for (const m of meshes) {
                if (!m?.obj) continue;
                bundles.push({
                    obj: m.obj,
                    mtl: m.mtl,
                    stem: m.meshFileStem,
                    mtlFileName: m.mtlFileName,
                });
            }
            if (bundles.length === 0) throw new Error("No mesh was produced.");
            setMeshBundles(bundles);
            setMesh3dIdx(0);
        } catch (e) {
            setMeshBundles(null);
            setErr3d(e instanceof Error ? e.message : String(e));
        } finally {
            mesh3dGuardRef.current = false;
            setBusy3d(false);
        }
    }, [busy2d, sheetReady]);

    const downloadPreviewSvg = useCallback(() => {
        if (!previewSvg) return;
        downloadTextFile("split-flap-preview.svg", previewSvg, "image/svg+xml");
    }, [previewSvg]);

    const downloadProductionSvgs = useCallback(async () => {
        for (let i = 0; i < sheets2d.length; i++) {
            downloadTextFile(`split-flap-production-${i}.svg`, sheets2d[i]!, "image/svg+xml");
            if (i < sheets2d.length - 1) await new Promise((r) => setTimeout(r, 280));
        }
    }, [sheets2d]);

    const downloadObjMtl = useCallback(async () => {
        const b = meshBundles?.[mesh3dIdx];
        if (!b?.obj) return;
        downloadTextFile(`${b.stem}.obj`, b.obj, "model/obj");
        const mtlBody = b.mtl?.trim();
        if (mtlBody.length > 0) {
            await new Promise((r) => setTimeout(r, 280));
            const name = b.mtlFileName || `${b.stem}.mtl`;
            downloadTextFile(name, b.mtl, "model/mtl");
        }
    }, [meshBundles, mesh3dIdx]);

    const sceneMesh = useMemo(() => {
        const b = meshBundles?.[mesh3dIdx];
        if (!b?.obj) return null;
        return { obj: b.obj, mtl: b.mtl };
    }, [meshBundles, mesh3dIdx]);

    const block3d = busy3d || busy2d || !sheetReady;

    const setTileField = (key: keyof TileMm, v: number) => {
        setTile((t: TileMm) => ({ ...t, [key]: v }));
    };

    return (
        <div class="min-h-screen bg-base-100 text-base-content">
            <div class="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10">
                <header class="flex flex-col gap-4">
                    <h1 class="text-3xl font-bold tracking-tight text-base-content md:text-4xl">
                        SPLIT FLAP GENERATOR
                    </h1>
                    <p class="intro">
                        From the{" "}
                        <a
                            href="https://www.npmjs.com/package/split-flap-generator"
                            class="link link-primary font-medium"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            split-flap-generator
                        </a>{" "}
                        package (
                        <a
                            href="https://github.com/piLeoni/split-flap-generator"
                            class="link link-primary font-medium"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            GitHub
                        </a>
                        ): This page is the web implementation of split-flap-generator, an open-source library for
                        millimetre-accurate split-flap geometry, CanvasKit + Satori rendering, and export to 2D
                        production SVG or optional OBJ/MTL meshes.
                    </p>
                </header>

                <details
                    class="preview-panel group"
                    open={geometryOpen}
                    onToggle={(e) => setGeometryOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                    <summary class="cursor-pointer text-sm font-bold uppercase tracking-widest text-base-content/80">
                        Geometry, grids & typography
                    </summary>
                    <div class="mt-4 flex flex-col gap-6 border-t border-base-300 pt-4">
                        <div>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">
                                Tile outline
                            </p>
                            <div class="settings-grid">
                                <NumField label="Width" value={tile.width} min={10} max={200} step={0.5} onChange={(v) => setTileField("width", v)} />
                                <NumField label="Height" value={tile.height} min={10} max={200} step={0.5} onChange={(v) => setTileField("height", v)} />
                                <NumField label="Corner radius" value={tile.flapCornerRadius} min={0} max={30} step={0.1} onChange={(v) => setTileField("flapCornerRadius", v)} />
                                <NumField label="Flaps gap" value={tile.flapsGap} min={0} max={20} step={0.1} onChange={(v) => setTileField("flapsGap", v)} />
                                <NumField label="Flange height" value={tile.flangeHeight} min={0} max={10} step={0.1} onChange={(v) => setTileField("flangeHeight", v)} />
                                <NumField label="Notch inset" value={tile.notchInset} min={0} max={40} step={0.1} onChange={(v) => setTileField("notchInset", v)} />
                                <NumField label="Notch inner height" value={tile.notchInnerHeight} min={0} max={80} step={0.1} onChange={(v) => setTileField("notchInnerHeight", v)} />
                            </div>
                        </div>
                        <div>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">
                                3D solid
                            </p>
                            <div class="settings-grid">
                                <NumField label="Flap thickness" value={flapThickness} min={0.1} max={5} step={0.05} onChange={setFlapThickness} />
                                <NumField label="Emboss depth" value={embossDepth} min={0} max={5} step={0.05} onChange={setEmbossDepth} />
                            </div>
                        </div>
                        <div>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/60">
                                Grids
                            </p>
                            <NumField label="Cell gap (preview + sheet)" value={gridGap} min={0} max={20} step={0.5} onChange={setGridGap} />
                            <div class="mt-3 flex flex-col gap-2">
                                <label class="label cursor-pointer justify-start gap-3 py-1">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm"
                                        checked={autoPreviewCols}
                                        onChange={(e) => setAutoPreviewCols((e.currentTarget as HTMLInputElement).checked)}
                                    />
                                    <span class="label-text text-sm">Auto preview columns (√charset)</span>
                                </label>
                                {!autoPreviewCols ? (
                                    <NumField label="Preview columns" value={previewCols} min={1} max={24} step={1} onChange={(v) => setPreviewCols(v)} />
                                ) : null}
                            </div>
                            <p class="mb-2 mt-3 text-xs text-base-content/60">
                                Production grid (2D sheets + 3D): at most{" "}
                                <strong class="text-base-content">{sheetCols * sheetRows}</strong> characters per sheet;
                                longer charsets add more sheets.
                            </p>
                            <div class="settings-grid">
                                <NumField
                                    label="Production columns"
                                    value={sheetCols}
                                    min={1}
                                    max={24}
                                    step={1}
                                    onChange={(v) => setSheetCols(v)}
                                />
                                <NumField
                                    label="Production rows"
                                    value={sheetRows}
                                    min={1}
                                    max={24}
                                    step={1}
                                    onChange={(v) => setSheetRows(v)}
                                />
                            </div>
                        </div>
                        <details
                            class="group mt-4 border-t border-base-300 pt-4"
                            open={fontStyleOpen}
                            onToggle={(e) => setFontStyleOpen((e.currentTarget as HTMLDetailsElement).open)}
                        >
                            <summary class="cursor-pointer text-sm font-semibold uppercase tracking-widest text-base-content/75">
                                Font and flap style (JSON)
                            </summary>
                            <div class="mt-3 flex flex-col gap-3">
                                <p class="text-xs leading-snug text-base-content/65">
                                    Put all text style values directly in JSON, including{" "}
                                    <code class="font-mono text-[0.7rem]">fontFamily</code> (Google Fonts family name).
                                    Changes apply only when you click Update.
                                </p>
                                <FlapStyleEditor value={styleDraftJson} onChange={onStyleDraftChange} />
                                <div class="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        class="btn btn-sm btn-primary"
                                        disabled={!canApplyStyleDraft}
                                        onClick={applyStyleDraft}
                                    >
                                        Update
                                    </button>
                                    {hasStyleDraftChanges ? (
                                        <span class="text-xs text-base-content/60">Unapplied changes</span>
                                    ) : null}
                                </div>
                                {styleDraftError ? (
                                    <p class="text-sm font-medium text-error" role="alert">
                                        {styleDraftError}
                                    </p>
                                ) : null}
                                {styleJsonError ? (
                                    <p class="text-sm font-medium text-error" role="alert">
                                        {styleJsonError}
                                    </p>
                                ) : null}
                            </div>
                        </details>
                    </div>
                </details>

                <section class="flex flex-col gap-3">
                    <div class="flex items-baseline justify-between gap-2">
                        <label class="label cursor-pointer py-0" for="flap-charset">
                            <span class="label-text font-medium text-base-content">Charset</span>
                        </label>
                        {busy2d ? (
                            <span class="badge badge-ghost text-xs uppercase">Updating…</span>
                        ) : null}
                    </div>
                    <textarea
                        id="flap-charset"
                        class="textarea textarea-bordered w-full min-h-[6rem] resize-y bg-base-200 font-mono text-base text-base-content placeholder:text-base-content/40"
                        maxlength={200}
                        value={input}
                        onInput={(e) => setInput((e.currentTarget as HTMLTextAreaElement).value)}
                        autocomplete="off"
                        spellcheck={false}
                        placeholder="Characters = flaps (default: classic A–Z / digits / punctuation)"
                    />
                    {err2d ? <p class="text-sm font-medium text-error">{err2d}</p> : null}
                </section>

                {previewSvg ? (
                    <section class="flex flex-col gap-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h2 class="text-xs font-bold uppercase tracking-widest text-base-content/70">Preview</h2>
                            <button
                                type="button"
                                class="btn btn-sm btn-outline"
                                disabled={busy2d}
                                onClick={downloadPreviewSvg}
                            >
                                Download preview SVG
                            </button>
                        </div>
                        <div
                            class="preview-panel preview-svg overflow-x-auto"
                            dangerouslySetInnerHTML={{ __html: previewSvg }}
                        />
                    </section>
                ) : null}

                {sheets2d.length > 0 ? (
                    <section class="flex flex-col gap-4">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h2 class="text-xs font-bold uppercase tracking-widest text-base-content/70">2D production</h2>
                            <button
                                type="button"
                                class="btn btn-sm btn-outline"
                                disabled={busy2d}
                                onClick={() => void downloadProductionSvgs()}
                            >
                                Download production SVG
                                {sheets2d.length > 1 ? `s (${sheets2d.length})` : ""}
                            </button>
                        </div>
                        <SheetPager
                            index={clamp(prod2dIdx, 0, sheets2d.length - 1)}
                            total={sheets2d.length}
                            busy={busy2d}
                            noun="Sheet"
                            onChange={setProd2dIdx}
                        />
                        <div
                            class="preview-panel preview-svg overflow-x-auto"
                            dangerouslySetInnerHTML={{
                                __html: sheets2d[clamp(prod2dIdx, 0, sheets2d.length - 1)] ?? "",
                            }}
                        />
                    </section>
                ) : null}

                <section class="flex flex-col gap-4 border-t-2 border-base-300 pt-6">
                    <h2 class="text-xs font-bold uppercase tracking-widest text-base-content/70">3D production</h2>
                    <p class="text-sm text-base-content/75">
                        Mesh generation runs on the main thread and can take a few seconds; the button shows a
                        spinner while OBJ/MTL for the selected sheet are built. Layout matches 2D production—one export
                        pair per sheet. Wait for it to finish before generating again.
                    </p>
                    <button
                        type="button"
                        class="btn btn-neutral btn-sm w-full sm:w-auto min-w-[12rem]"
                        disabled={block3d}
                        aria-busy={busy3d}
                        onClick={() => void run3d()}
                    >
                        {busy3d ? <span class="loading loading-spinner loading-sm" /> : null}
                        {busy3d ? "Generating…" : "Generate 3D mesh"}
                    </button>
                    {busy3d ? (
                        <div class="flex flex-col gap-3 rounded-box border border-base-300 bg-base-200/80 p-3" aria-busy="true">
                            <div class="flex items-center gap-2 text-sm text-base-content/80">
                                <span class="loading loading-spinner loading-sm text-neutral" />
                                <span>Computing mesh…</span>
                            </div>
                            <div class="web-indeterminate-bar" aria-hidden="true" />
                        </div>
                    ) : null}
                    {err3d ? <p class="text-sm font-medium text-error">{err3d}</p> : null}
                    {meshBundles && meshBundles.length > 0 ? (
                        <>
                            <SheetPager
                                index={clamp(mesh3dIdx, 0, meshBundles.length - 1)}
                                total={meshBundles.length}
                                busy={busy3d}
                                noun="Sheet"
                                onChange={setMesh3dIdx}
                            />
                            <button
                                type="button"
                                class="btn btn-sm btn-outline"
                                onClick={() => void downloadObjMtl()}
                            >
                                Download OBJ + MTL
                            </button>
                        </>
                    ) : null}
                    <Scene3D mesh={sceneMesh} />
                </section>
            </div>
        </div>
    );
}
