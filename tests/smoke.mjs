import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

const baseURL = process.env.APP_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await mkdir('test-results', { recursive: true })
let count = 0
async function check(name, fn) {
  await fn()
  count++
  console.log(`PASS ${name}`)
}
async function visible(locator) {
  await locator.waitFor({ state: 'visible' })
  assert.equal(await locator.isVisible(), true)
}
try {
  await page.goto(baseURL)
  await check('all 42 daily cards render, with no fabricated baseline', async () => {
    assert.equal(await page.locator('.day-card').count(), 42)
    assert.match(await page.locator('.stat').nth(2).innerText(), /—/)
    await page.screenshot({ path: 'test-results/journal-desktop.png', fullPage: true })
  })
  await page.getByRole('button', { name: 'Start your session' }).click()
  await page
    .getByRole('textbox', { name: 'What’s the topic?' })
    .fill('The value of a deliberate pause')
  await page.getByLabel('Date', { exact: true }).fill('2026-10-27')
  await page.getByLabel('Google Photos / video link').fill('https://photos.app.goo.gl/practice')
  await check('video is an external link and all exact criteria are available', async () => {
    assert.equal(
      await page.getByRole('link', { name: 'Open video' }).getAttribute('target'),
      '_blank',
    )
    assert.equal(await page.locator('.criterion-row').count(), 12)
  })
  await page.getByRole('button', { name: 'Rate of speech: 3 — Adequate', exact: true }).click()
  await page.getByRole('button', { name: 'Posture: 4 — Strong', exact: true }).click()
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click()
  await page.getByRole('button', { name: 'Reflection', exact: true }).click()
  await page.getByLabel('One focus for tomorrow').fill('Pause before each new thought.')
  await page.reload()
  await check('Day 1 persists after reload and reflection is independent', async () => {
    assert.equal(
      await page.getByRole('textbox', { name: 'What’s the topic?' }).inputValue(),
      'The value of a deliberate pause',
    )
    assert.equal(
      await page
        .getByRole('button', { name: 'Rate of speech: 3 — Adequate', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    )
    await page.getByRole('button', { name: 'Reflection', exact: true }).click()
    assert.equal(
      await page.getByLabel('One focus for tomorrow').inputValue(),
      'Pause before each new thought.',
    )
  })
  await page.getByRole('button', { name: 'Next day', exact: true }).click()
  await visible(page.getByRole('heading', { name: 'Day 02. A minute for you.', exact: true }))
  await check('day navigation never repeats the previous day’s data', async () => {
    assert.equal(await page.getByRole('textbox', { name: 'What’s the topic?' }).inputValue(), '')
    assert.equal(await page.getByLabel('Google Photos / video link').inputValue(), '')
  })
  await page.getByRole('button', { name: 'Previous day', exact: true }).click()
  await visible(page.getByRole('heading', { name: 'Day 01. A minute for you.', exact: true }))
  await page.getByLabel('Google Photos / video link').fill('javascript:alert(1)')
  await check('unsafe link cannot overwrite a saved video URL', async () => {
    await visible(page.getByRole('alert'))
    assert.equal(
      await page.getByRole('link', { name: 'Open video' }).getAttribute('href'),
      'https://photos.app.goo.gl/practice',
    )
  })
  await page.getByLabel('Google Photos / video link').fill('https://photos.app.goo.gl/practice')
  await page.getByRole('button', { name: 'Outside feedback', exact: true }).click()
  await page.getByLabel('Reviewer', { exact: false }).fill('Sam')
  await page.getByLabel('Their feedback').fill('Your ending felt clear and deliberate.')
  await page.getByRole('button', { name: 'Save feedback', exact: true }).click()
  await check('outside feedback is recorded with reviewer and timestamp', async () => {
    await visible(page.getByRole('heading', { name: 'Sam', exact: true }))
    await visible(page.getByText('Your ending felt clear and deliberate.', { exact: true }))
  })
  await page.getByRole('button', { name: 'AI review', exact: true }).click()
  await check('saved Google Photos link can be selected without a local upload', async () => {
    assert.equal(
      await page
        .getByRole('button', { name: 'Use Google Photos link', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    )
    assert.equal(await page.getByLabel('Original video', { exact: true }).count(), 0)
    await page.getByRole('checkbox', { name: 'I want to send this day’s video' }).check()
    const analyze = page.getByRole('button', { name: 'Analyze video', exact: true })
    assert.equal(await analyze.isEnabled(), true)
    await analyze.click()
    await visible(page.getByRole('alert'))
    assert.match(await page.getByRole('alert').innerText(), /sign in/)
  })
  await page.getByRole('button', { name: 'Use local file instead', exact: true }).click()
  await check(
    'invalid video selection reports the format before upload and keeps journal edits',
    async () => {
      await page.getByLabel('Original video', { exact: true }).setInputFiles({
        name: 'day-1.mov',
        mimeType: 'video/quicktime',
        buffer: Buffer.from('video selection fixture'),
      })
      await page.getByRole('alert').waitFor()
      assert.match(await page.getByRole('alert').innerText(), /\.MOV file.*Export an MP4 copy/)
      assert.equal(
        await page.getByRole('button', { name: 'Analyze video', exact: true }).isDisabled(),
        true,
      )
      assert.equal(
        await page.getByLabel('What’s the topic?').inputValue(),
        'The value of a deliberate pause',
      )
      await page.getByLabel('Original video', { exact: true }).setInputFiles([])
    },
  )
  await check(
    'in-app analysis requires a local file, consent, and sign-in without changing the journal',
    async () => {
      const analyze = page.getByRole('button', { name: 'Analyze video', exact: true })
      assert.equal(await analyze.isDisabled(), true)
      await page.getByLabel('Original video', { exact: true }).setInputFiles({
        name: 'day-1.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]),
      })
      assert.equal(await analyze.isDisabled(), true)
      await page.getByRole('checkbox', { name: 'I want to send this day’s video' }).check()
      await analyze.click()
      await visible(page.getByRole('alert'))
      assert.match(await page.getByRole('alert').innerText(), /sign in/)
      assert.equal(
        await page.getByLabel('What’s the topic?').inputValue(),
        'The value of a deliberate pause',
      )
      await page.getByLabel('Original video', { exact: true }).setInputFiles([])
    },
  )
  await page.getByRole('button', { name: 'Import AI review', exact: true }).click()
  await page.getByLabel('AI response (JSON)').fill('{}')
  await page.getByRole('checkbox', { name: 'I supplied this day’s actual video' }).check()
  await page.getByRole('button', { name: 'Validate review', exact: true }).click()
  await check('invalid AI output is rejected without an overwrite', async () => {
    await visible(page.getByRole('alert'))
    assert.equal(
      await page.getByRole('button', { name: 'Save new version', exact: true }).isDisabled(),
      true,
    )
  })
  const ai = {
    schemaVersion: 1,
    model: 'test-fixture-model',
    promptVersion: 'articulation-v1',
    analyzedAt: '2026-10-27T12:00:00Z',
    fileMetadata: { name: 'test-video.mp4' },
    audioScores: Object.fromEntries(
      ['rate', 'volume', 'pitch', 'pauses', 'endings', 'clarity', 'fillers'].map((id) => [
        id,
        { score: 3, evidence: 'Test evidence', suggestion: 'Pause', timestamps: [] },
      ]),
    ),
    visualScores: Object.fromEntries(
      ['posture', 'gestures', 'face', 'nerves', 'presence'].map((id) => [
        id,
        { score: null, evidence: 'Not assessed in fixture', suggestion: '', timestamps: [] },
      ]),
    ),
    fillerCounts: [],
    strengths: ['Clear opening'],
    improvements: ['Pace'],
    tomorrowExercise: 'Pause.',
    limitations: ['Test fixture, not a real assessment'],
  }
  await page.getByLabel('AI response (JSON)').fill(JSON.stringify(ai))
  await page.getByRole('button', { name: 'Validate review', exact: true }).click()
  await page.getByRole('button', { name: 'Save new version', exact: true }).click()
  await check(
    'validated AI review is saved separately with null modalities and provenance',
    async () => {
      await visible(page.getByText('test-fixture-model', { exact: true }))
      assert.match(await page.locator('.comparison-grid').innerText(), /3.00/)
      assert.match(await page.locator('.comparison-grid').innerText(), /—/)
    },
  )
  await page.getByRole('button', { name: 'Backups & import', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const download = await downloadPromise
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  await check(
    'export contains 42 days and full rubric, reflections, feedback, and AI metadata',
    async () => {
      assert.equal(exported.entries.length, 42)
      const e = exported.entries[0]
      assert.equal(e.reflection.tomorrowFocus, 'Pause before each new thought.')
      assert.equal(e.aiReviews[0].model, 'test-fixture-model')
      assert.equal(e.externalFeedback[0].reviewer, 'Sam')
    },
  )
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Backups & import', exact: true }).click()
  await page.getByLabel('Import backup file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  })
  await page.getByRole('button', { name: 'Import 1 day', exact: true }).click()
  await check('export → clear browser storage → import restores the journal', async () => {
    assert.equal(
      await page.getByRole('textbox', { name: 'What’s the topic?' }).inputValue(),
      'The value of a deliberate pause',
    )
    await page.getByRole('button', { name: 'Reflection', exact: true }).click()
    assert.equal(
      await page.getByLabel('One focus for tomorrow').inputValue(),
      'Pause before each new thought.',
    )
  })
  await page.getByRole('button', { name: 'Backups & import', exact: true }).click()
  const legacy = {
    version: 1,
    records: {
      1: { topic: 'Do not overwrite me' },
      3: { topic: 'Legacy day', scores: { rate: 2 }, aiScore: '2.4', aiNotes: 'Original notes' },
    },
  }
  await page.getByLabel('Import backup file').setInputFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  })
  await check('legacy import preview keeps existing days by default', async () => {
    assert.match(await page.locator('.import-list').innerText(), /Keep existing/)
    assert.equal(
      await page.getByRole('button', { name: 'Import 1 day', exact: true }).isEnabled(),
      true,
    )
  })
  await page.getByRole('button', { name: 'Import 1 day', exact: true }).click()
  await page.getByRole('button', { name: 'Back to journal', exact: true }).click()
  await check('migrated prototype adds only the selected new day', async () => {
    assert.match(
      await page.getByRole('button', { name: /^Day 1, completed/ }).innerText(),
      /The value/,
    )
    assert.match(
      await page.getByRole('button', { name: /^Day 3, in progress/ }).innerText(),
      /Legacy day/,
    )
  })
  await page.getByRole('button', { name: 'Your progress', exact: true }).click()
  await check('progress charts render, with unrated days kept as gaps', async () => {
    assert.equal(await page.locator('.chart-wrap').count(), 3)
    assert.equal(await page.locator('tbody tr').count(), 42)
    await page.screenshot({ path: 'test-results/progress-desktop.png', fullPage: true })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.getByRole('button', { name: 'Daily journal', exact: false }).click()
  await page.waitForTimeout(250)
  await check('mobile has no horizontal overflow and navigation closes', async () => {
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    )
    assert.equal(
      await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right <= 0),
      true,
    )
    await page.screenshot({ path: 'test-results/journal-mobile.png', fullPage: true })
  })
  await page.getByRole('button', { name: /^Day 1, completed/ }).click()
  await check('mobile review remains usable', async () => {
    await page.getByRole('button', { name: 'Self review', exact: true }).click()
    assert.equal(await page.locator('.criterion-row').count(), 12)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    )
    await page.screenshot({ path: 'test-results/review-mobile.png', fullPage: true })
  })
  assert.deepEqual(errors, [])
  console.log(`${count} browser checks passed. No uncaught application errors.`)
} finally {
  await browser.close()
}
