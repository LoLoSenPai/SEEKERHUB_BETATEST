"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { getAuthReturnTo, getEmailAuthMethod, type EmailAuthMethod } from "@/src/lib/auth-navigation";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PasswordInput } from "@/src/components/ui/password-input";

export function EmailAuthForm({
  mode,
  returnTo: requestedReturnTo,
  defaultMethod,
}: {
  mode: "sign-in" | "sign-up";
  intent?: "builder" | "tester";
  returnTo: string;
  defaultMethod?: EmailAuthMethod;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState(() => getEmailAuthMethod(mode, defaultMethod));
  const isMagicLink = mode === "sign-in" && method === "magic";
  const returnTo = getAuthReturnTo({ returnTo: requestedReturnTo });

  return (
    <Card className="w-full max-w-lg rounded-[2rem] border-border bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
      <CardHeader className="space-y-4">
        <div className="section-eyebrow">{mode === "sign-up" ? "Your SeekerHub account" : "Continue with email"}</div>
        <CardTitle className="text-2xl">{mode === "sign-up" ? "Create account" : isMagicLink ? "Email me a sign-in link" : "Sign in with password"}</CardTitle>
        <CardDescription>
          {mode === "sign-up"
            ? "Use your name, email and a password. Verify your email to finish setting up your account."
            : isMagicLink
              ? "No password needed. Sign in or create an account with a secure email link. Open it in this browser to keep your guest access."
              : "For existing accounts with a password. Use the email already linked to your account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (inFlight.current) return;
            inFlight.current = true;
            const formData = new FormData(event.currentTarget);
            const name = String(formData.get("name") ?? "");
            const email = String(formData.get("email") ?? "").trim();
            const password = String(formData.get("password") ?? "");
            setLoading(true);
            setError(null);

            try {
              if (isMagicLink) {
                const result = await authClient.signIn.magicLink({
                  email,
                  callbackURL: returnTo,
                  newUserCallbackURL: returnTo,
                  errorCallbackURL: `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
                });
                if (result.error) throw new Error(result.error.message ?? "Unable to send the sign-in link.");
                router.push(`/magic-link-sent?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`);
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
              }
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Unable to contact the authentication service.");
              inFlight.current = false;
              setLoading(false);
            }
          }}
        >
          {mode === "sign-up" ? (
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" placeholder="Your name" required disabled={loading} />
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required disabled={loading} />
          </div>
          {!isMagicLink ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password">Password</Label>
                {mode === "sign-in" ? <Link href={`/forgot-password?returnTo=${encodeURIComponent(returnTo)}`} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Forgot password?</Link> : null}
              </div>
              <PasswordInput id="password" name="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required disabled={loading} />
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
            {loading ? (isMagicLink ? "Sending link..." : mode === "sign-in" ? "Signing in..." : "Creating account...") : isMagicLink ? "Send magic link" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
          {mode === "sign-in" ? (
            <Button type="button" variant="ghost" disabled={loading} onClick={() => {
              setMethod(isMagicLink ? "password" : "magic");
              setError(null);
            }}>
              {isMagicLink ? "Use a password instead" : "Use an email link instead"}
            </Button>
          ) : null}
          <div className="text-center text-sm text-muted-foreground">
            {mode === "sign-in" ? "Prefer email and password? " : "Already have an account? "}
            <Link href={`${mode === "sign-in" ? "/sign-up" : "/sign-in"}?returnTo=${encodeURIComponent(returnTo)}`} className="font-medium text-foreground hover:underline">
              {mode === "sign-in" ? "Create account" : "Sign in"}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
