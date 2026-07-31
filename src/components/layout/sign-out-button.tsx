"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/src/lib/auth-client";
import { Button } from "@/src/components/ui/button";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden="true" />
      {compact ? <span className="sr-only">Sign out</span> : "Sign out"}
    </Button>
  );
}
