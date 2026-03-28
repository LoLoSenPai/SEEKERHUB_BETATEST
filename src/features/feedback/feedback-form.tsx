"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { useDeviceContext } from "@/src/features/seeker/use-device-context";

export function FeedbackForm({ releaseId }: { releaseId: string }) {
  const [loading, setLoading] = useState(false);
  const { context, deviceProfileId, persistDeviceProfile } = useDeviceContext();

  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);

        try {
          const formData = new FormData(event.currentTarget);
          const persistedDeviceProfileId = await persistDeviceProfile();
          const response = await fetch("/api/feedback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              releaseId,
              title: formData.get("title"),
              description: formData.get("description"),
              severity: formData.get("severity"),
              deviceProfileId: persistedDeviceProfileId ?? deviceProfileId,
              deviceContext: context,
            }),
          });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload.error ?? "Unable to submit feedback.");
          }

          toast.success("Feedback sent.");
          event.currentTarget.reset();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Feedback submission failed.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" placeholder="Installation issue on Android 15" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="severity">Severity</Label>
        <Select id="severity" name="severity" defaultValue="MEDIUM">
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" placeholder="What happened, and how can the builder reproduce it?" required />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Submitting..." : "Submit feedback"}
      </Button>
    </form>
  );
}
