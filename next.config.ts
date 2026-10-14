import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Exige webpack (`next build --webpack` / `next dev --webpack`).
  disable: false,
  reloadOnOnline: true,
  // Shell mínimo — não precachear todos os PDFs/templates de public/
  globPublicPatterns: ["icon-*.png", "FB.png"],
});

// Muda a cada build; o VersionWatcher compara com /api/health para avisar
// abas abertas antes de um deploy (Server Actions do build antigo deixam de existir).
const buildId = process.env.SOURCE_COMMIT || `${Date.now()}`;

const nextConfig: NextConfig = {
  output: "standalone",
  // libheif (wasm) e unpdf (import.meta) não empacotam bem no webpack; rodam direto do node_modules.
  serverExternalPackages: ["heic-convert", "unpdf"],
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  experimental: {
    // External/slow disk (/Volumes/HD): webpack can corrupt .next manifests
    // (e.g. routes-manifest.json filled with JS fragments → JSON.parse 500 on /login).
    // Recovery: npm run dev:clean  (or rm -rf .next && npm run dev)
    turbopackFileSystemCacheForDev: false,
    // Anexos vão em base64 nas Server Actions (+~37%): 25 MB de arquivo ≈ 34 MB de corpo.
    // O proxy.ts bufferiza o corpo e, acima do limite (padrão 10 MB), TRUNCA em silêncio —
    // a action quebra com "Unterminated string in JSON" (digest genérico em produção).
    proxyClientMaxBodySize: "40mb",
    serverActions: {
      bodySizeLimit: "40mb",
    },
  },
};

export default withSerwist(nextConfig);
