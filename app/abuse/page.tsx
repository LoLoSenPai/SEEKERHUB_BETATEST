import Link from "next/link";
import { getServerEnv } from "@/src/lib/env";

export default function AbusePage() {
  const contact = getServerEnv().EMAIL_REPLY_TO;
  return <main className="page-shell max-w-3xl"><div className="section-eyebrow">Safety</div><h1 className="text-4xl font-semibold">Report abuse</h1><p className="text-sm leading-7 text-muted-foreground">Do not install a build you do not trust. To report malicious content, include the invite URL, project name, release version, and a short description.</p>{contact ? <a href={`mailto:${contact}?subject=SeekerHub%20abuse%20report`} className="rounded-2xl border border-border bg-card p-4 text-sm font-semibold text-foreground">Email {contact}</a> : <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">Abuse contact is unavailable in this development environment.</p>}<Link href="/" className="font-semibold">Back to SeekerHub</Link></main>;
}
