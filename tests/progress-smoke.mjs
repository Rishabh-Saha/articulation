import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

// Fresh temporary contexts only: no account login, database writes, or storage clearing.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const summary = () => page.getByRole('region', { name: 'Your practice, in perspective' })
try {
  await page.goto(`${base}/#progress`)
  await summary().waitFor()
  assert.match(await summary().innerText(), /Rate the same criterion on two different days/)
  assert.equal(await summary().getByRole('link').count(), 0)
  console.log('PASS empty progress summary offers guidance without invented results')

  const ratings = (keys) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        {
          score: null,
          evidence: 'Fixture evidence',
          suggestion: '',
          timestamps: [],
        },
      ]),
    )
  function review(day, score) {
    const ai = {
      id: `fixture-${day}`,
      schemaVersion: 1,
      model: 'summary-fixture',
      promptVersion: 'articulation-v1',
      analyzedAt: '2026-11-03T12:00:00Z',
      fileMetadata: { name: `fixture-${day}.mp4` },
      audioScores: ratings(['rate', 'volume', 'pitch', 'pauses', 'endings', 'clarity', 'fillers']),
      visualScores: ratings(['posture', 'gestures', 'face', 'nerves', 'presence']),
      fillerCounts: [{ word: 'um', count: 2 }],
      strengths: ['Purposeful gestures'],
      improvements: ['Leave a pause between ideas'],
      tomorrowExercise: 'Record three sentences with a breath between each.',
      limitations: [],
    }
    ai.audioScores.rate.score = score
    return ai
  }
  // Import a versioned backup through the normal preview flow, into this test-only journal.
  await page.getByRole('button', { name: 'Backups & import', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const download = await downloadPromise
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  const early = backup.entries[0]
  early.self.audio.rate.score = 2
  early.aiReviews = [review(1, 1)]
  const latest = backup.entries[3]
  latest.self.audio.rate.score = 4
  latest.aiReviews = [review(4, 3)]
  latest.reflection.strengths = 'A clear opening'
  latest.reflection.improvements = 'Finish my thought before starting another'
  latest.reflection.tomorrowFocus = 'Tell one story with a clear ending.'
  latest.reflection.notes = 'Keep these journal notes safe'
  await page.getByLabel('Import backup file').setInputFiles({
    name: 'summary-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const importing = page.getByRole('button', { name: 'Import 2 days', exact: true })
  await importing.waitFor()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent.includes('Import 2 days') && !button.disabled,
    ),
  )
  await importing.click()
  await summary().getByText('A clear opening', { exact: true }).waitFor()
  const text = await summary().innerText()
  for (const expected of [
    'Purposeful gestures',
    '2 → 4 / 5',
    '1 → 3 / 5',
    'Finish my thought before starting another',
    'Leave a pause between ideas',
    'Tell one story with a clear ending.',
    'Record three sentences with a breath between each.',
  ])
    assert.ok(text.includes(expected), expected)
  console.log(
    'PASS summary combines AI and personal feedback, score increases, and next-video focus',
  )
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(
    a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
  )
  console.log('PASS populated progress view accessibility')
  await mkdir('test-results', { recursive: true })
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
  await summary().screenshot({ path: 'test-results/progress-summary-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await summary().screenshot({ path: 'test-results/progress-summary-mobile.png' })
  const mobileA11y = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    mobileA11y.violations.map((v) => v.id),
    [],
  )
  console.log('PASS mobile summary fits the viewport and remains accessible')
  await summary().getByRole('link', { name: 'You · Day 4', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Day 04. A minute for you.', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reflection', exact: true }).click()
  assert.equal(
    await page.getByLabel('Notes for today', { exact: true }).inputValue(),
    'Keep these journal notes safe',
  )
  await page
    .getByLabel('What would you change?', { exact: true })
    .fill('Keep the conclusion concise')
  await page.goto(`${base}/#progress`)
  await summary().getByText('Keep the conclusion concise', { exact: true }).waitFor()
  await page.reload()
  await summary().getByText('Keep the conclusion concise', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS source-day navigation, existing notes, live updates and reload persistence')
} finally {
  await browser.close()
}
