import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";

export default async function MagicLinkSentPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Tester access</div><CardTitle>Magic link sent</CardTitle><CardDescription>Open the link sent to {email || "your email"} on this browser to preserve the current guest access.</CardDescription></CardHeader><CardContent><Link href="/tester" className="text-sm font-semibold text-foreground hover:underline">Return to testing</Link></CardContent></Card></main>;
}
