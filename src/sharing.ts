import { z } from 'zod'
import { daySchema, hasContent } from './model'
import type { Records } from './model'

export const publicationSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(120),
    entries: z
      .array(daySchema)
      .max(42)
      .refine(
        (entries) => new Set(entries.map((e) => e.day)).size === entries.length,
        'Each published day must be unique.',
      ),
  })
  .strict()
export const publicSnapshotSchema = publicationSchema.extend({
  publishedAt: z.string().datetime({ offset: true }),
})
export const sharingStatusSchema = z.object({
  enabled: z.boolean(),
  title: z.string(),
  publishedAt: z.string().nullable(),
  contentHash: z.string().nullable(),
})
export type Publication = z.infer<typeof publicationSchema>
export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>
export type SharingStatus = z.infer<typeof sharingStatusSchema>

// Parse into a separate copy, stripping non-journal fields such as sync wrappers and account metadata.
export function sanitizePublication(input: unknown): Publication {
  const publication = publicationSchema.parse(input)
  publication.entries.sort((a, b) => a.day - b.day)
  return publication
}
export function publicationFromRecords(records: Records, title: string) {
  return sanitizePublication({
    schemaVersion: 1,
    title,
    entries: Object.values(records).filter(hasContent),
  })
}
export function publicRecords(snapshot: Publication): Records {
  return Object.fromEntries(snapshot.entries.map((entry) => [entry.day, entry]))
}
export async function publicationHash(publication: Publication) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(sanitizePublication(publication))),
  )
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
async function responseBody(response: Response) {
  let body
  try {
    body = await response.json()
  } catch {
    throw Error(
      'Public sharing is unavailable. The executable Cloudflare backend must be deployed first.',
    )
  }
  if (!response.ok)
    throw Error(
      typeof body.error === 'string' ? body.error : 'The public journal could not be updated.',
    )
  return body
}
export async function readPublicJournal(signal?: AbortSignal): Promise<PublicSnapshot | null> {
  const response = await fetch('/api/public-journal', {
    cache: 'no-store',
    credentials: 'omit',
    signal,
  })
  if (response.status === 404) return null
  return publicSnapshotSchema.parse(await responseBody(response))
}
export async function readSharingStatus(
  token: string,
  signal?: AbortSignal,
): Promise<SharingStatus> {
  const response = await fetch('/api/sharing', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  })
  return sharingStatusSchema.parse(await responseBody(response))
}
export async function setPublicViewing(
  token: string,
  publication: Publication | null,
): Promise<SharingStatus> {
  const response = await fetch('/api/sharing', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(publication ? { enabled: true, publication } : { enabled: false }),
  })
  return sharingStatusSchema.parse(await responseBody(response))
}
export async function syncPublicJournal(
  token: string,
  publication: Publication,
  signal?: AbortSignal,
): Promise<SharingStatus> {
  const response = await fetch('/api/public-journal', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(publication),
    signal,
  })
  return sharingStatusSchema.parse(await responseBody(response))
}
