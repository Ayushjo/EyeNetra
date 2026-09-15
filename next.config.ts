import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MediaPipe WASM + Google-hosted .task model
  async headers() {
    return [
      {
        source: "/mediapipe/wasm/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
