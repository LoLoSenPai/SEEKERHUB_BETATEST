"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/src/lib/session";
import { WORKSPACE_COOKIE } from "@/src/lib/workspace";
import { getServerEnv } from "@/src/lib/env";

export async function switchWorkspaceAction(formData: FormData) {
  const workspace = formData.get("workspace");
  if (workspace !== "publishing" && workspace !== "testing") redirect("/dashboard");
  const session = await requireSession();
  (await cookies()).set(WORKSPACE_COOKIE, `${workspace}:${session.user.id}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(getServerEnv().BETTER_AUTH_URL).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  redirect(workspace === "publishing" ? "/builder" : "/tester");
}
