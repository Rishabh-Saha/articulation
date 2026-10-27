import { describe, expect, it } from 'vitest'
import {
  aiPrompt,
  blankDay,
  createExport,
  daySchema,
  formatScore,
  hasContent,
  parseAiReview,
  parseBackup,
  safeUrl,
  scores,
} from '../src/model'
import { audioCriteria, visualCriteria } from '../src/rubric'

describe('rubric and averages', () => {
  it('has the exact 7 audio and 5 visual criteria, with no invented baseline', () => {
    expect(audioCriteria.map((c) => c.label)).toEqual([
      'Rate of speech',
      'Volume variation',
      'Pitch and tone',
      'Places of pause',
      'Sentence endings',
      'Clarity and energy',
      'Filler words',
    ])
    expect(visualCriteria.map((c) => c.label)).toEqual([
      'Posture',
      'Hand gestures',
      'Facial expression',
      'Signs of nervousness',
      'Overall presence',
    ])
    expect(scores(blankDay(1))).toEqual({ audio: null, visual: null, combined: null })
    expect(hasContent(blankDay(1))).toBe(false)
  })
  it('weights each criterion equally and omits missing modalities', () => {
    const e = blankDay(1)
    e.self.audio.rate.score = 1
    e.self.audio.volume.score = 2
    e.self.visual.posture.score = 5
    expect(scores(e)).toEqual({ audio: 1.5, visual: 5, combined: 8 / 3 })
    expect(formatScore(scores(e).combined)).toBe('2.67')
  })
  it('rejects invalid scores, dates, day numbers and unsafe URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://photos.app.goo.gl/x',
      'https://name:pass@example.com/',
    ])
      expect(safeUrl(url)).toBeNull()
    expect(safeUrl('https://example.com/my-video')).toBe('https://example.com/my-video')
    for (const date of ['2026-02-30', '2026-99-99', 'bad'])
      expect(daySchema.safeParse({ ...blankDay(1), date }).success).toBe(false)
    expect(daySchema.safeParse({ ...blankDay(1), day: 43 }).success).toBe(false)
    const e = blankDay(1)
    e.self.audio.rate.score = 6
    expect(daySchema.safeParse(e).success).toBe(false)
  })
})
describe('backups and prototype migration', () => {
  it('round-trips all text and linked-video metadata through a 42-day backup', () => {
    const day = blankDay(3)
    day.topic = 'Learning to pause'
    day.self.audio.rate = { score: 3, notes: 'Rushed at the end.' }
    day.video.url = 'https://photos.app.goo.gl/test'
    day.reflection.tomorrowFocus = 'Pause before the first word.'
    day.externalFeedback = [
      {
        id: 'feedback',
        reviewer: 'Sam',
        comment: 'A clear opening.',
        createdAt: new Date().toISOString(),
      },
    ]
    const backup = createExport({ 3: day })
    expect(backup.entries).toHaveLength(42)
    expect(parseBackup(JSON.parse(JSON.stringify(backup))).entries).toEqual([day])
  })
  it('migrates the actual HTML v1 records format without inventing completion or criterion AI scores', () => {
    const parsed = parseBackup({
      version: 1,
      records: {
        '2': {
          topic: 'Old talk',
          date: '2026-10-01',
          videoUrl: 'https://photos.app.goo.gl/test',
          scores: { rate: 1, face: 2 },
          strength: 'Good start',
          improve: 'Less rushing',
          focus: 'Pause',
          aiScore: '2.83',
          aiNotes: 'Watch your pace.',
          otherNotes: 'Sam: clearer ending.',
        },
      },
    })
    const e = parsed.entries[0]
    expect(parsed.legacy).toBe(true)
    expect(e.day).toBe(2)
    expect(e.completed).toBe(false)
    expect(e.self.audio.rate.score).toBe(1)
    expect(e.self.visual.face.score).toBe(2)
    expect(e.reflection.tomorrowFocus).toBe('Pause')
    expect(e.externalFeedback[0].comment).toBe('Sam: clearer ending.')
    expect(e.legacyAi).toEqual({ score: 2.83, notes: 'Watch your pace.' })
    expect(scores(e, true).combined).toBeNull()
  })
  it('rejects duplicate days and unsafe legacy imports atomically', () => {
    const backup = createExport({})
    backup.entries[1] = backup.entries[0]
    expect(() => parseBackup(backup)).toThrow()
    expect(() =>
      parseBackup({ version: 1, records: { 1: { videoUrl: 'javascript:alert(1)' } } }),
    ).toThrow()
    expect(() => parseBackup({ version: 1, records: { 43: { topic: 'out of range' } } })).toThrow()
  })
})
describe('structured AI reviews', () => {
  function template() {
    return JSON.parse(aiPrompt().split('JSON structure:\n')[1])
  }
  it('keeps unknown scores null and disregards claimed averages', () => {
    const input = template()
    input.audioScores.rate.score = 3
    input.combinedAverage = 5
    const review = parseAiReview('```json\n' + JSON.stringify(input) + '\n```')
    const e = blankDay(1)
    e.aiReviews = [{ ...review, id: 'review-1' }]
    expect(scores(e, true)).toEqual({ audio: 3, visual: null, combined: 3 })
    expect(review).not.toHaveProperty('combinedAverage')
  })
  it('requires all criteria, evidence, and model provenance; disallows out-of-range scores', () => {
    const missing = template()
    delete missing.visualScores.face
    expect(() => parseAiReview(JSON.stringify(missing))).toThrow()
    const bad = template()
    bad.audioScores.rate.score = 0
    expect(() => parseAiReview(JSON.stringify(bad))).toThrow()
    const noModel = template()
    noModel.model = ''
    expect(() => parseAiReview(JSON.stringify(noModel))).toThrow()
  })
})
