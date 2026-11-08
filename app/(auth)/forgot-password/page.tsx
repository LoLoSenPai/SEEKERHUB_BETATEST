import Link from "next/link";
import { ForgotPasswordForm } from "@/src/components/auth/auth-utility-form";
import { Card, CardContent, CardDescription, CardHeader } from "@/src/components/ui/card";
import { getAuthReturnTo } from "@/src/lib/auth-navigation";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ intent?: string; returnTo?: string }> }) {
  const returnTo = getAuthReturnTo(await searchParams);
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Account security</div><h1 className="text-2xl font-semibold">Reset password</h1><CardDescription>We send a short-lived reset link without revealing whether an account exists.</CardDescription></CardHeader><CardContent className="grid gap-5"><ForgotPasswordForm returnTo={returnTo} /><Link href={`/sign-in?method=password&returnTo=${encodeURIComponent(returnTo)}`} className="text-center text-sm font-semibold text-muted-foreground hover:text-foreground">Back to sign in</Link></CardContent></Card></main>;
}
