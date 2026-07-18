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
        source: "/admin/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
      {
        source: "/admin/requests/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
        ],
      },
      {
        source: "/forms/:slug",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
