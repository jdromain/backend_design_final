import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { isClerkFeatureOn } from "@/lib/clerk-runtime";

/**
 * Next.js 16+ network boundary — use `proxy.ts` + named `proxy` export
 * (replaces root `middleware.ts`). See:
 * https://nextjs.org/docs/messages/middleware-to-proxy
 *
 * Public routes must include JWT demo login so platform-api dev auth works
 * without a Clerk session.
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/login(.*)",
  "/api/webhooks(.*)",
  "/dev-login(.*)",
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  // JWT demo milestone: without Clerk keys, do not force sign-in — dashboard uses
  // bearer from /dev-login + platform-api dev auth.
  const clerkConfigured =
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) &&
    isClerkFeatureOn();
  if (!clerkConfigured) {
    return;
  }
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
