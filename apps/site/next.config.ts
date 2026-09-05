import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@wx-layout/ai-layout", "@wx-layout/core"]
};

export default nextConfig;
