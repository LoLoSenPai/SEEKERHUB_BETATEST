import { ResetPasswordForm } from "@/src/components/auth/auth-utility-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Builder security</div><CardTitle>Choose a new password</CardTitle><CardDescription>Use at least eight characters and avoid reusing a password from another service.</CardDescription></CardHeader><CardContent><ResetPasswordForm token={token} /></CardContent></Card></main>;
}
