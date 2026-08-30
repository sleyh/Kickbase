import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Player/manager photos - confirmed live, see web/src/lib/kickbase-image.ts.
    remotePatterns: [{ protocol: "https", hostname: "kickbase.b-cdn.net" }],
  },
};

export default nextConfig;
