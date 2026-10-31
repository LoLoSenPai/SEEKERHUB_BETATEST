"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/src/components/ui/button";

export function InviteLinkCopyButton({ url, label = "Copy invite link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-1"><Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          setError(false);
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch { setError(true); }
        });
      }}
      aria-label={copied ? "Invite link copied" : label}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {isPending ? "Copying..." : copied ? "Copied" : "Copy link"}
    </Button>{error ? <p role="status" className="max-w-56 text-xs text-muted-foreground">Copy unavailable. Select the link text to copy it manually.</p> : null}</div>
  );
}
