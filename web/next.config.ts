import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    // Keep build artifacts separate from the running local preview.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-local" : ".next",
    turbopack: { root: process.cwd() },
  };
}
