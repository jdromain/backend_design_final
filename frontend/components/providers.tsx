"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { ClerkTokenBridge } from "@/components/clerk-token-bridge";
import { AppProvider } from "@/lib/store";
import { Toaster } from "@/components/ui/toaster";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
            retryDelay: 3000,
            gcTime: 5 * 60 * 1000,
            networkMode: "online",
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <ClerkTokenBridge />
        <AppProvider>
          {children}
          <Toaster />
        </AppProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
