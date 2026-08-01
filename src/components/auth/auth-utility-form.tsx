"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/src/lib/auth-client";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PasswordInput } from "@/src/components/ui/password-input";

export function VerificationResendForm({ initialEmail, returnTo }: { initialEmail?: string; returnTo: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      const email = String(new FormData(event.currentTarget).get("email") ?? "");
      setPending(true);
      const result = await authClient.sendVerificationEmail({ email, callbackURL: returnTo });
      setPending(false);
      if (result.error) toast.error(result.error.message ?? "Unable to send verification email.");
      else toast.success("Verification email sent.");
    }}>
      <Label htmlFor="verify-email">Email</Label>
      <Input id="verify-email" name="email" type="email" defaultValue={initialEmail} required />
      <Button disabled={pending}>{pending ? "Sending..." : "Resend verification email"}</Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  return sent ? <p className="text-sm leading-6 text-muted-foreground">If that account exists, a reset link has been sent.</p> : (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      const email = String(new FormData(event.currentTarget).get("email") ?? "");
      setPending(true);
      await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      setPending(false);
      setSent(true);
    }}>
      <Label htmlFor="reset-email">Builder email</Label>
      <Input id="reset-email" name="email" type="email" required />
      <Button disabled={pending}>{pending ? "Sending..." : "Send reset link"}</Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      const password = String(new FormData(event.currentTarget).get("password") ?? "");
      setPending(true);
      const result = await authClient.resetPassword({ newPassword: password, token });
      setPending(false);
      if (result.error) return toast.error(result.error.message ?? "Unable to reset password.");
      toast.success("Password updated.");
      router.push("/sign-in?intent=builder");
    }}>
      <Label htmlFor="new-password">New password</Label>
      <PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={8} required />
      <Button disabled={pending || !token}>{pending ? "Updating..." : "Update password"}</Button>
      {!token ? <p className="text-sm text-danger">This reset link is incomplete or expired.</p> : null}
    </form>
  );
}
