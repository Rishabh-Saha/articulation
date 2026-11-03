import { describe, expect, it } from 'vitest'
import { aiPrompt, blankDay, parseAiReview } from '../src/model'
import type { AiReview, DayEntry } from '../src/model'
import { summarizeProgress } from '../src/progress'

function review(overrides: Partial<AiReview> = {}, id = 'fixture') {
  const template = parseAiReview(aiPrompt().split('JSON structure:\n')[1])
  return { ...template, model: 'fixture-model', ...overrides, id }
}
function day(n: number, self: number | null, ai: number | null): DayEntry {
  const entry = blankDay(n)
  entry.self.audio.rate.score = self
  const feedback = review()
  feedback.audioScores.rate.score = ai
  entry.aiReviews = [feedback]
  return entry
}

describe('progress summary', () => {
  it('works with self reflections alone, or AI feedback alone', () => {
    const own = blankDay(1)
    own.reflection.strengths = 'Speaking clearly'
    own.reflection.tomorrowFocus = 'Use a strong closing sentence'
    const summary = summarizeProgress({ 1: own })
    expect(summary.hasAi).toBe(false)
    expect(summary.strengths[0].sources).toEqual([{ day: 1, kind: 'You' }])
    expect(summary.focus[0].text).toBe('Use a strong closing sentence')
    const ai = day(2, null, 3)
    ai.aiReviews[0].strengths = ['Natural expression']
    expect(summarizeProgress({ 2: ai }).strengths[0]).toEqual({
      text: 'Natural expression',
      sources: [{ day: 2, kind: 'AI' }],
    })
  })

  it('does not resurface feedback from outside the recent three-day window', () => {
    const entries = Object.fromEntries(
      [1, 2, 3, 4].map((n) => {
        const entry = day(n, null, null)
        entry.reflection.improvements = 'A reflection to include this day'
        entry.aiReviews[0].improvements = ['AI feedback to include this day']
        if (n === 1) {
          entry.reflection.strengths = 'An older strength'
          entry.aiReviews[0].strengths = ['Older AI strength']
        }
        return [n, entry]
      }),
    )
    expect(summarizeProgress(entries).strengths).toEqual([])
  })

  it('leaves a blank journal empty without inventing progress or feedback', () => {
    expect(summarizeProgress({ 1: blankDay(1) })).toEqual({
      strengths: [],
      workingOn: [],
      focus: [],
      improved: [],
      comparisons: 0,
      hasAi: false,
    })
  })

  it('combines recent strengths, areas to practise, and the latest focus from both sources', () => {
    const early = day(1, 2, 1)
    const latest = day(4, 4, 3)
    latest.reflection.strengths = 'Clear opening'
    latest.reflection.improvements = 'Stay on topic'
    latest.reflection.tomorrowFocus = 'Use one example'
    latest.aiReviews[0].strengths = ['Clear gestures']
    latest.aiReviews[0].improvements = ['Slow down at transitions']
    latest.aiReviews[0].tomorrowExercise = 'Pause between ideas'
    const summary = summarizeProgress({ 4: latest, 1: early })
    expect(summary.strengths).toEqual([
      { text: 'Clear opening', sources: [{ day: 4, kind: 'You' }] },
      { text: 'Clear gestures', sources: [{ day: 4, kind: 'AI' }] },
    ])
    expect(summary.workingOn.map((n) => n.text)).toEqual([
      'Stay on topic',
      'Slow down at transitions',
    ])
    expect(summary.focus.map((n) => n.text)).toEqual(['Use one example', 'Pause between ideas'])
    expect(summary.improved).toEqual([
      { label: 'Rate of speech', kind: 'You', fromDay: 1, toDay: 4, from: 2, to: 4 },
      { label: 'Rate of speech', kind: 'AI', fromDay: 1, toDay: 4, from: 1, to: 3 },
    ])
  })

  it('deduplicates repeated feedback and retains every source day and perspective', () => {
    const first = day(1, null, null)
    const last = day(3, null, null)
    first.reflection.strengths = ' Clear opening '
    last.reflection.strengths = 'Clear opening'
    last.aiReviews[0].strengths = ['clear  opening', 'clear opening']
    const summary = summarizeProgress({ 1: first, 3: last })
    expect(summary.strengths).toEqual([
      {
        text: 'Clear opening',
        sources: [
          { day: 3, kind: 'You' },
          { day: 3, kind: 'AI' },
          { day: 1, kind: 'You' },
        ],
      },
    ])
  })

  it('uses only the latest review on each day and never treats versions as separate practice days', () => {
    const entry = day(2, 4, 1)
    entry.aiReviews[0].strengths = ['Superseded feedback']
    const updated = review({ strengths: ['Current feedback'] }, 'new-version')
    updated.audioScores.rate.score = 5
    entry.aiReviews.push(updated)
    const summary = summarizeProgress({ 2: entry })
    expect(summary.strengths.map((s) => s.text)).toEqual(['Current feedback'])
    expect(summary.improved).toEqual([])
    expect(summary.comparisons).toBe(0)
  })

  it('compares AI scores only within the current model and prompt, without mixing self ratings', () => {
    const first = day(1, 1, 1)
    const middle = day(3, 2, 3)
    const last = day(5, 2, 5)
    middle.aiReviews[0].model = 'new-model'
    last.aiReviews[0].model = 'new-model'
    let summary = summarizeProgress({ 1: first, 3: middle, 5: last })
    expect(summary.improved.find((c) => c.kind === 'AI')?.fromDay).toBe(3)
    last.aiReviews[0].promptVersion = 'new-prompt'
    summary = summarizeProgress({ 1: first, 3: middle, 5: last })
    expect(summary.improved.filter((c) => c.kind === 'AI')).toEqual([])
    expect(summary.improved[0]).toMatchObject({ kind: 'You', from: 1, to: 2 })
  })

  it('ignores unrated gaps, flat or declining scores, and legacy combined estimates', () => {
    const first = day(1, 4, 4)
    const gap = day(2, null, null)
    const last = day(7, 4, 2)
    last.legacyAi = { score: 5, notes: 'Legacy combined estimate' }
    const summary = summarizeProgress({ 1: first, 2: gap, 7: last })
    expect(summary.improved).toEqual([])
    expect(summary.comparisons).toBe(2)
  })

  it('uses only three recent days per feedback source, ignoring unrelated blank and notes-only days', () => {
    const entries = Object.fromEntries(
      [1, 2, 3, 4].map((n) => {
        const entry = day(n, null, null)
        entry.reflection.strengths = `My strength ${n}`
        entry.aiReviews[0].strengths = [`AI strength ${n}`]
        return [n, entry]
      }),
    )
    entries[5] = blankDay(5)
    entries[5].reflection.notes = 'Unrelated notes'
    const summary = summarizeProgress(entries)
    expect(summary.strengths.map((n) => n.text)).toEqual([
      'My strength 4',
      'AI strength 4',
      'My strength 3',
      'AI strength 3',
    ])
    expect(summary.strengths.flatMap((n) => n.sources.map((s) => s.day))).not.toContain(1)
  })

  it('falls back to assessed criterion coaching and retains the latest nonempty exercises', () => {
    const first = day(1, null, 2)
    first.reflection.tomorrowFocus = 'A deliberate ending'
    first.aiReviews[0].tomorrowExercise = 'Pause for one breath'
    const last = day(3, null, 3)
    last.aiReviews[0].audioScores.rate.suggestion = 'Leave room between thoughts'
    last.aiReviews[0].visualScores.face.suggestion = 'Do not surface unassessed coaching'
    const before = JSON.stringify({ 1: first, 3: last })
    const summary = summarizeProgress({ 1: first, 3: last })
    expect(summary.workingOn[0].text).toBe('Rate of speech: Leave room between thoughts')
    expect(summary.focus.map((n) => n.text)).toEqual([
      'A deliberate ending',
      'Pause for one breath',
    ])
    expect(summary.focus.every((n) => n.sources[0].day === 1)).toBe(true)
    expect(JSON.stringify({ 1: first, 3: last })).toBe(before)
  })
})
