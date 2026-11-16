import type { z } from 'zod'

export class ApiError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string) {
    super(code)
    this.statusCode = statusCode
    this.code = code
  }
}

export function read<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiError(400, 'invalidInput')
  return parsed.data
}
