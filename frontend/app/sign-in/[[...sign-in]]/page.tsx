import { SignIn } from '@clerk/nextjs'
import { isClerkConfigured } from '@/lib/clerk-runtime'

export const dynamic = "force-dynamic"

export default function SignInPage() {
  if (!isClerkConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold">Clerk Configuration Required</h1>
          <p className="text-sm text-muted-foreground">
            Clerk-first auth is enabled. Configure Clerk publishable/secret keys to sign in.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignIn afterSignInUrl="/" signUpUrl="/sign-up" />
    </div>
  )
}

