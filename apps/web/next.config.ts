import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@magictrust/config", "@magictrust/database"],
};

export default nextConfig;
