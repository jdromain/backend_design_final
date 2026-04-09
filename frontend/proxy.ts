import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { getClerkPublishableKey, isClerkConfigured } from "@/lib/clerk-runtime";

/**
 * Next.js 16+ network boundary — use `proxy.ts` + named `proxy` export
 * (replaces root `middleware.ts`). See:
 * https://nextjs.org/docs/messages/middleware-to-proxy
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
]);

function runClerkProxy(request: NextRequest, event: NextFetchEvent) {
  const publishableKey = getClerkPublishableKey();

  const middleware = clerkMiddleware(
    async (auth, req) => {
      if (!isPublicRoute(req)) {
        await auth.protect();
      }
    },
    { publishableKey }
  );

  return middleware(request, event);
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isClerkConfigured()) {
    if (isPublicRoute(request)) {
      return NextResponse.next();
    }
    const signInUrl = new URL("/sign-in?error=clerk_not_configured", request.url);
    return NextResponse.redirect(signInUrl);
  }
  return runClerkProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
