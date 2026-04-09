import { redirect } from "next/navigation";

/** Legacy path from main UI repo; canonical auth route is Clerk sign-in. */
export default function LoginRedirectPage() {
  redirect("/sign-in");
}
