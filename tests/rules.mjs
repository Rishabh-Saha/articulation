import { readFile } from 'node:fs/promises'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import assert from 'node:assert/strict'

const host = process.env.FIRESTORE_EMULATOR_HOST
assert.ok(
  host,
  'Start a Firestore emulator and set FIRESTORE_EMULATOR_HOST; this test never contacts production.',
)
const [hostname, port] = host.split(':')
const env = await initializeTestEnvironment({
  projectId: 'demo-articulation',
  firestore: {
    host: hostname,
    port: Number(port),
    rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  },
})
const rating = () => ({ score: null, notes: '' })
const entry = () => ({
  day: 1,
  date: '',
  topic: 'Security check',
  video: { provider: 'google_photos', url: '' },
  self: {
    audio: Object.fromEntries(
      ['rate', 'volume', 'pitch', 'pauses', 'endings', 'clarity', 'fillers'].map((k) => [
        k,
        rating(),
      ]),
    ),
    visual: Object.fromEntries(
      ['posture', 'gestures', 'face', 'nerves', 'presence'].map((k) => [k, rating()]),
    ),
    eyeContact: '',
    headMovement: '',
  },
  reflection: { strengths: '', improvements: '', tomorrowFocus: '' },
  aiReviews: [],
  externalFeedback: [],
  completed: false,
  updatedAt: new Date().toISOString(),
})
const payload = (value = entry(), revision = 1) => ({
  entry: value,
  revision,
  lastMutation: crypto.randomUUID(),
  updatedAt: serverTimestamp(),
})
let count = 0
async function check(name, fn) {
  await fn()
  count++
  console.log(`PASS ${name}`)
}
try {
  await env.clearFirestore()
  const alice = env
    .authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } })
    .firestore()
  const bob = env
    .authenticatedContext('bob', { firebase: { sign_in_provider: 'google.com' } })
    .firestore()
  const anon = env.unauthenticatedContext().firestore()
  const otherProvider = env
    .authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous' } })
    .firestore()
  await check('owner can create a valid day', () =>
    assertSucceeds(setDoc(doc(alice, 'users/alice/days/1'), payload())),
  )
  await check('owner can read their day', () =>
    assertSucceeds(getDoc(doc(alice, 'users/alice/days/1'))),
  )
  await check('another user cannot read it', () =>
    assertFails(getDoc(doc(bob, 'users/alice/days/1'))),
  )
  await check('another user cannot write it', () =>
    assertFails(setDoc(doc(bob, 'users/alice/days/1'), payload(entry(), 2))),
  )
  await check('unsigned caller cannot read it', () =>
    assertFails(getDoc(doc(anon, 'users/alice/days/1'))),
  )
  await check('anonymous provider is not authorized', () =>
    assertFails(getDoc(doc(otherProvider, 'users/alice/days/1'))),
  )
  await check('scores outside 1–5 are rejected', () => {
    const e = entry()
    e.self.audio.rate.score = 6
    return assertFails(setDoc(doc(alice, 'users/alice/days/1'), payload(e, 2)))
  })
  await check('mismatched day path is rejected', () =>
    assertFails(setDoc(doc(alice, 'users/alice/days/2'), payload())),
  )
  await check('days outside the challenge are rejected', () => {
    const e = entry()
    e.day = 43
    return assertFails(setDoc(doc(alice, 'users/alice/days/43'), payload(e)))
  })
  await check('unknown fields are rejected', () =>
    assertFails(setDoc(doc(alice, 'users/alice/days/1'), { ...payload(entry(), 2), admin: true })),
  )
  await check('stale revision is rejected', () =>
    assertFails(setDoc(doc(alice, 'users/alice/days/1'), payload(entry(), 1))),
  )
  await check('unsafe video scheme is rejected', () => {
    const e = entry()
    e.video.url = 'javascript:alert(1)'
    return assertFails(setDoc(doc(alice, 'users/alice/days/1'), payload(e, 2)))
  })
  await check('valid next revision is accepted', () =>
    assertSucceeds(setDoc(doc(alice, 'users/alice/days/1'), payload(entry(), 2))),
  )
  await check('a fully scored entry and legacy estimate are accepted', () => {
    const e = entry()
    for (const group of [e.self.audio, e.self.visual])
      for (const key of Object.keys(group)) group[key] = { score: 5, notes: 'Specific evidence' }
    e.legacyAi = { score: 2.83, notes: 'Imported notes' }
    e.reflection.notes = 'Notes from the common notebook'
    return assertSucceeds(setDoc(doc(alice, 'users/alice/days/1'), payload(e, 3)))
  })
  await check('the owner cannot accidentally delete a day', () =>
    assertFails(deleteDoc(doc(alice, 'users/alice/days/1'))),
  )
  console.log(`${count} Firestore rules checks passed.`)
} finally {
  await env.cleanup()
}
