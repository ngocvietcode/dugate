import fs from 'fs';
import path from 'path';

// Read version from package.json at build time
const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
  output: 'standalone',
  eslint: {
    // Skip the non-functional build-time ESLint pass (repo has no ESLint configured).
    // TypeScript type-checking during build is unaffected and still runs.
    ignoreDuringBuilds: true,
  },
  // Tăng body size limit cho upload file lớn (300MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '300mb',
    },
    // pdf-parse bundles pdfjs-dist which breaks when webpack re-bundles it in a
    // Next.js server route ("Object.defineProperty called on non-object").
    // Keeping these external makes the server require them natively (same as the
    // worker process), so the /api/margin-eval/render PDF preview works.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', 'sharp', 'pdf-lib'],
  },
};

export default nextConfig;
