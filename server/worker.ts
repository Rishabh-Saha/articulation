import { analyze } from './analysis'
import type { AnalysisEnv } from './analysis'

interface WorkerEnv extends AnalysisEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context: { waitUntil(task: Promise<unknown>): void },
  ): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/analyze') {
      return analyze(request, env, (task) => context.waitUntil(task))
    }
    // Unknown API paths must never receive the SPA's index.html fallback.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return Response.json(
        { error: 'Unknown API endpoint.' },
        {
          status: 404,
          headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        },
      )
    }
    return env.ASSETS.fetch(request)
  },
}
