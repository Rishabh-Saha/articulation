import { chromium } from 'playwright'
import assert from 'node:assert/strict'

// Isolated, temporary browser context: never touches an existing journal or clears storage.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173')
  await page.getByRole('button', { name: 'Start your session' }).click()
  await page.getByLabel('What’s the topic?').fill('Preserve this journal entry')
  await page.getByRole('button', { name: /^AI review/ }).click()
  const criteria = (ids) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        {
          score: 4,
          evidence: 'First line\nSecond line',
          suggestion: 'Keep practising',
          timestamps: [],
        },
      ]),
    )
  const review = {
    schemaVersion: 1,
    model: 'regression-fixture',
    promptVersion: 'articulation-v1',
    analyzedAt: '2026-11-01T12:00:00Z',
    fileMetadata: { name: 'fixture.mp4' },
    audioScores: criteria(['rate', 'volume', 'pitch', 'pauses', 'endings', 'clarity', 'fillers']),
    visualScores: criteria(['posture', 'gestures', 'face', 'nerves', 'presence']),
    fillerCounts: [
      { word: 'um', count: 2 },
      { word: 'like', count: 1, confidence: 'high' },
    ],
    strengths: ['Clear opening'],
    improvements: ['Pace'],
    tomorrowExercise: 'Pause',
    limitations: [],
  }
  async function openImport() {
    await page.getByRole('button', { name: 'Import AI review', exact: true }).click()
  }
  const validate = () => page.getByRole('button', { name: 'Validate review', exact: true }).click()
  const save = () => page.getByRole('button', { name: 'Save new version', exact: true })
  await openImport()
  await page.getByLabel('AI response (JSON)').fill(JSON.stringify(review).replaceAll('\\n', '\n'))
  assert.equal(
    await page.getByRole('button', { name: 'Validate review', exact: true }).isDisabled(),
    true,
  )
  await page.getByRole('checkbox', { name: 'I supplied this day’s actual video' }).check()
  await validate()
  await save().click()
  assert.match(await page.locator('.ai-summary').innerText(), /um: 2 · confidence not provided/)
  assert.match(await page.locator('.ai-summary').innerText(), /like: 1 · high confidence/)
  await openImport()
  review.audioScores.rate.score = 6
  await page.getByLabel('AI response (JSON)').fill(JSON.stringify(review))
  await page.getByRole('checkbox', { name: 'I supplied this day’s actual video' }).check()
  await validate()
  assert.match(await page.getByRole('alert').innerText(), /audioScores\.rate\.score:/i)
  assert.equal(await save().isDisabled(), true)
  review.audioScores.rate.score = 3
  await page.getByLabel('AI response (JSON)').fill(JSON.stringify(review))
  await validate()
  await save().click()
  assert.equal(await page.locator('#review-version option').count(), 2)
  await page.goto((process.env.APP_URL || 'http://127.0.0.1:5173') + '/#day/1')
  await page.reload()
  await page.getByRole('button', { name: /^AI review/ }).click()
  assert.equal(await page.locator('#review-version option').count(), 2)
  assert.equal(
    await page.getByLabel('What’s the topic?').inputValue(),
    'Preserve this journal entry',
  )
  assert.match(await page.locator('.ai-summary').innerText(), /confidence not provided/)
  console.log(
    'PASS manual importer: missing confidence, multiline text, attestation, specific errors, history and reload persistence',
  )
} finally {
  await browser.close()
}
