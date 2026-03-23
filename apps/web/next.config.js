/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Render の Free プラン（512MB）で Lint/型チェックがメモリ不足で止まる対策
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    return [
      { source: "/activity-log", destination: "/activity", permanent: true }
    ];
  }
};

module.exports = nextConfig;
