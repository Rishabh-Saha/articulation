import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const context = await browser.newContext({
  permissions: ['clipboard-read', 'clipboard-write'],
  viewport: { width: 1440, height: 1000 },
})
const page = await context.newPage()
const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const errors = []
page.on('pageerror', (failure) => errors.push(failure.message))
const fillerLesson =
  'Fixing filler words — replace “um” with a pause.\nFinish one thought before starting the next.'
const gestureLesson = 'Use purposeful hand gestures to support each idea.'
try {
  await page.goto(`${base}/#day/8`)
  const lesson = page.getByLabel('What was today’s lesson about?', { exact: true })
  await page.waitForFunction(
    () =>
      document.querySelector('.bootcamp-panel textarea') &&
      !document.querySelector('.bootcamp-panel textarea').disabled,
  )
  assert.match(await page.locator('.bootcamp-panel').innerText(), /Week 2 · Day 1/)
  await page
    .getByLabel('What’s the topic?', { exact: true })
    .fill('A small habit that changed my day')
  await lesson.fill(fillerLesson)
  await page.reload()
  assert.equal(await lesson.inputValue(), fillerLesson)
  assert.equal(
    await page.getByLabel('What’s the topic?', { exact: true }).inputValue(),
    'A small habit that changed my day',
  )
  await page.goto(`${base}/#day/9`)
  assert.equal(await lesson.inputValue(), '')
  await lesson.fill(gestureLesson)
  await page.getByRole('button', { name: 'AI review', exact: true }).click()
  await page.getByRole('button', { name: 'Copy rubric prompt', exact: true }).click()
  let prompt = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(prompt.includes(JSON.stringify(gestureLesson)))
  assert.ok(!prompt.includes(fillerLesson.split('\n')[0]))
  await page.goto(`${base}/#day/8`)
  await page.getByRole('button', { name: 'AI review', exact: true }).click()
  await page.getByRole('button', { name: 'Copy rubric prompt', exact: true }).click()
  prompt = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(prompt.includes(JSON.stringify(fillerLesson)))
  assert.ok(!prompt.includes(gestureLesson))
  const shape = JSON.parse(prompt.split('JSON structure:\n')[1])
  assert.equal(Object.keys(shape.audioScores).length, 7)
  assert.equal(Object.keys(shape.visualScores).length, 5)
  console.log(
    'PASS per-day lesson, week/day label, independent speaking topic, persistence and contextual 12-criterion prompts',
  )
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('Clipboard unavailable in fixture')
        },
      },
    }),
  )
  await page.getByRole('button', { name: 'Copy rubric prompt', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.ok(
    (await page.getByLabel('AI response (JSON)').inputValue()).includes(
      JSON.stringify(fillerLesson),
    ),
  )
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Backups & import', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const file = await download
  const backup = JSON.parse(await readFile(await file.path(), 'utf8'))
  assert.equal(backup.entries[7].bootcampLesson, fillerLesson)
  assert.equal(backup.entries[8].bootcampLesson, gestureLesson)
  assert.ok(!Object.hasOwn(backup.entries[0], 'bootcampLesson'))
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'Notebook', exact: true }).click()
  await page.getByLabel('Search your notes', { exact: true }).fill('Fixing filler words')
  assert.equal(await page.getByRole('article').count(), 1)
  console.log(
    'PASS clipboard fallback, backup preservation, old-entry compatibility and notebook search',
  )
  await page.goto(`${base}/#day/8`)
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(
    a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(
    () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await context.route('**/api/public-journal', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        title: 'Bootcamp journal fixture',
        entries: [backup.entries[7]],
        publishedAt: new Date().toISOString(),
      },
    }),
  )
  const visitor = await context.newPage()
  await visitor.goto(`${base}/view#day/8`)
  await visitor.getByText(fillerLesson, { exact: true }).waitFor()
  assert.equal(await visitor.locator('input, textarea').count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'PASS lesson panel accessibility, mobile layout and read-only lesson display in the shared journal',
  )
} finally {
  await browser.close()
}
