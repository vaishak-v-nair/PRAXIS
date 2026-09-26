import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: process.cwd() },
  experimental: { proxyClientMaxBodySize: '32mb' },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.REGEN_BACKEND_URL || "http://127.0.0.1:9123"}/api/:path*` }];
  },
};
export default config;
