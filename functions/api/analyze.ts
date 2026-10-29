import { analyze } from '../../server/analysis'
import type { AnalysisEnv } from '../../server/analysis'

export function onRequest(context: {
  request: Request
  env: AnalysisEnv
  waitUntil(task: Promise<unknown>): void
}) {
  return analyze(context.request, context.env, (task) => context.waitUntil(task))
}
