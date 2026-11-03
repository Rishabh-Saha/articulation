import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
let enabled = false
let published = null
let contentHash = null
let syncs = 0
const status = () => ({
  enabled,
  title: published?.title || 'My speaking journal',
  publishedAt: published?.publishedAt || null,
  contentHash,
})
// API fixtures exercise the real React control and view; server tests separately verify signed owner tokens and persisted SQLite state.
await context.route('**/api/sharing', async (route) => {
  if (route.request().headers().authorization !== 'Bearer owner-browser-fixture')
    return route.fulfill({ status: 401, json: { error: 'Owner sign-in required' } })
  if (route.request().method() === 'PUT') {
    const body = route.request().postDataJSON()
    enabled = body.enabled
    if (enabled) {
      published = { ...body.publication, publishedAt: new Date().toISOString() }
      contentHash = null
    }
  }
  await route.fulfill({ json: status() })
})
await context.route('**/api/public-journal', async (route) => {
  if (route.request().method() === 'GET')
    return enabled
      ? route.fulfill({ json: published })
      : route.fulfill({ status: 404, json: { error: 'Public viewing is turned off.' } })
  if (!enabled)
    return route.fulfill({ status: 409, json: { error: 'Public viewing is turned off.' } })
  assert.equal(route.request().headers().authorization, 'Bearer owner-browser-fixture')
  published = { ...route.request().postDataJSON(), publishedAt: new Date().toISOString() }
  syncs++
  await route.fulfill({ json: status() })
})
await context.route('**/__sharing-control-test', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sharing control fixture</title></head><body><div id="fixture"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
const { default: Control } = await import('/src/SharingControl.tsx');
import { blankDay, aiPrompt, parseAiReview } from '/src/model.ts';
import '/src/styles.css';
const user = { uid: 'owner-fixture', getIdToken: async () => 'owner-browser-fixture' };
const entry = blankDay(1);
entry.topic = 'Sharing fixture'; entry.reflection.notes = 'Full notes visible to visitors';
entry.reflection.strengths = 'A clear opening'; entry.reflection.improvements = 'Slow down'; entry.reflection.tomorrowFocus = 'Leave room to pause';
entry.video.url = 'https://photos.app.goo.gl/fixture';
const review = parseAiReview(aiPrompt().split('JSON structure:\\n')[1]);
review.model = 'browser-fixture-model'; review.strengths = ['A steady pace'];
entry.aiReviews = [{ ...review, id: 'first' }, { ...review, id: 'second' }];
function Fixture() {
  const [records, setRecords] = React.useState({ 1: entry });
  const [ready, setReady] = React.useState(true);
  window.changeNotes = (notes) => setRecords((current) => ({ 1: { ...current[1], reflection: { ...current[1].reflection, notes } } }));
  window.confirmSaved = setReady;
  return React.createElement(Control, { user, records, ready, open: true, close: () => {}, show: () => {} });
}
ReactDOM.createRoot(document.getElementById('fixture')).render(React.createElement(Fixture));
</script></body></html>`,
  }),
)
const visitor = await context.newPage()
const owner = await context.newPage()
const errors = []
for (const page of [visitor, owner])
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
const visitorMutations = []
const privateRequests = []
visitor.on('request', (request) => {
  if (request.url().includes('/api/') && request.method() !== 'GET')
    visitorMutations.push(request.url())
  if (/firestore|identitytoolkit|securetoken/.test(request.url()))
    privateRequests.push(request.url())
})
try {
  await visitor.goto(`${base}/view`)
  await visitor.getByRole('heading', { name: 'Public viewing is turned off' }).waitFor()
  assert.equal(await visitor.locator('input, textarea').count(), 0)
  assert.deepEqual(await visitor.evaluate(() => Object.keys(localStorage)), [])
  console.log(
    'PASS flag off exposes no journal, editing controls, private session, or storage writes',
  )
  await owner.goto(`${base}/__sharing-control-test`)
  const toggle = owner.getByRole('switch', { name: 'Public view-only access', exact: true })
  await owner.waitForFunction(
    () =>
      document.querySelector('[role=switch]') && !document.querySelector('[role=switch]').disabled,
  )
  assert.equal(await toggle.isChecked(), false)
  await toggle.click()
  await owner.getByText(/Public copy last updated/).waitFor()
  assert.equal(enabled, true)
  assert.equal(published.entries[0].reflection.notes, 'Full notes visible to visitors')
  assert.equal(published.entries[0].aiReviews.length, 2)
  const ownerA11y = await new AxeBuilder({ page: owner })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    ownerA11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
  )
  console.log('PASS owner control enables full journal sharing and remains accessible')
  await visitor.reload()
  await visitor.getByText('Last published', { exact: false }).waitFor()
  await visitor.locator('.public-day > summary').click()
  await visitor.getByText('Full notes visible to visitors', { exact: true }).waitFor()
  assert.equal(
    await visitor.getByRole('link', { name: 'Open video', exact: true }).getAttribute('href'),
    'https://photos.app.goo.gl/fixture',
  )
  assert.equal(
    await visitor.locator('.public-section > summary').filter({ hasText: 'AI review' }).count(),
    2,
  )
  await visitor.getByRole('link', { name: 'Notes & reflections', exact: true }).click()
  await visitor.getByText('Leave room to pause', { exact: true }).waitFor()
  await visitor.getByRole('link', { name: 'Progress', exact: true }).click()
  await visitor.getByRole('heading', { name: 'Your practice, in perspective' }).waitFor()
  const publicA11y = await new AxeBuilder({ page: visitor })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    publicA11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
  )
  await mkdir('test-results', { recursive: true })
  await visitor.screenshot({ path: 'test-results/public-journal-desktop.png', fullPage: true })
  await visitor.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  )
  await visitor.screenshot({ path: 'test-results/public-journal-mobile.png', fullPage: true })
  console.log(
    'PASS visitors can browse notes, reviews, video links and progress without login or editing',
  )
  await owner.evaluate(() => window.confirmSaved(false))
  const previousSyncs = syncs
  await owner.evaluate(() => window.changeNotes('Updated after a confirmed save'))
  await owner.waitForTimeout(1300)
  assert.equal(syncs, previousSyncs)
  const synced = owner.waitForResponse(
    (r) => r.url().endsWith('/api/public-journal') && r.request().method() === 'PUT',
  )
  await owner.evaluate(() => window.confirmSaved(true))
  await synced
  assert.equal(published.entries[0].reflection.notes, 'Updated after a confirmed save')
  await owner.evaluate(() => window.confirmSaved(false))
  await toggle.click()
  await owner.waitForFunction(
    () =>
      document.querySelector('[role=switch]') && !document.querySelector('[role=switch]').checked,
  )
  assert.equal(enabled, false)
  assert.equal(published.entries[0].reflection.notes, 'Updated after a confirmed save')
  await visitor.evaluate(() => window.dispatchEvent(new Event('focus')))
  await visitor.getByRole('heading', { name: 'Public viewing is turned off' }).waitFor()
  assert.equal(
    await visitor.getByText('Full notes visible to visitors', { exact: true }).count(),
    0,
  )
  await owner.reload()
  await owner.waitForFunction(
    () =>
      document.querySelector('[role=switch]') && !document.querySelector('[role=switch]').disabled,
  )
  assert.equal(await toggle.isChecked(), false)
  assert.deepEqual(visitorMutations, [])
  assert.deepEqual(privateRequests, [])
  assert.deepEqual(await visitor.evaluate(() => Object.keys(localStorage)), [])
  assert.deepEqual(errors, [])
  console.log(
    'PASS confirmed-save updates, persistent off toggle, public revocation, and no visitor writes',
  )
} finally {
  await browser.close()
}
