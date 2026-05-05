import type { CanvasKit, Path } from "canvaskit-wasm";

export function svgMatrixTransformToCk3x3(transform: string | undefined): number[] | null {
    if (!transform?.trim()) return null;
    const match = /matrix\s*\(\s*([^)]+)\)/i.exec(transform);
    if (!match) return null;
    const parts = match[1]
        .split(/[,\s]+/)
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !Number.isNaN(n));
    if (parts.length !== 6) return null;
    const [a, b, c, d, e, f] = parts;
    return [a, c, e, b, d, f, 0, 0, 1];
}

function applyCkMatrix(x: number, y: number, m: number[]): { x: number; y: number } {
    const a = m[0];
    const c = m[1];
    const e = m[2];
    const b = m[3];
    const d = m[4];
    const f = m[5];
    return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** Stroke caps expanded to a closed path so CanvasKit can intersect it with the flap mask (Satori underlines use `<line>`). */
export function pathFromCheerioSvgLineElement(
    CK: CanvasKit,
    el: { attribs: Record<string, string | undefined> },
): Path | null {
    const x1 = parseFloat(el.attribs.x1 ?? "0");
    const y1 = parseFloat(el.attribs.y1 ?? "0");
    const x2 = parseFloat(el.attribs.x2 ?? "0");
    const y2 = parseFloat(el.attribs.y2 ?? "0");
    const sw = parseFloat(el.attribs["stroke-width"] ?? el.attribs.strokeWidth ?? "1");
    let p1 = { x: x1, y: y1 };
    let p2 = { x: x2, y: y2 };
    const m = svgMatrixTransformToCk3x3(el.attribs.transform);
    if (m) {
        p1 = applyCkMatrix(p1.x, p1.y, m);
        p2 = applyCkMatrix(p2.x, p2.y, m);
    }
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    const half = Math.max(sw, 0) / 2;
    const px = (-dy / len) * half;
    const py = (dx / len) * half;
    const d = [
        `M ${p1.x + px} ${p1.y + py}`,
        `L ${p2.x + px} ${p2.y + py}`,
        `L ${p2.x - px} ${p2.y - py}`,
        `L ${p1.x - px} ${p1.y - py}`,
        `Z`,
    ].join(" ");
    return CK.Path.MakeFromSVGString(d);
}

export type CheerioSvgPathElement = { attribs: { d?: string; transform?: string } } | undefined;

export function pathFromCheerioSvgPathElement(CK: CanvasKit, el: CheerioSvgPathElement): Path | null {
    const d = el?.attribs?.d;
    if (!d) return null;

    const local = CK.Path.MakeFromSVGString(d);
    if (!local) return null;

    const m = svgMatrixTransformToCk3x3(el.attribs.transform);
    if (!m) return local;

    const pb = new CK.PathBuilder();
    pb.addPath(local, m);
    const out = pb.snapshot();
    local.delete();
    return out;
}
