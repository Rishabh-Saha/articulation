import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { publicJournal, MAX_PUBLICATION_BYTES } from '../server/sharing'
import type { AnalysisEnv } from '../server/analysis'
import { blankDay, aiPrompt, parseAiReview } from '../src/model'
import { publicationFromRecords, publicationHash, sanitizePublication } from '../src/sharing'

let pair: CryptoKeyPair
let jwk: JsonWebKey
beforeAll(async () => {
  pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
})
afterEach(() => vi.unstubAllGlobals())
async function token(sub = 'owner', invalid = false) {
  const now = Math.floor(Date.now() / 1000)
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const raw = `${encode({ alg: 'RS256', kid: 'fixture-key' })}.${encode({ aud: 'project', iss: 'https://securetoken.google.com/project', sub, exp: now + 3600, iat: now - 1, auth_time: now - 1, firebase: { sign_in_provider: 'google.com' } })}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(raw),
  )
  return `${raw}.${invalid ? 'invalid' : Buffer.from(signature).toString('base64url')}`
}
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(
    'CREATE TABLE analysis_limits (id INTEGER PRIMARY KEY, attempts INTEGER); INSERT INTO analysis_limits VALUES (1, 2);',
  )
  const database = {
    exec: vi.fn(async (sql: string) => {
      sqlite.exec(sql)
    }),
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async <T>() =>
          (sqlite.prepare(sql).get(...(values as (string | number)[])) as T) ?? null,
      }),
    }),
  }
  const env = {
    AI_LIMITS: database,
    ALLOWED_UID: 'owner',
    FIREBASE_PROJECT_ID: 'project',
    APP_ORIGIN: 'https://journal.example',
  } satisfies AnalysisEnv
  const fetch = vi.fn(async (url: string) => {
    if (!url.includes('/jwk/'))
      throw Error('Sharing must never call an AI provider or retrieve videos')
    return Response.json({ keys: [{ ...jwk, kid: 'fixture-key' }] })
  })
  vi.stubGlobal('fetch', fetch)
  return { sqlite, database, env, fetch }
}
function publication() {
  const entry = blankDay(1)
  entry.topic = 'A public practice fixture'
  entry.reflection.notes = 'Full journal notes'
  entry.reflection.strengths = 'A clear opening'
  entry.reflection.improvements = 'Slow down'
  entry.reflection.tomorrowFocus = 'Pause'
  entry.video.url = 'https://photos.app.goo.gl/fixture'
  const review = parseAiReview(aiPrompt().split('JSON structure:\n')[1])
  entry.aiReviews = [
    { ...review, id: 'first' },
    { ...review, id: 'second' },
  ]
  return publicationFromRecords({ 1: entry }, 'My speaking journal')
}
async function request(
  path: string,
  body?: unknown,
  options: { auth?: string; origin?: string; method?: string } = {},
) {
  return new Request(`https://journal.example${path}`, {
    method: options.method || (body === undefined ? 'GET' : 'PUT'),
    headers: {
      ...(body === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            Origin: options.origin || 'https://journal.example',
          }),
      ...(options.auth ? { Authorization: `Bearer ${options.auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('public viewing database flag and owner authorization', () => {
  it('starts off, exposes no data anonymously, and never creates a table on reads', async () => {
    const { env, database, fetch } = setup()
    const response = await publicJournal(await request('/api/public-journal'), env)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.exec).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const privateStatus = await publicJournal(await request('/api/sharing'), env)
    expect(privateStatus.status).toBe(401)
  })

  it('blocks anonymous, wrong-account, forged-token, and foreign-origin mutations', async () => {
    const { env, database } = setup()
    const body = { enabled: true, publication: publication() }
    for (const auth of [undefined, await token('other-user'), await token('owner', true)]) {
      expect((await publicJournal(await request('/api/sharing', body, { auth }), env)).status).toBe(
        401,
      )
    }
    expect(
      (
        await publicJournal(
          await request('/api/sharing', body, {
            auth: await token(),
            origin: 'https://foreign.example',
          }),
          env,
        )
      ).status,
    ).toBe(403)
    expect(database.exec).not.toHaveBeenCalled()
  })

  it('persists the toggle, publishes the full journal, and blocks reads immediately when disabled', async () => {
    const { env, sqlite } = setup()
    const auth = await token()
    const original = publication()
    const before = JSON.stringify(original)
    let response = await publicJournal(
      await request('/api/sharing', { enabled: true, publication: original }, { auth }),
      env,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      enabled: true,
      contentHash: await publicationHash(original),
    })
    response = await publicJournal(await request('/api/public-journal'), env)
    const shared = await response.json()
    expect(shared.entries[0].reflection.notes).toBe('Full journal notes')
    expect(shared.entries[0].aiReviews).toHaveLength(2)
    expect(shared.entries[0].video.url).toBe(original.entries[0].video.url)
    expect(shared).not.toHaveProperty('owner_uid')
    expect(
      (await (await publicJournal(await request('/api/sharing', undefined, { auth }), env)).json())
        .enabled,
    ).toBe(true)
    expect(
      (
        await (
          await publicJournal(await request('/api/sharing', { enabled: false }, { auth }), env)
        ).json()
      ).enabled,
    ).toBe(false)
    expect((await publicJournal(await request('/api/public-journal'), env)).status).toBe(404)
    const row = sqlite.prepare('SELECT enabled, payload FROM public_journal').get()!
    expect(row.enabled).toBe(0)
    expect(JSON.parse(row.payload as string).entries[0].reflection.notes).toBe('Full journal notes')
    expect(sqlite.prepare('SELECT attempts FROM analysis_limits').get()!.attempts).toBe(2)
    expect(JSON.stringify(original)).toBe(before)
  })

  it('updates published content only while enabled and cannot reactivate a disabled journal', async () => {
    const { env, sqlite } = setup()
    const auth = await token()
    const copy = publication()
    await publicJournal(
      await request('/api/sharing', { enabled: true, publication: copy }, { auth }),
      env,
    )
    copy.entries[0].reflection.notes = 'Latest confirmed journal notes'
    expect(
      (await publicJournal(await request('/api/public-journal', copy, { auth }), env)).status,
    ).toBe(200)
    expect(
      (await (await publicJournal(await request('/api/public-journal'), env)).json()).entries[0]
        .reflection.notes,
    ).toBe('Latest confirmed journal notes')
    await publicJournal(await request('/api/sharing', { enabled: false }, { auth }), env)
    expect(
      (await publicJournal(await request('/api/public-journal', copy, { auth }), env)).status,
    ).toBe(409)
    expect(sqlite.prepare('SELECT enabled FROM public_journal').get()!.enabled).toBe(0)
    expect((await publicJournal(await request('/api/public-journal'), env)).status).toBe(404)
  })

  it('rejects invalid and oversized copies without modifying the existing public page', async () => {
    const { env } = setup()
    const auth = await token()
    const copy = publication()
    await publicJournal(
      await request('/api/sharing', { enabled: true, publication: copy }, { auth }),
      env,
    )
    copy.entries[0].self.audio.rate.score = 6
    const invalid = await publicJournal(await request('/api/public-journal', copy, { auth }), env)
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error).toContain('entries.0.self.audio.rate.score')
    const huge = new Request('https://journal.example/api/public-journal', {
      method: 'PUT',
      headers: {
        Origin: env.APP_ORIGIN,
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'a'.repeat(MAX_PUBLICATION_BYTES) }),
    })
    expect((await publicJournal(huge, env)).status).toBe(413)
    expect(
      (await (await publicJournal(await request('/api/public-journal'), env)).json()).entries[0]
        .reflection.notes,
    ).toBe('Full journal notes')
  })

  it('does not reveal a prior owner snapshot or raw database failures', async () => {
    const { env } = setup()
    await publicJournal(
      await request(
        '/api/sharing',
        { enabled: true, publication: publication() },
        { auth: await token() },
      ),
      env,
    )
    expect(
      (
        await publicJournal(await request('/api/public-journal'), {
          ...env,
          ALLOWED_UID: 'new-owner',
        })
      ).status,
    ).toBe(404)
    const broken = {
      ...env,
      AI_LIMITS: {
        prepare() {
          throw Error('D1 quota exhausted: private-value')
        },
      },
    }
    const failure = await publicJournal(await request('/api/public-journal'), broken)
    expect(failure.status).toBe(503)
    expect(await failure.text()).not.toContain('private-value')
    expect(
      (
        await publicJournal(
          await request('/api/public-journal', undefined, { method: 'POST' }),
          env,
        )
      ).status,
    ).toBe(405)
  })
})
describe('publication projection', () => {
  it('makes an independent full copy and excludes sync wrappers and unknown fields', () => {
    const original = publication()
    const extra = {
      ...original,
      entries: original.entries.map((e) => ({ ...e, privateAccessToken: 'not-a-journal-field' })),
    }
    const result = sanitizePublication(extra)
    expect(result.entries[0]).not.toHaveProperty('privateAccessToken')
    result.entries[0].reflection.notes = 'Changed copy'
    expect(original.entries[0].reflection.notes).toBe('Full journal notes')
    expect(() =>
      sanitizePublication({ ...original, entries: [original.entries[0], original.entries[0]] }),
    ).toThrow()
  })
})
