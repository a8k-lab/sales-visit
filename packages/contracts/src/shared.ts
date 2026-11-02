import { z } from "zod";

// Opaque references: the persistence layer has not chosen an ID format yet.
export const identifierSchema = z.string().trim().min(1);

export const submissionChannelSchema = z.enum(["web", "telegram"]);
export type SubmissionChannel = z.infer<typeof submissionChannelSchema>;
