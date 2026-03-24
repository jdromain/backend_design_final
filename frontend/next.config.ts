import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript will be checked during build
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
