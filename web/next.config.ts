import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Player/manager photos (png/jpe) and team crests (svg) - confirmed
    // live, see web/src/lib/kickbase-image.ts. Next.js blocks SVG
    // optimization by default (a remote SVG could carry an embedded
    // script) - dangerouslyAllowSVG opts back in, paired with the CSP
    // Next's own docs recommend for exactly this case so the optimizer's
    // proxy response can't execute a script even if the source SVG ever
    // did carry one.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [{ protocol: "https", hostname: "kickbase.b-cdn.net" }],
  },
};

export default nextConfig;
