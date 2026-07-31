"use client";

import { useState } from "react";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

export function InviteExpiryField() {
  const [value, setValue] = useState("");
  const timezoneOffset = value ? new Date(value).getTimezoneOffset() : 0;

  return (
    <div className="grid gap-2">
      <Label htmlFor="expiresAt">Expires at</Label>
      <Input
        id="expiresAt"
        name="expiresAt"
        type="datetime-local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <input type="hidden" name="timezoneOffset" value={timezoneOffset} />
    </div>
  );
}
