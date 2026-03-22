/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/activity-log", destination: "/activity", permanent: true }
    ];
  }
};

module.exports = nextConfig;
