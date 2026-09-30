import type { NextConfig } from "next";

const isCloudflare =
  process.env._OPENNEXT === "1" || process.env.BACKEND === "cloudflare";

const nextConfig: NextConfig = {
  ...(isCloudflare ? {} : { output: "standalone" as const }),
  serverExternalPackages: isCloudflare ? [] : ["better-sqlite3", "ali-oss"],
  turbopack: isCloudflare
    ? {
        resolveAlias: {
          "ali-oss": { browser: "./lib/stubs/empty.js", default: "./lib/stubs/empty.js" },
          "better-sqlite3": { browser: "./lib/stubs/empty.js", default: "./lib/stubs/empty.js" },
        },
      }
    : {},
  webpack: (config) => {
    if (isCloudflare) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "ali-oss": false,
        "better-sqlite3": false,
      };
    }
    return config;
  },
};

export default nextConfig;
