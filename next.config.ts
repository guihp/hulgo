import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // External/slow disk: corrupted .next cache causes JSON.parse on stale blobs
    turbopackFileSystemCacheForDev: false,
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
