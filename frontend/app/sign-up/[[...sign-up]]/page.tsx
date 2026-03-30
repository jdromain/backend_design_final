import { SignUp } from '@clerk/nextjs'
import { redirect } from 'next/navigation'
import { isClerkFeatureOn } from '@/lib/clerk-runtime'

export default function SignUpPage() {
  if (!isClerkFeatureOn()) {
    redirect('/dev-login')
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SignUp />
    </div>
  )
}




