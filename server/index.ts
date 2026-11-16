import { createApp } from './app.ts'
import { config } from './config.ts'
import { pool } from './db.ts'

const app = createApp({
  logger: true,
  serveFrontend: process.env.NODE_ENV === 'production',
})
app.addHook('onClose', () => pool.end())

try {
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
  await app.close()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close())
}
