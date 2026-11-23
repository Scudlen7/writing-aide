import { z } from 'zod'

export const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    APP_ORIGIN: z
      .url()
      .default('http://localhost:5173')
      .transform((url) => new URL(url).origin),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    AI_BASE_URL: z.url().optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).optional(),
    DOCUMENT_STORAGE: z.string().min(1).default('document-storage'),
    DOCUMENT_FILE_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(100 * 1024 * 1024)
      .default(25 * 1024 * 1024),
    DOCUMENT_ACCOUNT_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(1024 * 1024 * 1024),
    DOCUMENT_INVITE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    OFFICE_URL: z.url().optional(),
    OFFICE_APP_URL: z.url().optional(),
    OFFICE_SECRET: z.string().min(32).optional(),
  })
  .parse(process.env)
