"use client";

import { Button } from "@/src/components/ui/button";

export default function DashboardError({ reset }: { reset: () => void }) {
  return <main className="page-shell min-h-screen items-center justify-center text-center"><h1 className="text-2xl font-bold">Your workspace could not open</h1><p className="text-muted-foreground">Your account is still here. Please try again.</p><Button onClick={reset}>Try again</Button></main>;
}
