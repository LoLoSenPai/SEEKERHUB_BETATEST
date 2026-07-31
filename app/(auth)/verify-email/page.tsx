import Link from "next/link";
import { VerificationResendForm } from "@/src/components/auth/auth-utility-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { safeReturnTo } from "@/src/lib/redirect";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo, "/builder/onboarding");
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Email verification</div><CardTitle>Check your inbox</CardTitle><CardDescription>Open the verification link before creating a builder workspace. The link returns you to SeekerHub securely.</CardDescription></CardHeader><CardContent className="grid gap-5"><VerificationResendForm initialEmail={params.email} returnTo={returnTo} /><Link href="/sign-in?intent=builder" className="text-center text-sm font-semibold text-muted-foreground hover:text-foreground">Back to sign in</Link></CardContent></Card></main>;
}
