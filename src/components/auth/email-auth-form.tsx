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
import { PasswordInput } from "@/src/components/ui/password-input";

export function EmailAuthForm({
  mode,
  intent,
  returnTo,
}: {
  mode: "sign-in" | "sign-up";
  intent: "builder" | "tester";
  returnTo: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isTesterMagicLink = mode === "sign-in" && intent === "tester";
  const testerReturnTo = returnTo.startsWith("/tester") ? returnTo : "/tester";

  return (
    <Card className="w-full max-w-lg rounded-[2rem] border-border bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
      <CardHeader className="space-y-4">
        {mode === "sign-in" ? (
          <div className="grid grid-cols-2 rounded-full border border-border bg-muted p-1 text-sm font-semibold">
            <Link href={`/sign-in?intent=builder&returnTo=${encodeURIComponent("/builder")}`} className={`rounded-full px-3 py-2 text-center ${intent === "builder" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Builder</Link>
            <Link href={`/sign-in?intent=tester&returnTo=${encodeURIComponent(testerReturnTo)}`} className={`rounded-full px-3 py-2 text-center ${intent === "tester" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Tester</Link>
          </div>
        ) : null}
        <div className="section-eyebrow">{mode === "sign-up" ? "Create workspace" : intent === "builder" ? "Builder sign in" : "Recover tester access"}</div>
        <CardTitle className="text-3xl">{mode === "sign-up" ? "Create account" : isTesterMagicLink ? "Email me a sign-in link" : "Sign in"}</CardTitle>
        <CardDescription>
          {mode === "sign-up"
            ? "Email verification is required before the first project can be created."
            : isTesterMagicLink
              ? "No password required. Existing guest access is transferred when the link is opened."
              : "Use the verified credentials for your builder workspace."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const name = String(formData.get("name") ?? "");
            const email = String(formData.get("email") ?? "").trim();
            const password = String(formData.get("password") ?? "");
            setLoading(true);
            setError(null);

            try {
              if (isTesterMagicLink) {
                const result = await authClient.signIn.magicLink({
                  email,
                  callbackURL: returnTo,
                  newUserCallbackURL: returnTo,
                  errorCallbackURL: `/sign-in?intent=tester&returnTo=${encodeURIComponent(returnTo)}`,
                });
                if (result.error) throw new Error(result.error.message ?? "Unable to send the sign-in link.");
                router.push(`/magic-link-sent?email=${encodeURIComponent(email)}`);
                return;
              }

              const result =
                mode === "sign-up"
                  ? await authClient.signUp.email({ name, email, password, callbackURL: returnTo })
                  : await authClient.signIn.email({ email, password, callbackURL: returnTo });
              if (result.error) throw new Error(result.error.message ?? "Authentication failed.");

              if (mode === "sign-up") {
                router.push(`/verify-email?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`);
              } else {
                router.push(returnTo);
                router.refresh();
              }
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Unable to contact the authentication service.");
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
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
          </div>
          {!isTesterMagicLink ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password">Password</Label>
                {mode === "sign-in" ? <Link href="/forgot-password" className="text-xs font-semibold text-muted-foreground hover:text-foreground">Forgot password?</Link> : null}
              </div>
              <PasswordInput id="password" name="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required />
            </div>
          ) : null}
          <div aria-live="polite">
            {error ? (
              <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <AlertCircle className="size-4" />{error}
              </div>
            ) : null}
          </div>
          <Button type="submit" className="mt-2" disabled={loading}>
            {loading ? (isTesterMagicLink ? "Sending link..." : mode === "sign-in" ? "Signing in..." : "Creating account...") : isTesterMagicLink ? "Send magic link" : mode === "sign-in" ? "Sign in" : "Create builder account"}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
            {intent === "tester" ? (
              <Link href="/sign-in?intent=builder" className="font-medium text-foreground hover:underline">
                Switch to builder sign in
              </Link>
            ) : (
              <>
                {mode === "sign-in" ? "New builder? " : "Already have an account? "}
                <Link href={mode === "sign-in" ? "/sign-up?intent=builder" : "/sign-in?intent=builder"} className="font-medium text-foreground hover:underline">
                  {mode === "sign-in" ? "Create a workspace" : "Sign in"}
                </Link>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
