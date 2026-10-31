import { z } from "zod";
import { accessPolicyInputSchema } from "@/src/lib/validation";

export const publishReleaseInputSchema = z.object({
  changelog: z.string().trim().min(1, "Add release notes before publishing.").max(8_000),
  accessPolicy: accessPolicyInputSchema,
  invitation: z.object({
    scope: z.enum(["release", "project"]).default("release"),
    maxUses: z.number().int().min(1).max(10_000).nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
  }),
}).superRefine((input, ctx) => {
  if (!input.accessPolicy.requireInviteAcceptance && !input.accessPolicy.walletAllowlist.length) {
    ctx.addIssue({ code: "custom", path: ["accessPolicy", "walletAllowlist"], message: "Choose an invite link or add at least one allowed wallet." });
  }
});

export type PublishReleaseInput = z.infer<typeof publishReleaseInputSchema>;
