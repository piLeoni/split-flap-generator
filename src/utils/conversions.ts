export const mm2px = (v: number): number => (v * 96) / 25.4;

/** One display wing, mm: `(moduleHeight - gap) / 2`, same as `createFlapClipOutlinePath` flap height. */
export const flapWingHeightMm = (o: { height: number; flapsGap: number }): number =>
    o.height / 2 - o.flapsGap / 2;

export const flapWingHeightPx = (o: { height: number; flapsGap: number }): number =>
    mm2px(flapWingHeightMm(o));
