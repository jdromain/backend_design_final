import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    CLERK_ENABLED: process.env.CLERK_ENABLED ?? "",
    NEXT_PUBLIC_CLERK_ENABLED: process.env.NEXT_PUBLIC_CLERK_ENABLED ?? process.env.CLERK_ENABLED ?? "",
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
