import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const context = await browser.newContext()
const page = await context.newPage()
const base = process.env.APP_URL || 'http://127.0.0.1:5173'
let count = 0
async function check(name) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
    [],
    name,
  )
  count++
  console.log(`PASS accessibility: ${name}`)
}
try {
  await page.goto(`${base}/#journal`)
  await check('desktop journal')
  await page.goto(`${base}/#day/1`)
  await check('desktop self review')
  await page.getByRole('button', { name: 'Reflection', exact: true }).click()
  await check('reflection')
  await page.getByRole('button', { name: 'AI review', exact: true }).click()
  await check('AI review')
  await page.getByRole('button', { name: 'Outside feedback', exact: true }).click()
  await check('outside feedback')
  await page.getByRole('button', { name: 'Backups & import', exact: true }).click()
  await check('backup dialog')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.goto(`${base}/#progress`)
  await check('progress')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  await page.goto(`${base}/#journal`)
  await check('mobile journal')
  await page.goto(`${base}/#day/1`)
  await check('mobile review')
  console.log(
    `${count} accessibility scans passed. Automated scanning does not replace manual accessibility testing.`,
  )
} finally {
  await browser.close()
}
