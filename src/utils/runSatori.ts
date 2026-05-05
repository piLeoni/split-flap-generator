import satori from "satori";

/**
 * Hand-rolled `{ type, props }` trees are valid Satori input; when `@types/react` is installed, `satori()`’s
 * first parameter is typed as `ReactNode` only, so we cast at this single boundary.
 */
export function runSatori(
    element: unknown,
    options: Parameters<typeof satori>[1],
): ReturnType<typeof satori> {
    return satori(element as never, options);
}
