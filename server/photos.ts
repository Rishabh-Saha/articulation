// Shared Photos pages are not an official media API. Fail closed if Google changes
// their data format; never substitute an album thumbnail or guess which video to use.
export class PhotosError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export interface VideoSource {
  body: ReadableStream<Uint8Array>
  length: number
  filename: string
}
const htmlLimit = 4 * 1024 * 1024
const pageHosts = new Set(['photos.app.goo.gl', 'photos.google.com'])
export function photosShareUrl(value: unknown): URL {
  try {
    if (typeof value !== 'string' || value.length > 4096) throw Error()
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !pageHosts.has(url.hostname)
    )
      throw Error()
    if (
      url.hostname === 'photos.app.goo.gl'
        ? !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
        : !/^\/share\/[A-Za-z0-9_-]+(?:\/photo\/[A-Za-z0-9_-]+)?\/?$/.test(url.pathname)
    )
      throw Error()
    url.hash = ''
    return url
  } catch {
    throw new PhotosError(400, 'Use a Google Photos share link to this video.')
  }
}
function mediaUrl(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === 'video-downloads.googleusercontent.com' ||
      /^lh\d+\.googleusercontent\.com$/.test(url.hostname) ||
      /^(?:r{1,2}\d+---)?sn-[a-z0-9-]+\.googlevideo\.com$/.test(url.hostname)
    )
  )
    throw new PhotosError(422, 'Google Photos did not provide a supported video download.')
  return url
}
async function limitedBytes(response: Response, maximum: number) {
  const length = Number(response.headers.get('Content-Length'))
  if (length > maximum) {
    await response.body?.cancel()
    throw new PhotosError(413, 'This Google Photos video is too large. The current limit is 20 MB.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new PhotosError(422, 'Google Photos returned no video data.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum)
        throw new PhotosError(413, 'The Google Photos response exceeded the allowed size.')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
async function restrictedFetch(initial: URL, kind: 'page' | 'media') {
  let url = initial
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (kind === 'page') photosShareUrl(url.href)
    else mediaUrl(url.href)
    // No Firebase, Gemini, browser cookies, or caller-supplied headers go to Photos.
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { Accept: kind === 'page' ? 'text/html' : 'video/mp4' },
      signal: AbortSignal.timeout(30000),
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location')
      await response.body?.cancel()
      if (!location || redirects === 4) break
      url = new URL(location, url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new PhotosError(
        422,
        'This Photos link is unavailable. Enable link sharing for this video, or select its local file.',
      )
    }
    return { response, url }
  }
  throw new PhotosError(
    422,
    'Google Photos redirected too many times. Use a direct video share link.',
  )
}
// Extract JSON arrays only. Never eval page scripts or parse executable JavaScript.
export function pageMedia(html: string, page: URL): string {
  html = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join('\n')
  const records = new Map<string, string>()
  const marker = /AF_initDataCallback\(\{[\s\S]*?\bdata:\s*(?=\[)/g
  while (marker.exec(html)) {
    const start = marker.lastIndex
    let depth = 0,
      quoted = false,
      escaped = false
    let end = start
    for (; end < html.length; end++) {
      const c = html[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') quoted = false
      } else if (c === '"') quoted = true
      else if (c === '[') depth++
      else if (c === ']' && --depth === 0) {
        end++
        break
      }
    }
    marker.lastIndex = end
    let data: unknown
    try {
      data = JSON.parse(html.slice(start, end))
    } catch {
      continue
    }
    const stack: unknown[] = [data]
    while (stack.length) {
      const item = stack.pop()
      if (!Array.isArray(item)) continue
      if (
        typeof item[0] === 'string' &&
        /^AF1Q[A-Za-z0-9_-]+$/.test(item[0]) &&
        Array.isArray(item[1]) &&
        typeof item[1][0] === 'string'
      ) {
        try {
          records.set(item[0], mediaUrl(item[1][0]).href)
        } catch {
          /* unrelated metadata */
        }
      } else for (const child of item) if (Array.isArray(child)) stack.push(child)
    }
  }
  const selected = page.pathname.match(/\/photo\/([A-Za-z0-9_-]+)/)?.[1]
  const base = selected
    ? records.get(selected)
    : records.size === 1
      ? [...records.values()][0]
      : undefined
  if (!base)
    throw new PhotosError(
      422,
      records.size > 1
        ? 'This link contains several items. Share the individual video instead of the album.'
        : 'Google Photos did not expose this video for download. Use a shared individual-video link, or select the local file.',
    )
  const download = mediaUrl(base)
  // Try Google's video-download transformation. The shared-page format is
  // unofficial; require a real MP4 response, never use the thumbnail as evidence.
  download.pathname = download.pathname.replace(/=(?:w\d|h\d|s\d|d).*$/, '') + '=dv'
  return download.href
}
export async function resolvePhotosVideo(value: string, maximum: number): Promise<VideoSource> {
  const shared = photosShareUrl(value)
  const page = await restrictedFetch(shared, 'page')
  if (!page.response.headers.get('Content-Type')?.includes('text/html')) {
    await page.response.body?.cancel()
    throw new PhotosError(422, 'Google Photos did not return a shared video page.')
  }
  const html = new TextDecoder().decode(await limitedBytes(page.response, htmlLimit))
  const download = pageMedia(html, page.url)
  const { response } = await restrictedFetch(mediaUrl(download), 'media')
  if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'video/mp4') {
    await response.body?.cancel()
    throw new PhotosError(
      422,
      'This shared item is not a downloadable MP4 video. A preview image cannot be used for AI review.',
    )
  }
  const length = Number(response.headers.get('Content-Length'))
  if (Number.isSafeInteger(length) && length >= 12 && length <= maximum && response.body) {
    return { body: response.body, length, filename: 'Google Photos video.mp4' }
  }
  // Most responses stream directly. Without a length, buffer only up to the cap
  // because Gemini's resumable start request requires a known byte count.
  const bytes = await limitedBytes(response, maximum)
  if (bytes.length < 12) throw new PhotosError(422, 'Google Photos returned an empty video.')
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    length: bytes.length,
    filename: 'Google Photos video.mp4',
  }
}
export async function readPhotosRequest(request: Request) {
  const bytes = await limitedBytes(new Response(request.body), 8192)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new PhotosError(400, 'Invalid video-link request.')
  }
  return photosShareUrl(
    value && typeof value === 'object' && 'photosUrl' in value ? value.photosUrl : undefined,
  ).href
}
