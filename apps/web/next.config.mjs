import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle Size Budget spec (<2MB): keep transpilePackages minimal, no
  // heavyweight UI libs added in this MVP structural pass.
  transpilePackages: ["@hexarena/shared"],
};

export default withBundleAnalyzer(nextConfig);
