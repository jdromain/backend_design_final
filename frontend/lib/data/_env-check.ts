/**
 * Production safety guard for the mock data layer.
 * Import and call assertMockSafety() at the top of every lib/data/*.ts file.
 */
export function assertMockSafety(): void {
  if (
    process.env.NEXT_PUBLIC_USE_MOCKS === "true" &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "[data] NEXT_PUBLIC_USE_MOCKS=true must not be set in production builds. " +
        "Remove this env var before deploying.",
    )
  }
}
