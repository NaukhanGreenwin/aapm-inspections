import type { NextConfig } from "next";

// Served at https://naukhangreenwin.github.io/aapm-inspections/ (GitHub Pages project site).
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/aapm-inspections",
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: "/aapm-inspections" },
  poweredByHeader: false,
};

export default nextConfig;
