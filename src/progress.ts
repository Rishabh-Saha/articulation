import type { AiReview, DayEntry, Records } from './model'
import { audioCriteria, visualCriteria } from './rubric'

export type SummarySource = { day: number; kind: 'You' | 'AI' }
export type SummaryNote = { text: string; sources: SummarySource[] }
export type RatingChange = {
  label: string
  kind: SummarySource['kind']
  fromDay: number
  toDay: number
  from: number
  to: number
}
const criteria = [...audioCriteria, ...visualCriteria]
const latestReview = (entry: DayEntry) => entry.aiReviews.at(-1)
const aiRatings = (review: AiReview) => ({ ...review.audioScores, ...review.visualScores })

function note(text: string, day: number, kind: SummarySource['kind']): SummaryNote {
  return { text: text.trim(), sources: [{ day, kind }] }
}

// Alternate sources so one long AI response cannot crowd out the user's reflections.
function combineNotes(own: SummaryNote[], ai: SummaryNote[], limit = 4) {
  const unique = new Map<string, SummaryNote>()
  for (let i = 0; i < Math.max(own.length, ai.length); i++) {
    for (const item of [own[i], ai[i]]) {
      if (!item?.text) continue
      const key = item.text.toLowerCase().replace(/\s+/g, ' ')
      const existing = unique.get(key)
      if (!existing) unique.set(key, { ...item, sources: [...item.sources] })
      else
        for (const source of item.sources)
          if (!existing.sources.some((s) => s.day === source.day && s.kind === source.kind))
            existing.sources.push(source)
    }
  }
  return [...unique.values()].slice(0, limit)
}

export function summarizeProgress(records: Records) {
  const entries = Object.values(records).sort((a, b) => a.day - b.day)
  const recent = [...entries].reverse()
  const selfDays = recent
    .filter((e) =>
      [e.reflection.strengths, e.reflection.improvements, e.reflection.tomorrowFocus].some((s) =>
        s.trim(),
      ),
    )
    .slice(0, 3)
  const aiDays = recent.filter((e) => latestReview(e)).slice(0, 3)
  const strengths = combineNotes(
    selfDays.map((e) => note(e.reflection.strengths, e.day, 'You')),
    aiDays.flatMap((e) => latestReview(e)!.strengths.map((text) => note(text, e.day, 'AI'))),
  )
  const workingOn = combineNotes(
    selfDays.map((e) => note(e.reflection.improvements, e.day, 'You')),
    aiDays.flatMap((e) => {
      const review = latestReview(e)!
      const improvements = review.improvements.filter((s) => s.trim())
      // Some reviews only provide coaching at criterion level.
      const suggestions = criteria.flatMap((c) => {
        const rating = aiRatings(review)[c.id]
        return rating.score !== null && rating.score <= 3 && rating.suggestion.trim()
          ? [`${c.label}: ${rating.suggestion}`]
          : []
      })
      return (improvements.length ? improvements : suggestions).map((text) =>
        note(text, e.day, 'AI'),
      )
    }),
  )
  const ownFocus = recent.find((e) => e.reflection.tomorrowFocus.trim())
  const aiFocus = recent.find((e) => latestReview(e)?.tomorrowExercise.trim())
  const focus = combineNotes(
    ownFocus ? [note(ownFocus.reflection.tomorrowFocus, ownFocus.day, 'You')] : [],
    aiFocus ? [note(latestReview(aiFocus)!.tomorrowExercise, aiFocus.day, 'AI')] : [],
  )

  const changes: RatingChange[] = []
  let comparisons = 0
  for (const kind of ['You', 'AI'] as const) {
    for (const criterion of criteria) {
      const points = entries.flatMap((entry) => {
        const review = latestReview(entry)
        const rating =
          kind === 'AI'
            ? review && aiRatings(review)[criterion.id]
            : { ...entry.self.audio, ...entry.self.visual }[criterion.id]
        return rating && rating.score !== null
          ? [
              {
                day: entry.day,
                score: rating.score,
                model: review?.model,
                prompt: review?.promptVersion,
              },
            ]
          : []
      })
      const last = points.at(-1)
      if (!last) continue
      const first = points.find(
        (p) =>
          p.day < last.day &&
          (kind === 'You' || (p.model === last.model && p.prompt === last.prompt)),
      )
      if (!first) continue
      comparisons++
      if (last.score > first.score)
        changes.push({
          label: criterion.label,
          kind,
          fromDay: first.day,
          toDay: last.day,
          from: first.score,
          to: last.score,
        })
    }
  }
  // Show both perspectives when available, then the largest remaining increases.
  changes.sort((a, b) => b.to - b.from - (a.to - a.from) || b.toDay - a.toDay)
  const ownChanges = changes.filter((c) => c.kind === 'You')
  const aiChanges = changes.filter((c) => c.kind === 'AI')
  const improved = Array.from({ length: Math.max(ownChanges.length, aiChanges.length) }, (_, i) =>
    [ownChanges[i], aiChanges[i]].filter((c): c is RatingChange => !!c),
  )
    .flat()
    .slice(0, 4)

  return { strengths, workingOn, focus, improved, comparisons, hasAi: aiDays.length > 0 }
}
