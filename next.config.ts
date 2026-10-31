import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/uploads/releases/*/finalize": [
      "./src/lib/apk-manifest-worker.cjs",
      "./node_modules/@devicefarmer/adbkit-apkreader/**/*",
      "./node_modules/yauzl/**/*",
      "./node_modules/buffer-crc32/**/*",
      "./node_modules/pend/**/*",
      "./node_modules/debug/**/*",
      "./node_modules/ms/**/*",
      "./node_modules/supports-color/**/*",
      "./node_modules/has-flag/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
