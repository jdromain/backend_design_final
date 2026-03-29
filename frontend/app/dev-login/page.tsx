"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, APIError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function isDevLoginAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true";
}

export default function DevLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!isDevLoginAllowed()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Dev login unavailable</CardTitle>
            <CardDescription>
              JWT dev login is only available when running{" "}
              <code className="text-xs">next dev</code>, or when{" "}
              <code className="text-xs">NEXT_PUBLIC_ENABLE_DEV_LOGIN=true</code>{" "}
              is set for a controlled local demo.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await auth.login(email.trim());
      router.push("/");
      router.refresh();
    } catch (err) {
      if (err instanceof APIError) {
        setError(err.message || `Login failed (${err.status})`);
        return;
      }
      setError((err as Error).message || "Network error — is platform-api running?");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Dev login (JWT)</CardTitle>
          <CardDescription className="space-y-2">
            <span>
              Uses platform-api{" "}
              <code className="text-xs">POST /auth/login</code> with{" "}
              <code className="text-xs">CLERK_AUTH_ENABLED=false</code>. The API
              looks up <code className="text-xs">public.users</code> in Postgres (
              <code className="text-xs">status = active</code>).
            </span>
            <span className="block text-xs">
              Default seeded email:{" "}
              <strong className="font-medium text-foreground">admin@example.com</strong>{" "}
              (from <code className="text-xs">supabase/002_ui_tables.sql</code>, or first
              boot of <code className="text-xs">docker compose up postgres</code>). If login
              still fails, your DB may be empty or an old Docker volume — re-apply that SQL
              or recreate the volume.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-xs text-muted-foreground">
              API: {process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
