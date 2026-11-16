import fastifyStatic from '@fastify/static'
import { fromNodeHeaders } from 'better-auth/node'
import fastify from 'fastify'
import path from 'node:path'
import { auth } from './auth.ts'
import { config } from './config.ts'
import { ApiError } from './errors.ts'
import { writingRoutes } from './writing.ts'

export function createApp(
  options: { logger?: boolean; serveFrontend?: boolean } = {}
) {
  const app = fastify({
    logger: options.logger ?? false,
    trustProxy: 'loopback',
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError)
      return reply.status(error.statusCode).send({ code: error.code })
    const status =
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500
    if (status >= 500) request.log.error(error)
    return reply
      .status(status)
      .send({ code: status >= 500 ? 'serverError' : 'invalidInput' })
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== config.APP_ORIGIN
    ) {
      throw new ApiError(403, 'forbidden')
    }
  })

  app.get('/api/health', async () => ({ ok: true }))

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const endpoint = new URL(request.url, config.APP_ORIGIN)
      const headers = fromNodeHeaders(request.headers)
      headers.set('x-writing-client-ip', request.ip)
      const authResponse = await auth.handler(
        new Request(endpoint, {
          method: request.method,
          headers,
          body:
            request.method === 'POST' && request.body !== undefined
              ? JSON.stringify(request.body)
              : undefined,
        })
      )
      reply.status(authResponse.status)
      authResponse.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value)
      })
      const cookies = authResponse.headers.getSetCookie()
      if (cookies.length) reply.header('set-cookie', cookies)
      return reply.send(authResponse.body ? await authResponse.text() : null)
    },
  })

  app.register(writingRoutes)

  if (options.serveFrontend) {
    app.register(fastifyStatic, { root: path.resolve('dist'), wildcard: false })
  }
  app.setNotFoundHandler((request, reply) => {
    if (
      options.serveFrontend &&
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      request.headers.accept?.includes('text/html')
    ) {
      return reply.sendFile('index.html', { maxAge: 0, immutable: false })
    }
    return reply.code(404).send({ code: 'notFound' })
  })
  return app
}
