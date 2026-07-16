import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@magictrust/config",
    "@magictrust/database",
    "@magictrust/domain",
    "@magictrust/email",
    "@magictrust/privacy",
    "@magictrust/storage",
  ],
};

export default nextConfig;
