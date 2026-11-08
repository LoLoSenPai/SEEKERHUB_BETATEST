import { ResetPasswordForm } from "@/src/components/auth/auth-utility-form";
import { Card, CardContent, CardDescription, CardHeader } from "@/src/components/ui/card";
import { getAuthReturnTo } from "@/src/lib/auth-navigation";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; intent?: string; returnTo?: string }> }) {
  const params = await searchParams;
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Account security</div><h1 className="text-2xl font-semibold">Choose a new password</h1><CardDescription>Use at least eight characters and avoid reusing a password from another service.</CardDescription></CardHeader><CardContent><ResetPasswordForm token={params.token} returnTo={getAuthReturnTo(params)} /></CardContent></Card></main>;
}
