import { parseAiReview } from './model'
import type { AiReview } from './model'

export const MAX_VIDEO_BYTES = 20 * 1024 * 1024
export type AnalysisPhase = 'queued' | 'uploading' | 'analyzing' | 'retrieving'
export function videoSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
export async function validateVideo(file: File) {
  if (file.size === 0)
    throw Error('This file is empty. Download or export the original video, then select it here.')
  if (file.size > MAX_VIDEO_BYTES)
    throw Error(
      `This video is ${videoSize(file.size)}; the upload limit is 20 MB. Export a smaller MP4 copy using a lower quality setting, then select that copy. Keep your original video.`,
    )
  // Some file pickers omit the MIME type or report a generic binary type for MP4s.
  // In that case require the MP4 extension AND check the actual container below.
  const genericType = !file.type || file.type === 'application/octet-stream'
  if (file.type !== 'video/mp4' && !(genericType && /\.mp4$/i.test(file.name))) {
    const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0].toUpperCase()
    throw Error(
      `${extension ? `This is a ${extension} file.` : 'This file is not identified as an MP4 video.'} Export an MP4 copy and select it here. Renaming the file does not convert it.`,
    )
  }
  let header: Uint8Array
  try {
    header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  } catch {
    throw Error('This video could not be read. Download it to your device, then select it again.')
  }
  if (new TextDecoder().decode(header.slice(4, 8)) !== 'ftyp')
    throw Error(
      'This file does not contain a readable MP4 video. Export an MP4 copy and select it here.',
    )
}
export async function analyzeVideo({
  file,
  token,
  signal,
  onPhase,
}: {
  file: File
  token: string
  signal: AbortSignal
  onPhase: (phase: AnalysisPhase) => void
}): Promise<AiReview> {
  await validateVideo(file)
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = () => signal.removeEventListener('abort', abort)
    xhr.open('POST', '/api/analyze')
    xhr.timeout = 420000
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'video/mp4')
    xhr.setRequestHeader('X-Video-Consent', 'yes')
    xhr.setRequestHeader('X-Video-Size', String(file.size))
    xhr.setRequestHeader('X-Video-Name', encodeURIComponent(file.name))
    xhr.upload.onload = () => onPhase('analyzing')
    xhr.onload = () => {
      finish()
      try {
        const response = JSON.parse(xhr.responseText)
        if (xhr.status < 200 || xhr.status >= 300) {
          const known: Record<number, string> = {
            401: 'Sign in again with the permitted Google account.',
            403: 'This account or site is not permitted to analyze videos.',
            413: 'Choose a video up to 20 MiB.',
            429: 'Free quota or analysis limit reached. Try later or use manual review.',
            503: 'Automatic analysis is not configured. Use the manual review path below.',
          }
          throw Error(
            known[xhr.status] ??
              'Analysis failed. Nothing was saved. Try later or use manual review.',
          )
        }
        const review = parseAiReview(JSON.stringify(response.review))
        if (review.fileMetadata.name !== file.name)
          throw Error('The result does not match the selected video.')
        resolve(review)
      } catch (error) {
        reject(
          error instanceof SyntaxError
            ? Error('Analysis endpoint unavailable or returned invalid data. Use manual review.')
            : error,
        )
      }
    }
    xhr.onerror = () => {
      finish()
      reject(Error('Connection failed. Nothing was saved. Retry later or use manual review.'))
    }
    xhr.ontimeout = () => {
      finish()
      reject(Error('Analysis timed out. Nothing was saved. Retry later; attempts still count.'))
    }
    xhr.onabort = () => {
      finish()
      reject(new DOMException('Analysis cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    onPhase('uploading')
    xhr.send(file)
  })
}

export function isPhotosLink(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'photos.app.goo.gl' && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) ||
        (url.hostname === 'photos.google.com' &&
          /^\/share\/[A-Za-z0-9_-]+(?:\/photo\/[A-Za-z0-9_-]+)?\/?$/.test(url.pathname)))
    )
  } catch {
    return false
  }
}
export async function analyzePhotosVideo({
  photosUrl,
  token,
  signal,
  onPhase,
}: {
  photosUrl: string
  token: string
  signal: AbortSignal
  onPhase: (phase: AnalysisPhase) => void
}): Promise<AiReview> {
  if (!isPhotosLink(photosUrl))
    throw Error('Add a Google Photos share link to this day’s video first.')
  signal.throwIfAborted()
  onPhase('retrieving')
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Video-Consent': 'yes',
    },
    body: JSON.stringify({ photosUrl }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(420000)]),
  })
  let result
  try {
    result = await response.json()
  } catch {
    throw Error('The analysis endpoint is unavailable. No review was saved.')
  }
  if (!response.ok)
    throw Error(
      typeof result.error === 'string' && result.error.length < 1000
        ? result.error
        : 'Video retrieval or analysis failed. No review was saved.',
    )
  return parseAiReview(JSON.stringify(result.review))
}
