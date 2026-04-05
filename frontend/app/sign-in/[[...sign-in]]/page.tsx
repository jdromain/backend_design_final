import { SignIn } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { isClerkConfigured } from '@/lib/clerk-runtime'

export default function SignInPage() {
  if (!isClerkConfigured()) {
    redirect('/dev-login')
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignIn />
    </div>
  )
}



