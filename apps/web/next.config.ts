import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@smartroute/shared'],
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
