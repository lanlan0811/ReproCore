export const VERSION = "0.1.0" as const;

export const EXIT_CODES = {
  success: 0,
  executionFailure: 1,
  usage: 2,
  safetyBlocked: 3,
  unresolved: 4,
  flakyUnsupported: 5,
} as const;

export class SafetyBlockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SafetyBlockedError";
  }
}
