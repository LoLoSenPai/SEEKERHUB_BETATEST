"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/src/components/ui/button";

type PendingSubmitButtonProps = ButtonProps & {
  idleLabel: string;
  pendingLabel: string;
};

export function PendingSubmitButton({
  idleLabel,
  pendingLabel,
  disabled,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending} {...props}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
