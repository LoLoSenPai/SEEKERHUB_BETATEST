import Link from "next/link";
import { VerificationResendForm } from "@/src/components/auth/auth-utility-form";
import { Card, CardContent, CardDescription, CardHeader } from "@/src/components/ui/card";
import { getAuthReturnTo } from "@/src/lib/auth-navigation";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; intent?: string; returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = getAuthReturnTo(params);
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Email verification</div><h1 className="text-2xl font-semibold">Check your inbox</h1><CardDescription>Open the verification link to confirm your account email. The link returns you to SeekerHub securely.</CardDescription></CardHeader><CardContent className="grid gap-5"><VerificationResendForm initialEmail={params.email} returnTo={returnTo} /><Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} className="text-center text-sm font-semibold text-muted-foreground hover:text-foreground">Back to sign in</Link></CardContent></Card></main>;
}
