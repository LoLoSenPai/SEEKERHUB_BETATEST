import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader } from "@/src/components/ui/card";
import { getAuthReturnTo } from "@/src/lib/auth-navigation";

export default async function MagicLinkSentPage({ searchParams }: { searchParams: Promise<{ email?: string; intent?: string; returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = getAuthReturnTo(params);
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Account access</div><h1 className="text-2xl font-semibold">Check your email</h1><CardDescription>Open the link sent to {params.email || "your email"} in this browser to preserve guest access. Check your spam folder if it does not arrive.</CardDescription></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">The link didn&apos;t arrive or the address is wrong? Return to sign in to resend it or enter a different email.</p><div className="flex flex-wrap gap-4 text-sm font-semibold"><Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} className="text-foreground hover:underline">Resend or change email</Link><Link href={returnTo} className="text-foreground hover:underline">Continue to SeekerHub</Link></div></CardContent></Card></main>;
}
