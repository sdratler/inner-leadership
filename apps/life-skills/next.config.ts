import type { NextConfig } from "next";
export function localBuildCacheOptions(env: {LS_LOCAL_BUILD_NO_DISK_CACHE?: string | undefined; CI?: string | undefined}): Pick<NextConfig, "webpack"> {
  if (env.LS_LOCAL_BUILD_NO_DISK_CACHE !== "true" || env.CI === "true") return {};
  return {webpack(webpackConfig) { webpackConfig.cache = false; return webpackConfig; }};
}
const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  // An explicit local build resource option, not a validation or runtime bypass.
  // Ordinary production/CI builds retain their existing cache configuration.
  ...localBuildCacheOptions({LS_LOCAL_BUILD_NO_DISK_CACHE: process.env.LS_LOCAL_BUILD_NO_DISK_CACHE, CI: process.env.CI}),
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
