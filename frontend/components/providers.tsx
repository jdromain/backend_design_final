"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false, // Prevent cascade on window focus
            retry: 1, // Reduce from 2 to 1 to fail faster
            retryDelay: 3000, // Add 3s delay between retries
            gcTime: 5 * 60 * 1000, // Garbage collect cache after 5 minutes
            networkMode: 'online', // Only fetch when online
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

