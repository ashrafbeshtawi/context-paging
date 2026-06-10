import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: webDir,
  experimental: {
    externalDir: true,
  },
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    config.resolve.modules = [
      path.resolve(webDir, "node_modules"),
      "node_modules",
    ];
    return config;
  },
};

export default nextConfig;
