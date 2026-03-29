import { redirect } from "next/navigation";

/** Legacy path from main UI repo; merged app uses `/dev-login` for JWT demo. */
export default function LoginRedirectPage() {
  redirect("/dev-login");
}
