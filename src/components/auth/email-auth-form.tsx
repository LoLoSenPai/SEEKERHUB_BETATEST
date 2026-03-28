"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

export function EmailAuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <Card className="w-full max-w-lg rounded-[2rem] border-border bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
      <CardHeader className="space-y-3">
        <div className="section-eyebrow">{mode === "sign-in" ? "Builder access" : "Create your workspace"}</div>
        <CardTitle className="text-3xl">{mode === "sign-in" ? "Sign in" : "Create account"}</CardTitle>
        <CardDescription>
          {mode === "sign-in"
            ? "Use your builder credentials to manage projects, releases, invites, and tester feedback."
            : "Create the builder account that owns projects, release uploads, and access policies."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const name = String(formData.get("name") ?? "");
            const email = String(formData.get("email") ?? "");
            const password = String(formData.get("password") ?? "");

            setLoading(true);
            setError(null);

            try {
              const result =
                mode === "sign-up"
                  ? await authClient.signUp.email({
                      name,
                      email,
                      password,
                      callbackURL: "/builder",
                    })
                  : await authClient.signIn.email({
                      email,
                      password,
                      callbackURL: "/builder",
                    });

              if (result.error) {
                setError(result.error.message ?? "Authentication failed.");
                return;
              }

              router.push("/builder");
              router.refresh();
            } catch (error) {
              setError(error instanceof Error ? error.message : "Unable to contact the authentication service.");
            } finally {
              setLoading(false);
            }
          }}
        >
          {mode === "sign-up" ? (
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" placeholder="Studio or builder name" required />
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="builder@studio.dev" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </div>
          {error ? (
            <div className="flex items-center gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="size-4" />
              {error}
            </div>
          ) : null}
          <Button type="submit" className="mt-2" disabled={loading}>
            {loading ? (mode === "sign-in" ? "Signing in..." : "Creating account...") : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            {mode === "sign-in" ? "No builder account yet? " : "Already have a builder account? "}
            <Link href={mode === "sign-in" ? "/sign-up" : "/sign-in"} className="font-medium text-foreground hover:underline">
              {mode === "sign-in" ? "Create one" : "Sign in"}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
