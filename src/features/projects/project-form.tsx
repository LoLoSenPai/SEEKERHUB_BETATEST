"use client";

import { startTransition, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { createProjectAction, updateProjectAction } from "./actions";

export function ProjectForm({ project }: {
  project?: { id: string; name: string; description: string | null };
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  return <form className="grid gap-5" aria-busy={busy} onChange={() => setSaved(false)} onSubmit={(event) => {
    event.preventDefault();
    if (inFlight.current) return;
    const data = new FormData(event.currentTarget);
    inFlight.current = true;
    setBusy(true); setError(""); setSaved(false);
    // Event submission preserves the entered values instead of resetting an action form.
    startTransition(async () => {
      try {
        if (project) {
          await updateProjectAction(data);
          setSaved(true);
          inFlight.current = false;
          setBusy(false);
        } else {
          const result = await createProjectAction(data);
          router.push(result.redirectTo);
        }
      } catch {
        setError("Unable to save your project. Check the details and try again.");
        inFlight.current = false;
        setBusy(false);
      }
    });
  }}>
    {project ? <input type="hidden" name="projectId" value={project.id} /> : null}
    <fieldset disabled={busy} className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="name">App name</Label>
        <Input id="name" name="name" defaultValue={project?.name ?? ""} placeholder="Seeker Notes" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" defaultValue={project?.description ?? ""} placeholder="What builders and testers should know about this project." />
      </div>
      <Button type="submit" disabled={busy}>{busy ? project ? "Saving project..." : "Creating project..." : project ? "Save project" : "Create project"}</Button>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <p role="status" className="text-sm text-muted-foreground">{saved ? "Project saved." : ""}</p>
  </form>;
}
