"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { Button } from "@/src/components/ui/button";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0"
      disabled={pending}
      aria-busy={pending}
      onClick={async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        try {
          const result = await authClient.signOut();
          if (result.error) throw new Error(result.error.message ?? "Unable to sign out.");
          router.push("/");
          router.refresh();
        } catch {
          toast.error("Unable to sign out. Please try again.");
          inFlight.current = false;
          setPending(false);
        }
      }}
    >
      <LogOut className="size-4" aria-hidden="true" />
      {compact ? <span className="sr-only">{pending ? "Signing out..." : "Sign out"}</span> : pending ? "Signing out..." : "Sign out"}
    </Button>
  );
}
