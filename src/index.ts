export { SplitFlap } from "./core/SplitFlap.js";
export {
    DEFAULT_FLAP_FACE_CLASS,
    flapGridCellToStandaloneFaceSvg,
    renderFlapCellFaceInner,
    renderFlapCellSvgDocument,
    wrapFlapFaceInnerInSvgDocument,
    renderPaintedPathSegments,
    emitClippedContentPathElement,
    emitClippedContentPathElements,
    emitFlapMaskPath,
    emitWrappedContent,
    flapSvgClass,
    wrapWithClass,
} from "./core/flapCellSvg.js";
export type { FlapCellFaceInput, FlapCellFaceInnerInput } from "./core/flapCellSvg.js";
export { generateFlapSvgTemplate } from "./utils/generateFlapSvgTemplate.js";
export type { FlapSvgTemplateInput } from "./utils/generateFlapSvgTemplate.js";
export {
    resolveProductionGridLayout,
    productionGridSheetRowCount,
} from "./utils/productionGridLayout.js";
export type {
    ProductionGridLayout,
    ProductionGridSheetRange,
} from "./utils/productionGridLayout.js";
export {
    generateFlap3D,
    collectFlap3DFullMeshGeoms,
    deserializeFlapFaceLayers,
    FLAP_FACE_LAYER_ORDER,
    serializeFlap3DMeshParts,
} from "./utils/generateFlap3D.js";
export type {
    FlapFaceLayerGeoms,
    FlapFaceLayerKey,
    GenerateFlap3DInput,
    GenerateFlap3DOutput,
} from "./utils/generateFlap3D.js";
export {
    collectProductionFlaps3DCellParts,
    generateProductionFlaps3D,
    generateProductionFlaps3DFromCellParts,
    generateProductionFlaps3DGrid,
    generateProductionFlaps3DGridFromCellParts,
} from "./utils/generateProductionFlaps3D.js";
export type {
    GenerateProductionFlaps3DGridInput,
    GenerateProductionFlaps3DInput,
    ProductionFlaps3DGridLayoutInput,
} from "./utils/generateProductionFlaps3D.js";
export type {
    FlapContent,
    FlapContentInput,
    FlapImageGridCell,
    FlapStyle,
    FlapsOptions,
    FlapPathData,
    FlapProductionResult,
    ProductionFlap3d,
    FlapRenderResult,
    FontStyle,
    PaintedPathSegment,
    SatoriFontOption,
    SatoriFontWeight,
    TextFlapContent,
    HtmlFlapContent,
    SvgFlapContent,
    SatoriElementChild,
    SatoriElementNode,
} from "./core/types.js";