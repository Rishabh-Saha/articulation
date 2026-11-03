import { publicJournal } from '../../server/sharing'
import type { AnalysisEnv } from '../../server/analysis'

export const onRequest = (context: { request: Request; env: AnalysisEnv }) =>
  publicJournal(context.request, context.env)
