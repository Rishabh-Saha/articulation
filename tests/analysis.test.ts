import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { analyze, configured, MAX_VIDEO_BYTES, verifyUser } from '../server/analysis'
import type { AnalysisEnv } from '../server/analysis'
import { aiPrompt } from '../src/model'
import { validateVideo } from '../src/automaticAnalysis'

let pair: CryptoKeyPair
let jwk: JsonWebKey
const now = Math.floor(Date.now() / 1000)
const claims = {
  aud: 'project',
  iss: 'https://securetoken.google.com/project',
  sub: 'owner',
  exp: now + 3600,
  iat: now - 5,
  auth_time: now - 5,
  firebase: { sign_in_provider: 'google.com' },
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
async function token(changes = {}, wrongSignature = false) {
  const payload = `${encode({ alg: 'RS256', kid: 'key' })}.${encode({ ...claims, ...changes })}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    pair.privateKey,
    new TextEncoder().encode(payload),
  )
  return `${payload}.${wrongSignature ? 'invalid' : Buffer.from(signature).toString('base64url')}`
}
function environment() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'))
  return {
    AI_ENABLED: 'true',
    FREE_TIER_CONFIRMED: 'true',
    GEMINI_MODEL: 'test-free-model',
    GEMINI_API_KEY: 'server-secret',
    FIREBASE_PROJECT_ID: 'project',
    ALLOWED_UID: 'owner',
    APP_ORIGIN: 'https://journal.example',
    AI_LIMITS: {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => ({
          first: async <T>() =>
            (db.prepare(sql).get(...(values as (string | number)[])) as T) ?? null,
        }),
      }),
    },
  } satisfies AnalysisEnv
}
function mp4() {
  return new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])
}
async function request(headers = {}, body = mp4()) {
  return new Request('https://journal.example/api/analyze', {
    method: 'POST',
    headers: {
      Origin: 'https://journal.example',
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'video/mp4',
      'X-Video-Consent': 'yes',
      'X-Video-Size': String(body.length),
      'X-Video-Name': 'day-1.mp4',
      ...headers,
    },
    body,
  })
}
function providerMock(options: { invalid?: boolean; quota?: boolean; cleanupFail?: boolean } = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/jwk/')) return Response.json({ keys: [{ ...jwk, kid: 'key' }] })
    if (url.includes('/upload/v1beta/files'))
      return new Response(null, {
        headers: {
          'X-Goog-Upload-URL': 'https://generativelanguage.googleapis.com/upload/session',
        },
      })
    if (url.endsWith('/upload/session')) {
      const bytes = await new Response(init?.body).arrayBuffer()
      expect(new Uint8Array(bytes)).toEqual(mp4())
      return Response.json({
        file: {
          name: 'files/temp',
          uri: 'https://generativelanguage.googleapis.com/v1beta/files/temp',
          state: 'ACTIVE',
        },
      })
    }
    if (init?.method === 'DELETE')
      return new Response(null, { status: options.cleanupFail ? 500 : 200 })
    if (url.includes(':generateContent')) {
      if (options.quota) return new Response(null, { status: 429 })
      // The prompt's JSON shape is explicitly a fixture; never inserted into a journal.
      const review = JSON.parse(aiPrompt().split('JSON structure:\n')[1])
      review.model = 'untrusted model'
      review.fileMetadata.name = 'wrong.mp4'
      return Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: options.invalid ? '{}' : JSON.stringify(review) }] },
          },
        ],
      })
    }
    throw Error(`Unexpected request ${url}`)
  })
}
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
describe('authenticated free-only video endpoint', () => {
  it('fails closed when not explicitly configured without making provider calls', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(configured({})).toBeFalsy()
    const response = await analyze(await request(), {}, () => {})
    expect(response.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('identifies missing settings without leaking existing secret or identity values', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const env = environment()
    env.AI_ENABLED = 'false'
    env.FREE_TIER_CONFIRMED = ''
    const response = await analyze(await request(), env, () => {})
    const result = await response.json()
    expect(result.missingConfiguration).toEqual(['AI_ENABLED', 'FREE_TIER_CONFIRMED'])
    expect(result.error).toContain('AI_ENABLED, FREE_TIER_CONFIRMED')
    expect(JSON.stringify(result)).not.toContain('server-secret')
    expect(JSON.stringify(result)).not.toContain('owner')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('verifies real JWT signatures and rejects wrong claims, expiry, providers and forged tokens', async () => {
    vi.stubGlobal('fetch', providerMock())
    await expect(verifyUser(await token(), environment())).resolves.toBeUndefined()
    for (const change of [
      { aud: 'other' },
      { iss: 'other' },
      { sub: 'intruder' },
      { exp: now - 1 },
      { iat: now + 300 },
      { auth_time: now + 300 },
      { firebase: { sign_in_provider: 'anonymous' } },
    ]) {
      await expect(verifyUser(await token(change), environment())).rejects.toThrow()
    }
    await expect(verifyUser(await token({}, true), environment())).rejects.toThrow()
  })
  it('rejects foreign origins, missing consent, incorrect MIME and oversize before uploading', async () => {
    const fetch = providerMock()
    vi.stubGlobal('fetch', fetch)
    for (const [headers, status] of [
      [{ Origin: 'https://evil.example' }, 403],
      [{ 'X-Video-Consent': 'no' }, 400],
      [{ 'Content-Type': 'text/html' }, 415],
      [{ 'X-Video-Size': String(MAX_VIDEO_BYTES + 1) }, 413],
    ] as const) {
      expect((await analyze(await request(headers), environment(), () => {})).status).toBe(status)
    }
    expect(fetch.mock.calls.every(([url]) => String(url).includes('/jwk/'))).toBe(true)
  })
  it('streams a file, validates the rubric, records trusted provenance, and deletes temporary media', async () => {
    const fetch = providerMock()
    vi.stubGlobal('fetch', fetch)
    const response = await analyze(await request(), environment(), () => {})
    expect(response.status).toBe(200)
    const { review } = await response.json()
    expect(review.model).toBe('test-free-model')
    expect(review.fileMetadata.name).toBe('day-1.mp4')
    expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
    expect(JSON.stringify(review).includes('server-secret')).toBe(false)
  })
  it('handles fragmented headers without buffering the complete video', async () => {
    vi.stubGlobal('fetch', providerMock())
    const original = await request()
    const bytes = mp4()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 3))
        controller.enqueue(bytes.subarray(3, 7))
        controller.enqueue(bytes.subarray(7))
        controller.close()
      },
    })
    const streamed = new Request(original.url, {
      method: 'POST',
      headers: original.headers,
      body,
      ...{ duplex: 'half' },
    })
    expect((await analyze(streamed, environment(), () => {})).status).toBe(200)
  })
  it('fails closed if quota storage is unavailable', async () => {
    const fetch = providerMock()
    vi.stubGlobal('fetch', fetch)
    const env = environment()
    env.AI_LIMITS.prepare = () => {
      throw Error('database unavailable')
    }
    expect((await analyze(await request(), env, () => {})).status).toBe(502)
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/upload/'))).toBe(false)
  })
  it('retrieves a shared Photos video through the authenticated capped pipeline', async () => {
    const provider = providerMock()
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://photos.app.goo.gl/fixture')
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://photos.google.com/share/fixture?key=fixture' },
        })
      if (url.startsWith('https://photos.google.com/share/'))
        return new Response(
          `<script>AF_initDataCallback({key:'ds:1',data:[null,[["AF1Qvideo",["https://lh3.googleusercontent.com/fixture",1920,1080],1,null,null,1]]],sideChannel:{}});</script>`,
          { headers: { 'Content-Type': 'text/html' } },
        )
      if (url === 'https://lh3.googleusercontent.com/fixture=dv') {
        expect(init?.headers).toEqual({ Accept: 'video/mp4' })
        return new Response(mp4(), {
          headers: { 'Content-Type': 'video/mp4', 'Content-Length': '12' },
        })
      }
      return provider(input, init)
    })
    vi.stubGlobal('fetch', fetch)
    const initial = await request()
    const linkedHeaders = new Headers(initial.headers)
    linkedHeaders.set('Content-Type', 'application/json')
    const linked = new Request(initial.url, {
      method: 'POST',
      headers: linkedHeaders,
      body: JSON.stringify({ photosUrl: 'https://photos.app.goo.gl/fixture' }),
    })
    const response = await analyze(linked, environment(), () => {})
    expect(response.status).toBe(200)
    expect((await response.json()).review.fileMetadata.name).toBe('Google Photos video.mp4')
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
  })
  it('uses actual atomic SQLite quotas to block a second immediate request', async () => {
    const fetch = providerMock()
    vi.stubGlobal('fetch', fetch)
    const env = environment()
    expect((await analyze(await request(), env, () => {})).status).toBe(200)
    expect((await analyze(await request(), env, () => {})).status).toBe(429)
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes(':generateContent')),
    ).toHaveLength(1)
  })
  it('enforces three attempts per UTC day, with failed attempts also counted', async () => {
    vi.stubGlobal('fetch', providerMock({ quota: true }))
    const env = environment()
    for (let count = 0; count < 3; count++) {
      // Move only the persisted minute gate, retaining the day and attempt count.
      await env.AI_LIMITS.prepare('UPDATE analysis_limits SET last_started = 0 RETURNING attempts')
        .bind()
        .first()
      expect((await analyze(await request(), env, () => {})).status).toBe(429)
    }
    await env.AI_LIMITS.prepare('UPDATE analysis_limits SET last_started = 0 RETURNING attempts')
      .bind()
      .first()
    const response = await analyze(await request(), env, () => {})
    expect((await response.json()).error).toContain('three per UTC day')
  })
  it.each([{ invalid: true }, { quota: true }, { cleanupFail: true }])(
    'does not return a review on failure and attempts cleanup: %j',
    async (options) => {
      const fetch = providerMock(options)
      vi.stubGlobal('fetch', fetch)
      const tasks: Promise<unknown>[] = []
      const response = await analyze(await request(), environment(), (task) => tasks.push(task))
      await Promise.all(tasks)
      expect(response.status).toBe(options.quota ? 429 : 502)
      expect((await response.json()).review).toBeUndefined()
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    },
  )
  it('rejects a renamed non-video and mismatched stream sizes', async () => {
    vi.stubGlobal('fetch', providerMock())
    expect(
      (await analyze(await request({}, new Uint8Array(12)), environment(), () => {})).status,
    ).toBeGreaterThanOrEqual(400)
    expect(
      (await analyze(await request({ 'X-Video-Size': '13' }), environment(), () => {})).status,
    ).toBeGreaterThanOrEqual(400)
  })
})
describe('local video checks', () => {
  it('accepts MP4 containers and rejects empty, renamed and wrong-type files', async () => {
    await expect(
      validateVideo(new File([mp4()], 'day.mp4', { type: 'video/mp4' })),
    ).resolves.toBeUndefined()
    for (const file of [
      new File([], 'empty.mp4', { type: 'video/mp4' }),
      new File([new Uint8Array(12)], 'fake.mp4', { type: 'video/mp4' }),
      new File([mp4()], 'bad.txt', { type: 'text/plain' }),
    ])
      await expect(validateVideo(file)).rejects.toThrow()
  })
})
