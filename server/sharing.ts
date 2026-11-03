import { z } from 'zod'
import {
  publicationSchema,
  publicSnapshotSchema,
  sanitizePublication,
  publicationHash,
} from '../src/sharing'
import { verifyUser } from './analysis'
import type { AnalysisEnv } from './analysis'

export const MAX_PUBLICATION_BYTES = 1024 * 1024
const schema =
  'CREATE TABLE IF NOT EXISTS public_journal (id INTEGER PRIMARY KEY CHECK (id = 1), owner_uid TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)), payload TEXT NOT NULL, content_hash TEXT NOT NULL)'
const toggleSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), publication: publicationSchema }).strict(),
])
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
}
class ShareError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
function missingTable(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  return /no such table:\s*(?:main\.)?public_journal\b/i.test(`${message} ${cause}`)
}
async function readBody(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new ShareError(415, 'Publish a JSON journal snapshot.')
  const tooLarge = () =>
    new ShareError(
      413,
      'The public copy exceeds the 1 MiB sharing limit. Your private entries are unchanged.',
    )
  if (Number(request.headers.get('Content-Length')) > MAX_PUBLICATION_BYTES) throw tooLarge()
  if (!request.body) throw new ShareError(400, 'No journal snapshot was supplied.')
  const reader = request.body.getReader()
  let size = 0
  let raw = ''
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PUBLICATION_BYTES) {
        await reader.cancel()
        throw tooLarge()
      }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new ShareError(400, 'The journal snapshot is not valid JSON.')
  }
}
interface Row {
  enabled: number
  payload: string
  content_hash: string
}
const off = { enabled: false, title: 'My speaking journal', publishedAt: null, contentHash: null }
function status(row: Row | null) {
  if (!row) return off
  const snapshot = publicSnapshotSchema.parse(JSON.parse(row.payload))
  return {
    enabled: row.enabled === 1,
    title: snapshot.title,
    publishedAt: snapshot.publishedAt,
    contentHash: row.content_hash,
  }
}

export async function publicJournal(request: Request, env: AnalysisEnv): Promise<Response> {
  const json = (body: unknown, code = 200) => Response.json(body, { status: code, headers })
  const ownerRoute = new URL(request.url).pathname === '/api/sharing'
  try {
    if (!['GET', 'PUT'].includes(request.method))
      return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, PUT' } })
    const database = env.AI_LIMITS
    if (!database?.prepare || !env.ALLOWED_UID?.trim())
      throw new ShareError(
        503,
        'Public sharing needs the existing AI_LIMITS database binding and ALLOWED_UID setting in Cloudflare. Your private journal is unchanged.',
      )

    if (request.method === 'GET' && !ownerRoute) {
      let row: { payload: string } | null
      try {
        row = await database
          .prepare(
            'SELECT payload FROM public_journal WHERE id = 1 AND owner_uid = ? AND enabled = 1',
          )
          .bind(env.ALLOWED_UID)
          .first<{ payload: string }>()
      } catch (error) {
        if (!missingTable(error)) throw error
        row = null
      }
      if (!row) return json({ error: 'Public viewing is turned off.' }, 404)
      return json(publicSnapshotSchema.parse(JSON.parse(row.payload)))
    }

    // Only this explicitly permitted Google owner can inspect or change the persisted sharing flag.
    if (!env.APP_ORIGIN || !env.FIREBASE_PROJECT_ID)
      throw new ShareError(
        503,
        'Public sharing needs APP_ORIGIN and FIREBASE_PROJECT_ID configured in Cloudflare.',
      )
    if (
      new URL(request.url).origin !== env.APP_ORIGIN ||
      (request.method !== 'GET' && request.headers.get('Origin') !== env.APP_ORIGIN)
    )
      throw new ShareError(403, 'Change sharing from the journal’s own website.')
    const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]
    if (!bearer) throw new ShareError(401, 'Sign in as the journal owner to change public viewing.')
    try {
      await verifyUser(bearer, env)
    } catch {
      throw new ShareError(
        401,
        'Sign in with the permitted owner account to change public viewing.',
      )
    }

    if (request.method === 'GET') {
      let row: Row | null
      try {
        row = await database
          .prepare(
            'SELECT enabled, payload, content_hash FROM public_journal WHERE id = 1 AND owner_uid = ?',
          )
          .bind(env.ALLOWED_UID)
          .first<Row>()
      } catch (error) {
        if (!missingTable(error)) throw error
        row = null
      }
      return json(status(row))
    }
    const raw = await readBody(request)
    let publication
    if (ownerRoute) {
      const toggle = toggleSchema.safeParse(raw)
      if (!toggle.success)
        throw new ShareError(
          400,
          'Choose whether to enable public viewing and supply a valid full journal when enabling it.',
        )
      if (!toggle.data.enabled) {
        // Flip only the sharing flag; retain the snapshot, quota counters and all private data.
        try {
          const row = await database
            .prepare(
              'UPDATE public_journal SET enabled = 0 WHERE id = 1 AND owner_uid = ? RETURNING enabled, payload, content_hash',
            )
            .bind(env.ALLOWED_UID)
            .first<Row>()
          return json(status(row))
        } catch (error) {
          if (!missingTable(error)) throw error
          return json(off)
        }
      }
      publication = toggle.data.publication
    } else {
      const parsed = publicationSchema.safeParse(raw)
      if (!parsed.success)
        throw new ShareError(
          400,
          parsed.error.issues
            .map((i) => `${i.path.join('.') || 'journal'}: ${i.message}`)
            .join('; '),
        )
      publication = parsed.data
    }
    const sanitized = sanitizePublication(publication)
    const snapshot = { ...sanitized, publishedAt: new Date().toISOString() }
    const payload = JSON.stringify(snapshot)
    if (new TextEncoder().encode(payload).byteLength > MAX_PUBLICATION_BYTES)
      throw new ShareError(
        413,
        'The public copy exceeds the 1 MiB sharing limit. Your private entries are unchanged.',
      )
    const hash = await publicationHash(sanitized)
    if (ownerRoute) {
      if (!database.exec) throw new ShareError(503, 'The public sharing database is unavailable.')
      // A new independent table only. No Firestore rules or existing D1 tables change.
      await database.exec(schema)
      const saved = await database
        .prepare(
          'INSERT INTO public_journal (id, owner_uid, enabled, payload, content_hash) VALUES (1, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_uid = excluded.owner_uid, enabled = 1, payload = excluded.payload, content_hash = excluded.content_hash RETURNING enabled, payload, content_hash',
        )
        .bind(env.ALLOWED_UID, payload, hash)
        .first()
      if (!saved) throw Error('Publication was not confirmed')
    } else {
      // A delayed auto-update cannot turn sharing back on after the owner disables it.
      const saved = await database
        .prepare(
          'UPDATE public_journal SET payload = ?, content_hash = ? WHERE id = 1 AND owner_uid = ? AND enabled = 1 RETURNING id',
        )
        .bind(payload, hash, env.ALLOWED_UID)
        .first()
      if (!saved)
        throw new ShareError(409, 'Public viewing is turned off. This update did not enable it.')
    }
    return json({
      enabled: true,
      title: snapshot.title,
      publishedAt: snapshot.publishedAt,
      contentHash: hash,
    })
  } catch (error) {
    return json(
      {
        error:
          error instanceof ShareError
            ? error.message
            : 'Public sharing is temporarily unavailable. Your private journal is unchanged. Try again later.',
      },
      error instanceof ShareError ? error.status : 503,
    )
  }
}
