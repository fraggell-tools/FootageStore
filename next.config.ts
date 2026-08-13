import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
  headers: async () => [
    {
      // Prevent Cloudflare from caching the installer scripts so updates
      // are always picked up immediately.
      source: "/(install-panel.ps1|install-panel.sh|install-panel.bat)",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
  ],
};

export default nextConfig;
