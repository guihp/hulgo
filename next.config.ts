import type { NextConfig } from "next";

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

export default nextConfig;
