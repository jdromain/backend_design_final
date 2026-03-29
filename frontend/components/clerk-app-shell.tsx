"use client"

import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { useEffect, type ReactNode } from "react"
import { clearAuthToken, configureApiAuth } from "@/lib/api-client"

const jwtTemplate = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE ?? "platform-api"

function ClerkTokenBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) {
      configureApiAuth(() => getToken({ template: jwtTemplate }))
    } else {
      configureApiAuth(null)
      clearAuthToken()
    }
  }, [isLoaded, isSignedIn, getToken])

  return null
}

export function ClerkAppShell({
  children,
  publishableKey,
}: {
  children: ReactNode
  publishableKey: string
}) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  )
}
