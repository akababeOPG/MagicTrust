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
  async headers() {
    return [
      {
        source: "/admin/requests/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
