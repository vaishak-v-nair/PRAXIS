import type { NextConfig } from "next";

function localBackendUrl(value = process.env.REGEN_BACKEND_URL || "http://127.0.0.1:9123") {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("REGEN_BACKEND_URL must be a valid local HTTP URL."); }
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!local.has(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("REGEN_BACKEND_URL must contain only a loopback HTTP origin, for example http://127.0.0.1:9123.");
  }
  return url.origin;
}

const backend = localBackendUrl();

const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: process.cwd() },
  experimental: { proxyClientMaxBodySize: '32mb' },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
export default config;
