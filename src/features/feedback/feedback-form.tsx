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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const { context, deviceProfileId, persistDeviceProfile } = useDeviceContext();

  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setLoading(true);
        setMessage(null);

        try {
          const formData = new FormData(form);
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
          setMessage({ type: "success", text: "Feedback sent to the builder. Thank you." });
          form.reset();
        } catch (error) {
          const text = error instanceof Error ? error.message : "Feedback submission failed.";
          setMessage({ type: "error", text });
          toast.error(text);
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
          <option value="LOW">Minor issue</option>
          <option value="MEDIUM">Affects use</option>
          <option value="HIGH">Major feature blocked</option>
          <option value="CRITICAL">App unusable or serious data loss</option>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" placeholder="What happened, and how can the builder reproduce it?" required />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Device information detected from your browser, such as operating system, browser, platform and device class, is attached to help the builder investigate. Avoid including passwords or other sensitive information in your report.</p>
      <div aria-live="polite">{message ? <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? "text-sm text-danger" : "text-sm text-foreground"}>{message.text}</p> : null}</div>
      <Button type="submit" disabled={loading}>
        {loading ? "Submitting..." : "Submit feedback"}
      </Button>
    </form>
  );
}
