import { z } from "zod";

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const verifyPasswordBodySchema = z.object({
  password: z.string().min(1),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type VerifyPasswordBody = z.infer<typeof verifyPasswordBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
