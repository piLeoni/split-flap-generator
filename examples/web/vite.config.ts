import path from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Satori reads `process.env.*` at runtime; shim the rest via `index.html`. */
const satoriEnvDefine = {
    "process.env.SATORI_STANDALONE": JSON.stringify("0"),
    "process.env.JEST_WORKER_ID": "undefined",
} as const;

/** GitHub Project Pages: `https://<user>.github.io/<repo>/` → set `VITE_BASE_PATH=/<repo>/` when building. */
function productionBase(): string {
    const raw = process.env.VITE_BASE_PATH?.trim();
    if (!raw || raw === "/") return "/";
    const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
    return withSlash.endsWith("/") ? withSlash : `${withSlash}/`;
}

export default defineConfig(({ command }) => ({
    base: command === "build" ? productionBase() : "/",
    plugins: [
        tailwindcss(),
        preact(),
    ],
    root: __dirname,
    resolve: {
        alias: {
            // Local dev: typecheck/build the library from `src/` without a prior `npm run build` at repo root.
            "split-flap-generator": path.resolve(__dirname, "../../src/index.ts"),
        },
    },
    define: satoriEnvDefine,
    server: {
        fs: {
            allow: [path.resolve(__dirname, "../..")],
        },
        /** Google Fonts CSS2 returns WOFF2 to browser `fetch`; proxy with a non-browser UA yields TTF URLs for Satori. */
        proxy: {
            "/__split-flap-gfonts": {
                target: "https://fonts.googleapis.com",
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/__split-flap-gfonts/, ""),
                configure: (proxy) => {
                    proxy.on("proxyReq", (proxyReq) => {
                        proxyReq.setHeader("User-Agent", "curl/8.0");
                    });
                },
            },
        },
    },
}));
