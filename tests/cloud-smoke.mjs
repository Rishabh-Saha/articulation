import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
})
const first = await browser.newContext()
const second = await browser.newContext()
const a = await first.newPage()
const b = await second.newPage()
const errors = []
for (const page of [a, b]) page.on('pageerror', (error) => errors.push(error.message))
const base = process.env.APP_URL || 'http://127.0.0.1:5174'
async function signedIn(page) {
  await page.goto(`${base}/#day/1`)
  await page.evaluate(async () => {
    const { auth } = await import('/src/firebase.ts')
    const { signInWithCredential, GoogleAuthProvider } =
      await import('/node_modules/.vite/deps/firebase_auth.js')
    const claims = {
      sub: 'articulation-cloud-test',
      email: 'cloud-test@example.com',
      email_verified: true,
      name: 'Cloud Test',
      iss: 'https://accounts.google.com',
      aud: 'demo-articulation',
    }
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify(claims)))
  })
  await page.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
}
async function waitValue(page, value) {
  await page.waitForFunction(
    (v) => document.querySelector('input[maxlength="500"]')?.value === v,
    value,
  )
}
try {
  await signedIn(a)
  await a.getByRole('textbox', { name: 'What’s the topic?' }).fill('Saved in browser A')
  await a.getByRole('button', { name: 'Reflection', exact: true }).click()
  await a
    .getByLabel('Notes for today', { exact: true })
    .fill('My daily notes travel with my account.')
  await a.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
  await signedIn(b)
  await waitValue(b, 'Saved in browser A')
  await b.getByRole('button', { name: 'Reflection', exact: true }).click()
  assert.equal(
    await b.getByLabel('Notes for today', { exact: true }).inputValue(),
    'My daily notes travel with my account.',
  )
  console.log('PASS a second browser loads the first browser’s confirmed cloud entry')
  await first.setOffline(true)
  await a.getByRole('textbox', { name: 'What’s the topic?' }).fill('My offline draft')
  await a.getByRole('status').filter({ hasText: 'Unsaved / offline' }).waitFor()
  await b.getByRole('textbox', { name: 'What’s the topic?' }).fill('Changed in browser B')
  await b.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
  await first.setOffline(false)
  await a.getByText('Day 1 was also edited elsewhere.', { exact: true }).waitFor()
  assert.equal(
    await a.getByRole('textbox', { name: 'What’s the topic?' }).inputValue(),
    'My offline draft',
  )
  console.log('PASS offline changes survive a conflicting edit in a second browser')
  await a.getByRole('button', { name: 'Keep my draft', exact: true }).click()
  await a.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
  await waitValue(b, 'My offline draft')
  console.log('PASS explicit conflict resolution syncs the selected version across browsers')
  await a.reload()
  await waitValue(a, 'My offline draft')
  await a.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
  console.log('PASS confirmed account data restores after reload')
  // Deliberately simulate an administrator deleting a document in the local
  // demo emulator. This admin shortcut is never used by the application.
  const uid = await a.evaluate(async () => (await import('/src/firebase.ts')).auth.currentUser.uid)
  const deletion = await fetch(
    `http://127.0.0.1:8085/v1/projects/demo-articulation/databases/(default)/documents/users/${encodeURIComponent(uid)}/days/1`,
    { method: 'DELETE', headers: { Authorization: 'Bearer owner' } },
  )
  assert.equal(deletion.ok, true)
  await a.getByText('A cloud copy is missing.', { exact: true }).waitFor()
  assert.equal(
    await a.getByRole('textbox', { name: 'What’s the topic?' }).inputValue(),
    'My offline draft',
  )
  assert.equal(await a.getByRole('status').filter({ hasText: 'Saved to cloud' }).count(), 0)
  console.log(
    'PASS an unexpectedly missing cloud entry is preserved locally and never labelled saved',
  )
  await a.getByRole('button', { name: 'Restore local copies to cloud', exact: true }).click()
  await a.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
  await b.getByRole('status').filter({ hasText: 'Saved to cloud' }).waitFor()
  await a.getByRole('button', { name: 'Reflection', exact: true }).click()
  assert.equal(
    await a.getByLabel('Notes for today', { exact: true }).inputValue(),
    'My daily notes travel with my account.',
  )
  console.log(
    'PASS explicit recovery restores the cloud entry and daily notes without losing content',
  )
  assert.deepEqual(errors, [])
  console.log(
    '6 cloud browser checks passed against Auth and Firestore emulators. No live account used.',
  )
} finally {
  await browser.close()
}
