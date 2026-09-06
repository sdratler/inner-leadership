import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
    ] }];
  },
};
export default config;
