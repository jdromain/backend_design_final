import { redirect } from "next/navigation";

/**
 * Legacy dev-only route retained for compatibility with old links/bookmarks.
 * Auth is Clerk-first now, so this route forwards to Clerk sign-in.
 */
export default function DevLoginPage() {
  redirect("/sign-in");
}
