"use client";

import { useState } from "react";
import { FieldLabel } from "@/src/components/ui/field-help";
import { Input } from "@/src/components/ui/input";

export function InviteExpiryField() {
  const [value, setValue] = useState("");
  const timezoneOffset = value ? new Date(value).getTimezoneOffset() : 0;

  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor="expiresAt" helpTitle="Expiration" help="Optional. After this local date and time, new claims are rejected; already granted places remain recorded.">Expires at</FieldLabel>
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
