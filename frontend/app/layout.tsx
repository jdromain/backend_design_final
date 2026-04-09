import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/components/providers";
import {
  clerkExplicitlyEnabled,
  getClerkPublishableKey,
  isClerkConfigured,
} from "@/lib/clerk-runtime";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rezovo - Voice AI Platform",
  description: "AI-powered voice platform for intelligent call handling",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clerkEnabled = clerkExplicitlyEnabled();
  const clerkConfigured = isClerkConfigured();
  const clerkPublishableKey = getClerkPublishableKey();

  const shell = (
    <html
      lang="en"
      suppressHydrationWarning
      data-clerk-enabled={clerkEnabled ? "true" : "false"}
      data-clerk-configured={clerkConfigured ? "true" : "false"}
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );

  if (clerkConfigured) {
    return (
      <ClerkProvider
        publishableKey={clerkPublishableKey}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        afterSignInUrl="/"
        afterSignUpUrl="/"
      >
        {shell}
      </ClerkProvider>
    );
  }

  return shell;
}
