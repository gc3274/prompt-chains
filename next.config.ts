import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "scsqznvtzmixigdjudje.supabase.co";

const nextConfig: NextConfig = {
  // Keep next dev from writing its own docs files into the repo
  agentRules: false,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/avatars/**",
      },
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/images/**",
      },
      { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/a/**" },
      { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/a-/**" },
    ],
  },
  async headers() {
    // The admin area is never framed by another site
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
