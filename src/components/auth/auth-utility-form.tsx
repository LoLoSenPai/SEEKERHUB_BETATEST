"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/src/lib/auth-client";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PasswordInput } from "@/src/components/ui/password-input";

export function VerificationResendForm({ initialEmail, returnTo }: { initialEmail?: string; returnTo: string }) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (inFlight.current) return;
      const email = String(new FormData(event.currentTarget).get("email") ?? "");
      inFlight.current = true;
      setPending(true);
      try {
        const result = await authClient.sendVerificationEmail({ email, callbackURL: returnTo });
        if (result.error) throw new Error(result.error.message ?? "Unable to send verification email.");
        toast.success("Verification email sent.");
      } catch {
        toast.error("Unable to send verification email. Please try again.");
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    }}>
      <Label htmlFor="verify-email">Email</Label>
      <Input id="verify-email" name="email" type="email" defaultValue={initialEmail} required />
      <Button disabled={pending}>{pending ? "Sending..." : "Resend verification email"}</Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const inFlight = useRef(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  return sent ? <p className="text-sm leading-6 text-muted-foreground">If that account exists, a reset link has been sent.</p> : (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (inFlight.current) return;
      const email = String(new FormData(event.currentTarget).get("email") ?? "");
      inFlight.current = true;
      setPending(true);
      try {
        const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (result.error) throw new Error("Unable to request a reset link.");
        setSent(true);
      } catch {
        toast.error("Unable to send reset link. Please try again.");
        inFlight.current = false;
        setPending(false);
      }
    }}>
      <Label htmlFor="reset-email">Builder email</Label>
      <Input id="reset-email" name="email" type="email" required />
      <Button disabled={pending}>{pending ? "Sending..." : "Send reset link"}</Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (inFlight.current) return;
      const password = String(new FormData(event.currentTarget).get("password") ?? "");
      inFlight.current = true;
      setPending(true);
      try {
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message ?? "Unable to reset password.");
        toast.success("Password updated.");
        router.push("/sign-in?intent=builder");
      } catch {
        toast.error("Unable to reset password. Please try again.");
        inFlight.current = false;
        setPending(false);
      }
    }}>
      <Label htmlFor="new-password">New password</Label>
      <PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={8} required disabled={pending} />
      <Button disabled={pending || !token}>{pending ? "Updating..." : "Update password"}</Button>
      {!token ? <p className="text-sm text-danger">This reset link is incomplete or expired.</p> : null}
    </form>
  );
}
