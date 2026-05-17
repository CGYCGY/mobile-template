import * as z from 'zod';

export const profileFormSchema = z.object({
  displayName: z.string().trim().min(1, 'Required').max(80),
  bio: z.string().trim().max(500).optional().default(''),
});

export type ProfileFormInput = z.input<typeof profileFormSchema>;
export type ProfileFormValues = z.output<typeof profileFormSchema>;
