import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { safeReturnTo } from "@/src/lib/redirect";

export default async function MagicLinkSentPage({ searchParams }: { searchParams: Promise<{ email?: string; returnTo?: string }> }) {
  const { email, returnTo: target } = await searchParams;
  const returnTo = safeReturnTo(target, "/tester");
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Tester access</div><CardTitle>Check your email</CardTitle><CardDescription>Open the link sent to {email || "your email"} in this browser to preserve guest access. Check your spam folder if it does not arrive.</CardDescription></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">The link didn&apos;t arrive or the address is wrong? Return to sign in to resend it or enter a different email.</p><div className="flex flex-wrap gap-4 text-sm font-semibold"><Link href={`/sign-in?intent=tester&returnTo=${encodeURIComponent(returnTo)}`} className="text-foreground hover:underline">Resend or change email</Link><Link href={returnTo} className="text-foreground hover:underline">Return to testing</Link></div></CardContent></Card></main>;
}
