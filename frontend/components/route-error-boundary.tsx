"use client"

import type React from "react"
import { usePathname } from "next/navigation"
import { ErrorBoundary } from "@/components/error-boundary"

export function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
}
