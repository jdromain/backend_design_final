import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    CLERK_ENABLED: process.env.CLERK_ENABLED ?? "",
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
