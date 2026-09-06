import type { ProtocolProfile } from "@reprocore/format";

export const LEGACY_PROFILE: ProtocolProfile = {
  id: "legacy-2025-11-25",
  protocolVersion: "2025-11-25",
  lifecycle: "stateful",
  initializeRequired: true,
  discoveryMethod: "tools/list",
  loggingTransport: "mcp",
};

export const MODERN_PROFILE: ProtocolProfile = {
  id: "modern-2026-07-28",
  protocolVersion: "2026-07-28",
  lifecycle: "stateless",
  initializeRequired: false,
  discoveryMethod: "server/discover",
  loggingTransport: "stderr",
};

const PROFILES = new Map<string, ProtocolProfile>([
  [LEGACY_PROFILE.protocolVersion, LEGACY_PROFILE],
  [MODERN_PROFILE.protocolVersion, MODERN_PROFILE],
]);

export class UnsupportedProtocolVersionError extends Error {
  public constructor(version: string) {
    super(`Unsupported MCP protocol version: ${version}`);
    this.name = "UnsupportedProtocolVersionError";
  }
}

export function getProtocolProfile(version: string): ProtocolProfile {
  const profile = PROFILES.get(version);
  if (profile === undefined) throw new UnsupportedProtocolVersionError(version);
  return profile;
}

export function isSupportedProtocolVersion(version: string): boolean {
  return PROFILES.has(version);
}
