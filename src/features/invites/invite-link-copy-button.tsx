"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/src/components/ui/button";

export function InviteLinkCopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        startTransition(async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        });
      }}
      aria-label={copied ? "Invite link copied" : "Copy invite link"}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {isPending ? "Copying..." : copied ? "Copied" : "Copy link"}
    </Button>
  );
}
