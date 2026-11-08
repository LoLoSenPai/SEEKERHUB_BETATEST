"use client";

import { useId, useRef, useState } from "react";
import { authClient } from "@/src/lib/auth-client";
import { getAuthReturnTo } from "@/src/lib/auth-navigation";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

export function AddAccountEmailForm({ returnTo }: { returnTo: string }) {
  const emailId = useId();
  const inFlight = useRef(false);
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (inFlight.current) return;
      const newEmail = submittedEmail ?? email.trim();
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await authClient.changeEmail({ newEmail, callbackURL: getAuthReturnTo({ returnTo }) });
        if (result.error) throw new Error(result.error.message ?? "Unable to send the verification link.");
        setSubmittedEmail(newEmail);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to contact the authentication service.");
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    }}>
      <div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Verify your email using the link we send. You keep the same account, linked wallet and existing access.</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">An email already used by another account cannot be added here. Accounts are not automatically merged. If you already have a verified email, confirm the change from that address first.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={emailId}>Account email</Label>
        <Input id={emailId} name="email" type="email" autoComplete="email" placeholder="you@example.com" required value={submittedEmail ?? email} onChange={(event) => setEmail(event.target.value)} readOnly={submittedEmail !== null} disabled={pending} />
      </div>
      <div aria-live="polite">
        {submittedEmail ? <p role="status" className="text-sm leading-6 text-muted-foreground">Check your inbox to verify {submittedEmail}. Your account email will not change until verification is complete. If no link arrives, the address may already belong to another account; try a different email.</p> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Sending link..." : submittedEmail ? "Resend verification link" : "Send verification link"}</Button>
      {submittedEmail ? <Button type="button" variant="ghost" disabled={pending} onClick={() => {
        setEmail(submittedEmail);
        setSubmittedEmail(null);
        setError(null);
      }}>Change email</Button> : null}
    </form>
  );
}
