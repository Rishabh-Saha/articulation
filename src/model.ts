import { z } from 'zod'
import { audioCriteria, visualCriteria } from './rubric'

const text = z.string().max(20000)
export function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
const urlSchema = z
  .string()
  .max(4096)
  .refine((v) => v === '' || safeUrl(v) !== null, 'Use a complete HTTPS link without credentials.')
const rating = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  notes: text.default(''),
})
const audio = z.object({
  rate: rating,
  volume: rating,
  pitch: rating,
  pauses: rating,
  endings: rating,
  clarity: rating,
  fillers: rating,
})
const visual = z.object({
  posture: rating,
  gestures: rating,
  face: rating,
  nerves: rating,
  presence: rating,
})
const aiRating = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  evidence: text,
  suggestion: text,
  timestamps: z.array(z.string().max(100)).max(30).default([]),
})
export const aiReviewSchema = z.object({
  schemaVersion: z.literal(1),
  model: z.string().min(1).max(200),
  promptVersion: z.string().min(1).max(100),
  analyzedAt: z.string().datetime({ offset: true }),
  fileMetadata: z.object({
    name: z.string().min(1).max(500),
    duration: z.number().positive().optional(),
  }),
  audioScores: z.object({
    rate: aiRating,
    volume: aiRating,
    pitch: aiRating,
    pauses: aiRating,
    endings: aiRating,
    clarity: aiRating,
    fillers: aiRating,
  }),
  visualScores: z.object({
    posture: aiRating,
    gestures: aiRating,
    face: aiRating,
    nerves: aiRating,
    presence: aiRating,
  }),
  fillerCounts: z
    .array(
      z.object({
        word: z.string().max(100),
        count: z.number().int().nonnegative(),
        confidence: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(100)
    .default([]),
  wordsPerMinute: z.number().nonnegative().optional(),
  strengths: z.array(text).max(30),
  improvements: z.array(text).max(30),
  tomorrowExercise: text,
  limitations: z.array(text).max(30),
})
export type AiReview = z.infer<typeof aiReviewSchema>
const storedAiSchema = aiReviewSchema.extend({ id: z.string().min(1).max(100) })
export const daySchema = z.object({
  day: z.number().int().min(1).max(42),
  date: z
    .string()
    .refine(
      (v) =>
        v === '' ||
        (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
          Number.isFinite(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v),
      'Invalid date',
    ),
  topic: z.string().max(500),
  video: z.object({ provider: z.enum(['google_photos', 'external']), url: urlSchema }),
  self: z.object({ audio, visual, eyeContact: text, headMovement: text }),
  reflection: z.object({
    notes: text.default(''),
    strengths: text,
    improvements: text,
    tomorrowFocus: text,
  }),
  aiReviews: z.array(storedAiSchema).max(100),
  externalFeedback: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        reviewer: z.string().max(200),
        comment: text,
        createdAt: z.string().datetime({ offset: true }),
      }),
    )
    .max(200),
  legacyAi: z.object({ score: z.number().min(1).max(5).nullable(), notes: text }).optional(),
  completed: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
})
export type DayEntry = z.infer<typeof daySchema>
export type Records = Record<number, DayEntry>
export function blankDay(day: number): DayEntry {
  const make = (criteria: readonly { id: string }[]) =>
    Object.fromEntries(criteria.map((c) => [c.id, { score: null, notes: '' }]))
  return daySchema.parse({
    day,
    date: '',
    topic: '',
    video: { provider: 'google_photos', url: '' },
    self: {
      audio: make(audioCriteria),
      visual: make(visualCriteria),
      eyeContact: '',
      headMovement: '',
    },
    reflection: { strengths: '', improvements: '', tomorrowFocus: '' },
    aiReviews: [],
    externalFeedback: [],
    completed: false,
    updatedAt: new Date().toISOString(),
  })
}
export function average(values: (number | null)[]) {
  const scores = values.filter((v): v is number => v !== null)
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}
export function scores(entry?: DayEntry, ai = false) {
  const latest = entry?.aiReviews.at(-1)
  const audio = ai ? latest?.audioScores : entry?.self.audio
  const visual = ai ? latest?.visualScores : entry?.self.visual
  const a = Object.values(audio ?? {}).map((r) => r.score)
  const v = Object.values(visual ?? {}).map((r) => r.score)
  return { audio: average(a), visual: average(v), combined: average([...a, ...v]) }
}
export const formatScore = (score: number | null) => (score === null ? '—' : score.toFixed(2))
export function hasContent(entry?: DayEntry) {
  return (
    !!entry &&
    !!(
      entry.topic ||
      entry.date ||
      entry.video.url ||
      entry.completed ||
      scores(entry).combined !== null ||
      entry.aiReviews.length ||
      entry.externalFeedback.length ||
      Object.values(entry.reflection).some(Boolean) ||
      entry.self.eyeContact ||
      entry.self.headMovement ||
      [...Object.values(entry.self.audio), ...Object.values(entry.self.visual)].some(
        (r) => r.notes,
      ) ||
      entry.legacyAi
    )
  )
}
export function videoProvider(url: string): 'google_photos' | 'external' {
  try {
    return ['photos.app.goo.gl', 'photos.google.com', 'www.photos.google.com'].includes(
      new URL(url).hostname,
    )
      ? 'google_photos'
      : 'external'
  } catch {
    return 'external'
  }
}

const exportSchema = z.object({
  schemaVersion: z.literal(2),
  exportedAt: z.string(),
  entries: z.array(daySchema).length(42),
})
export function createExport(records: Records) {
  return {
    schemaVersion: 2 as const,
    exportedAt: new Date().toISOString(),
    entries: Array.from({ length: 42 }, (_, i) => records[i + 1] ?? blankDay(i + 1)),
  }
}
const legacySchema = z.object({
  version: z.literal(1),
  records: z.record(
    z.string(),
    z.object({
      date: z.string().optional(),
      topic: z.string().optional(),
      videoUrl: z.string().optional(),
      scores: z.record(z.string(), z.number().int().min(1).max(5)).optional(),
      strength: z.string().optional(),
      improve: z.string().optional(),
      focus: z.string().optional(),
      aiScore: z.union([z.string(), z.number()]).optional(),
      aiNotes: z.string().optional(),
      otherNotes: z.string().optional(),
    }),
  ),
})
export function parseBackup(input: unknown): { entries: DayEntry[]; legacy: boolean } {
  if (typeof input === 'object' && input !== null && 'schemaVersion' in input) {
    const backup = exportSchema.parse(input)
    if (new Set(backup.entries.map((e) => e.day)).size !== 42)
      throw Error('Duplicate or missing days in backup.')
    return { entries: backup.entries.filter(hasContent), legacy: false }
  }
  const legacy = legacySchema.parse(input)
  const entries = Object.entries(legacy.records).map(([key, value]) => {
    const day = Number(key)
    if (!Number.isInteger(day) || day < 1 || day > 42)
      throw Error('Backup contains an invalid day.')
    const entry = blankDay(day)
    entry.topic = value.topic ?? ''
    entry.date = value.date ?? ''
    entry.video = { provider: videoProvider(value.videoUrl ?? ''), url: value.videoUrl ?? '' }
    for (const c of audioCriteria) entry.self.audio[c.id].score = value.scores?.[c.id] ?? null
    for (const c of visualCriteria) entry.self.visual[c.id].score = value.scores?.[c.id] ?? null
    entry.reflection = {
      notes: '',
      strengths: value.strength ?? '',
      improvements: value.improve ?? '',
      tomorrowFocus: value.focus ?? '',
    }
    if (value.aiNotes || value.aiScore) {
      const n = Number(value.aiScore)
      entry.legacyAi = { score: n >= 1 && n <= 5 ? n : null, notes: value.aiNotes ?? '' }
    }
    if (value.otherNotes)
      entry.externalFeedback.push({
        id: crypto.randomUUID(),
        reviewer: 'Imported feedback',
        comment: value.otherNotes,
        createdAt: new Date().toISOString(),
      })
    return daySchema.parse(entry)
  })
  return { entries: entries.filter(hasContent), legacy: true }
}

export function parseAiReview(raw: string): AiReview {
  return aiReviewSchema.parse(
    JSON.parse(raw.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')),
  )
}
export function aiPrompt() {
  const shape = (criteria: readonly { id: string }[]) =>
    Object.fromEntries(
      criteria.map((c) => [c.id, { score: null, evidence: '', suggestion: '', timestamps: [] }]),
    )
  return `Review the actual speaking video I attach. Do not evaluate without a video. Use articulation rubric v1. Score 1=needs substantial improvement, 2=inconsistent, 3=adequate, 4=strong, 5=excellent. Audio criteria use sound only; visual criteria use video only. For missing modalities use null with an explanation. Do not infer emotions, anxiety, or personality. Describe observable behaviors only. Assess energy over the actual video duration. Count only filler uses of words; counts may be approximate. Never invent timestamps, duration, or transcription. Omit duration and wordsPerMinute when unknown. Replace model with your actual model identifier and analyzedAt with the actual ISO timestamp. Return JSON only, with ALL these keys; preserve the schemaVersion and promptVersion. Do not include computed averages.\n\nRubric:\n${[...audioCriteria, ...visualCriteria].map((c) => `${c.id}: ${c.label} — ${c.detail}`).join('\n')}\n\nJSON structure:\n${JSON.stringify({ schemaVersion: 1, model: 'ACTUAL_MODEL_ID', promptVersion: 'articulation-v1', analyzedAt: new Date().toISOString(), fileMetadata: { name: 'ACTUAL_FILE_NAME' }, audioScores: shape(audioCriteria), visualScores: shape(visualCriteria), fillerCounts: [], strengths: [], improvements: [], tomorrowExercise: '', limitations: [] }, null, 2)}`
}
