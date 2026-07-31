import Link from "next/link";
import { ForgotPasswordForm } from "@/src/components/auth/auth-utility-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";

export default function ForgotPasswordPage() {
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Builder security</div><CardTitle>Reset password</CardTitle><CardDescription>We send a short-lived reset link without revealing whether an account exists.</CardDescription></CardHeader><CardContent className="grid gap-5"><ForgotPasswordForm /><Link href="/sign-in?intent=builder" className="text-center text-sm font-semibold text-muted-foreground hover:text-foreground">Back to sign in</Link></CardContent></Card></main>;
}
