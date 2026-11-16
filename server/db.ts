import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from './config.ts'
import * as schema from './schema.ts'

export const pool = new Pool({ connectionString: config.DATABASE_URL })
export const db = drizzle(pool, { schema })
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
