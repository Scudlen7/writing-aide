import { z } from 'zod'
import { languageSchema, workSchema } from './writing.ts'

export const personalWriting = z.object({
  language: languageSchema,
  work: workSchema,
})
export type PersonalWriting = z.infer<typeof personalWriting>
