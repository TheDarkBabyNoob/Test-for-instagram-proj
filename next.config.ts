import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating dev badge; it covers the model status in the sidebar.
  devIndicators: false,
  // Do not let `next dev` generate AGENTS.md in this repo.
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
