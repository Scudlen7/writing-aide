import fastifyStatic from '@fastify/static'
import { fromNodeHeaders } from 'better-auth/node'
import fastify from 'fastify'
import path from 'node:path'
import { auth } from './auth.ts'
import { chatRoutes } from './chat.ts'
import { config } from './config.ts'
import { debateRoutes } from './debate.ts'
import { discussionRoutes } from './discussions.ts'
import { documentRoutes } from './documents.ts'
import { ApiError } from './errors.ts'
import { managementRoutes } from './management.ts'
import { officeRoutes } from './office.ts'
import { peerRoutes } from './peer.ts'
import { personalWritingRoutes } from './personal-writing.ts'
import { settingsRoutes } from './settings.ts'
import { writingRoutes } from './writing.ts'

export function createApp(
  options: { logger?: boolean; serveFrontend?: boolean } = {}
) {
  const app = fastify({
    logger: options.logger
      ? {
          serializers: {
            req: (request) => ({
              method: request.method,
              url: request.url?.split('?')[0],
            }),
          },
        }
      : false,
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
    if (status >= 500) {
      if (
        /^\/api\/(documents|office|review-discussions|ai-debates)(?:\/|\?|$)/u.test(
          request.url
        )
      )
        request.log.error({ status }, 'Personal writing request failed')
      else request.log.error(error)
    }
    return reply
      .status(status)
      .send({ code: status >= 500 ? 'serverError' : 'invalidInput' })
  })

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !== config.APP_ORIGIN &&
      !(
        request.method === 'POST' &&
        /^\/api\/office\/callback\/[a-f0-9-]{36}$/u.test(request.url)
      )
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
  app.register(peerRoutes)
  app.register(chatRoutes)
  app.register(managementRoutes)
  app.register(settingsRoutes)
  app.register(documentRoutes)
  app.register(officeRoutes)
  app.register(personalWritingRoutes)
  app.register(discussionRoutes)
  app.register(debateRoutes)

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
