import { describe, expect, it, vi } from 'vitest'
import worker from '../server/worker'

function setup() {
  return {
    env: { ASSETS: { fetch: vi.fn(async () => new Response('static site')) } },
    context: { waitUntil: vi.fn() },
  }
}

describe('Workers deployment routing', () => {
  it('routes analysis to the backend even when its bindings are not configured', async () => {
    const { env, context } = setup()
    const response = await worker.fetch(
      new Request('https://journal.example/api/analyze', { method: 'POST' }),
      env,
      context,
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')
    const result = await response.json()
    expect(result.error).toContain('Automatic analysis setup is incomplete')
    expect(result.missingConfiguration).toContain('AI_LIMITS')
    expect(result.missingConfiguration).toContain('GEMINI_API_KEY')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it.each(['/api', '/api/missing', '/api/analyze/extra'])(
    'returns JSON 404 for %s',
    async (path) => {
      const { env, context } = setup()
      const response = await worker.fetch(
        new Request(`https://journal.example${path}`),
        env,
        context,
      )
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(env.ASSETS.fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['/', '/assets/app.js', '/notebook'])(
    'keeps static and SPA requests on the asset handler: %s',
    async (path) => {
      const { env, context } = setup()
      const request = new Request(`https://journal.example${path}`)
      expect(await (await worker.fetch(request, env, context)).text()).toBe('static site')
      expect(env.ASSETS.fetch).toHaveBeenCalledWith(request)
    },
  )

  it('retains origin and sign-in checks when passing Worker bindings to analysis', async () => {
    const { env, context } = setup()
    const configured = {
      ...env,
      AI_ENABLED: 'true',
      FREE_TIER_CONFIRMED: 'true',
      GEMINI_MODEL: 'test-free-model',
      GEMINI_API_KEY: 'server-only-fixture',
      FIREBASE_PROJECT_ID: 'test-project',
      ALLOWED_UID: 'owner',
      APP_ORIGIN: 'https://journal.example',
      AI_LIMITS: {
        prepare: vi.fn(() => {
          throw Error('Unauthenticated requests cannot consume quota')
        }),
      },
    }
    const foreign = await worker.fetch(
      new Request('https://journal.example/api/analyze', {
        method: 'POST',
        headers: { Origin: 'https://other.example' },
      }),
      configured,
      context,
    )
    expect(foreign.status).toBe(403)
    const unsigned = await worker.fetch(
      new Request('https://journal.example/api/analyze', {
        method: 'POST',
        headers: { Origin: 'https://journal.example' },
      }),
      configured,
      context,
    )
    expect(unsigned.status).toBe(401)
    expect(configured.AI_LIMITS.prepare).not.toHaveBeenCalled()
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })
})
