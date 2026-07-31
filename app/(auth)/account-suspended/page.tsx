import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";

export default function AccountSuspendedPage() {
  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-lg"><CardHeader><div className="section-eyebrow">Builder access paused</div><CardTitle>This workspace is suspended</CardTitle><CardDescription>Publishing and builder administration are disabled. Existing tester access remains subject to each release policy.</CardDescription></CardHeader><CardContent><Link href="/abuse" className="text-sm font-semibold text-foreground hover:underline">Contact SeekerHub support</Link></CardContent></Card></main>;
}
