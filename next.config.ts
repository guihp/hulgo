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

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // External/slow disk (/Volumes/HD): webpack can corrupt .next manifests
    // (e.g. routes-manifest.json filled with JS fragments → JSON.parse 500 on /login).
    // Recovery: npm run dev:clean  (or rm -rf .next && npm run dev)
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default withSerwist(nextConfig);
