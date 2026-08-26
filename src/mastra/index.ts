import { Mastra } from '@mastra/core'
import { SimpleAuth } from '@mastra/core/server'
import { LibSQLStore } from '@mastra/libsql'
import { PinoLogger } from '@mastra/loggers'
import { supportAgent } from './agents/support-agent.ts'

// Optional second layer of defence on top of the Traefik basic-auth in front of
// the domain. Set MASTRA_API_KEY in Coolify and Studio will show a login screen
// and require the key on every /api/* call. Leave unset to disable.
const apiKey = process.env.MASTRA_API_KEY
const auth = apiKey
  ? new SimpleAuth({
      tokens: {
        [apiKey]: { id: 'studio-user', name: 'Studio', role: 'owner' },
      },
    })
  : undefined

// Persisted to a Docker volume in production (see docker-compose.yaml / Coolify
// Persistent Storage). Swap for @mastra/pg + PostgresStore when you outgrow it.
const storageUrl = process.env.MASTRA_DB_URL ?? 'file:./data/mastra.db'

export const mastra = new Mastra({
  agents: { supportAgent },

  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: storageUrl,
    authToken: process.env.MASTRA_DB_AUTH_TOKEN,
  }),

  logger: new PinoLogger({
    name: 'mastra',
    level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
  }),

  server: {
    // Must bind to 0.0.0.0 inside a container, otherwise Traefik cannot reach it.
    host: process.env.MASTRA_HOST ?? '0.0.0.0',
    port: Number(process.env.PORT ?? 4111),

    ...(auth ? { auth } : {}),

    // Agent/workflow runs can be long. Keep this above your slowest run.
    timeout: Number(process.env.MASTRA_REQUEST_TIMEOUT ?? 180_000),
    // Let in-flight requests finish when Coolify redeploys.
    drainTimeout: Number(process.env.MASTRA_DRAIN_TIMEOUT ?? 30_000),

    cors: {
      origin: (process.env.MASTRA_CORS_ORIGIN ?? '*').split(',').map(s => s.trim()),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'x-mastra-client-type'],
      credentials: false,
    },

    build: {
      swaggerUI: process.env.MASTRA_SWAGGER_UI === 'true',
      openAPIDocs: process.env.MASTRA_OPENAPI === 'true',
      apiReqLogs: process.env.MASTRA_API_REQ_LOGS === 'true',
    },
  },
})
