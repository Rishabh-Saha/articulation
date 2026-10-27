import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const first = await context.newPage()
const second = await context.newPage()
const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const errors = []
for (const page of [first, second]) page.on('pageerror', (e) => errors.push(e.message))
async function enabled(page, label, value = true) {
  await page.waitForFunction(
    ({ label, value }) => {
      const node = Array.from(document.querySelectorAll('textarea')).find(
        (el) => el.getAttribute('aria-label') === label,
      )
      return node && node.matches(':disabled') !== value
    },
    { label, value },
  )
}
try {
  await first.goto(`${base}/#notes`)
  await enabled(first, 'Notes for Day 01')
  await first
    .getByLabel('Notes for Day 01', { exact: true })
    .fill('A note from the first tab. Keep this safe.')
  await second.goto(`${base}/#notes`)
  await second.getByText(/This tab is read-only while another tab edits/).waitFor()
  assert.equal(await second.getByLabel('Notes for Day 01', { exact: true }).isDisabled(), true)
  assert.equal(
    await second.getByLabel('Notes for Day 01', { exact: true }).inputValue(),
    'A note from the first tab. Keep this safe.',
  )
  console.log('PASS a second tab cannot overwrite the editing tab’s local draft')
  await first
    .getByLabel('Notes for Day 01', { exact: true })
    .fill('Updated safely in the editing tab.')
  await second.waitForFunction(
    () => document.querySelector('textarea')?.value === 'Updated safely in the editing tab.',
  )
  console.log('PASS read-only tabs receive current local drafts without writing over them')
  await second.getByRole('button', { name: 'Backups & import', exact: true }).click()
  const backup = { version: 1, records: { 2: { topic: 'Should remain a preview' } } }
  await second.getByLabel('Import backup file').setInputFiles({
    name: 'test.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  assert.equal(
    await second.getByRole('button', { name: 'Import 1 day', exact: true }).isDisabled(),
    true,
  )
  await second.getByRole('button', { name: 'Close dialog', exact: true }).click()
  console.log('PASS import remains read-only in a second tab')
  await first.close()
  await enabled(second, 'Notes for Day 01')
  await second
    .getByLabel('Notes for Day 02', { exact: true })
    .fill('The next day has its own notes.')
  await second.reload()
  await enabled(second, 'Notes for Day 01')
  assert.equal(
    await second.getByLabel('Notes for Day 01', { exact: true }).inputValue(),
    'Updated safely in the editing tab.',
  )
  assert.equal(
    await second.getByLabel('Notes for Day 02', { exact: true }).inputValue(),
    'The next day has its own notes.',
  )
  console.log('PASS closing the editor transfers editing safely and both days survive reload')
  await second
    .getByRole('article', { name: 'Day 1 notes', exact: true })
    .getByRole('button', { name: 'Open session', exact: true })
    .click()
  await second.getByRole('button', { name: 'Reflection', exact: true }).click()
  assert.equal(
    await second.getByLabel('Notes for today', { exact: true }).inputValue(),
    'Updated safely in the editing tab.',
  )
  await second
    .getByLabel('Notes for today', { exact: true })
    .fill('One shared note, visible in both views.')
  await second.getByRole('button', { name: 'Notebook', exact: true }).click()
  await second.getByLabel('Search your notes').fill('One shared note')
  assert.equal(await second.getByRole('article').count(), 1)
  assert.equal(
    await second.getByLabel('Notes for Day 01', { exact: true }).inputValue(),
    'One shared note, visible in both views.',
  )
  console.log('PASS notebook and session notes share one saved record and search across days')
  await second.getByRole('button', { name: 'Backups & import', exact: true }).click()
  const downloading = second.waitForEvent('download')
  await second.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const download = await downloading
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(exported.entries[0].reflection.notes, 'One shared note, visible in both views.')
  assert.equal(exported.entries[1].reflection.notes, 'The next day has its own notes.')
  await second.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await second.getByLabel('Search your notes').fill('')
  await mkdir('test-results', { recursive: true })
  await second.screenshot({ path: 'test-results/notebook-desktop.png', fullPage: true })
  await second.setViewportSize({ width: 390, height: 844 })
  await second.waitForTimeout(250)
  assert.equal(
    await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  )
  await second.screenshot({ path: 'test-results/notebook-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS day-by-day notes are included in backups and fit on mobile')
  console.log('6 data-safety and notebook browser checks passed.')
} finally {
  await browser.close()
}
