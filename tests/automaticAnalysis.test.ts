import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analyzeVideo,
  analyzePhotosVideo,
  isPhotosLink,
  MAX_VIDEO_BYTES,
  validateVideo,
} from '../src/automaticAnalysis'
import { aiPrompt } from '../src/model'

class FakeRequest {
  static current: FakeRequest
  status = 200
  responseText = ''
  timeout = 0
  headers: Record<string, string> = {}
  upload = { onload: () => {} }
  onload = () => {}
  onerror = () => {}
  ontimeout = () => {}
  onabort = () => {}
  open = vi.fn()
  send = vi.fn()
  constructor() {
    FakeRequest.current = this
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  abort() {
    this.onabort()
  }
}
const file = () =>
  new File([new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])], 'day.mp4', {
    type: 'video/mp4',
  })
async function start() {
  vi.stubGlobal('XMLHttpRequest', FakeRequest)
  const controller = new AbortController()
  const onPhase = vi.fn()
  const result = analyzeVideo({
    file: file(),
    token: 'firebase-token',
    signal: controller.signal,
    onPhase,
  })
  // Local Blob validation completes asynchronously before creating the request.
  await vi.waitFor(() => expect(FakeRequest.current.send).toHaveBeenCalled())
  return { result, controller, onPhase, xhr: FakeRequest.current }
}
afterEach(() => {
  vi.unstubAllGlobals()
  FakeRequest.current = undefined as unknown as FakeRequest
})
describe('video selection errors', () => {
  it.each(['', 'application/octet-stream'])(
    'accepts a real MP4 when the file picker reports %j as its type',
    async (type) => {
      await expect(validateVideo(new File([file()], 'day.MP4', { type }))).resolves.toBeUndefined()
    },
  )
  it('still checks the container when the MP4 type is missing', async () => {
    await expect(validateVideo(new File(['not a real video'], 'day.mp4'))).rejects.toThrow(
      'does not contain a readable MP4',
    )
  })
  it('explains the size problem separately from file format', async () => {
    const oversized = file()
    Object.defineProperty(oversized, 'size', { value: MAX_VIDEO_BYTES * 2 })
    await expect(validateVideo(oversized)).rejects.toThrow('40.0 MB; the upload limit is 20 MB')
  })
  it('explains how to handle MOV and empty files', async () => {
    await expect(
      validateVideo(new File([file()], 'day.mov', { type: 'video/quicktime' })),
    ).rejects.toThrow('This is a .MOV file. Export an MP4 copy')
    await expect(validateVideo(new File([], 'day.mp4', { type: 'video/mp4' }))).rejects.toThrow(
      'This file is empty',
    )
  })
  it('does not treat an unknown file without an MP4 extension as an MP4', async () => {
    await expect(validateVideo(new File([file()], 'unknown.bin'))).rejects.toThrow(
      'Export an MP4 copy',
    )
  })
})
describe('in-app analysis transport', () => {
  it('sends only the selected video to the same origin and reports upload/analysis states', async () => {
    const { result, onPhase, xhr } = await start()
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/analyze')
    expect(xhr.headers.Authorization).toBe('Bearer firebase-token')
    expect(xhr.headers['X-Video-Consent']).toBe('yes')
    expect(xhr.send.mock.calls[0][0]).toBeInstanceOf(File)
    const review = JSON.parse(aiPrompt().split('JSON structure:\n')[1])
    review.fileMetadata.name = 'day.mp4'
    xhr.upload.onload()
    xhr.responseText = JSON.stringify({ review })
    xhr.onload()
    expect((await result).fileMetadata.name).toBe('day.mp4')
    expect(onPhase.mock.calls.flat()).toEqual(['uploading', 'analyzing'])
  })
  it.each([401, 403, 429, 503])('stops on HTTP %i without automatic retry', async (status) => {
    const { result, xhr } = await start()
    const failed = expect(result).rejects.toThrow()
    xhr.status = status
    xhr.responseText = JSON.stringify({ error: 'upstream secret must not appear' })
    xhr.onload()
    await failed
    expect(xhr.send).toHaveBeenCalledTimes(1)
  })
  it('preserves the safe backend failure step for a 502 response', async () => {
    const { result, xhr } = await start()
    const failed = expect(result).rejects.toThrow('Quota database: check the D1 binding')
    xhr.status = 502
    xhr.responseText = JSON.stringify({
      error: 'Quota database: check the D1 binding',
      step: 'quota',
    })
    xhr.onload()
    await failed
  })
  it('rejects malformed or unrelated feedback instead of saving it', async () => {
    const { result, xhr } = await start()
    const failed = expect(result).rejects.toThrow()
    xhr.responseText = '{"review":{}}'
    xhr.onload()
    await failed
  })
  it('aborts the in-flight request when the day or account changes', async () => {
    const { result, controller } = await start()
    const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await failed
  })
  it('rejects an already cancelled request before transmitting video', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeRequest)
    const controller = new AbortController()
    controller.abort()
    await expect(
      analyzeVideo({ file: file(), token: 'token', signal: controller.signal, onPhase: vi.fn() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeRequest.current).toBeUndefined()
  })
})

describe('Google Photos analysis transport', () => {
  it('uses the saved share link with explicit consent, without a local file', async () => {
    const review = JSON.parse(aiPrompt().split('JSON structure:\n')[1])
    review.fileMetadata.name = 'Google Photos video.mp4'
    const fetch = vi.fn(async () => Response.json({ review }))
    vi.stubGlobal('fetch', fetch)
    const onPhase = vi.fn()
    const photosUrl = 'https://photos.app.goo.gl/fixture'
    const result = await analyzePhotosVideo({
      photosUrl,
      token: 'firebase-token',
      signal: new AbortController().signal,
      onPhase,
    })
    expect(result.fileMetadata.name).toBe('Google Photos video.mp4')
    expect(fetch).toHaveBeenCalledWith(
      '/api/analyze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ photosUrl }),
        headers: {
          Authorization: 'Bearer firebase-token',
          'Content-Type': 'application/json',
          'X-Video-Consent': 'yes',
        },
      }),
    )
    expect(onPhase).toHaveBeenCalledWith('retrieving')
  })
  it('shows unavailable video errors and never treats the page as a review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'Google Photos did not expose this video for download.' },
          { status: 422 },
        ),
      ),
    )
    await expect(
      analyzePhotosVideo({
        photosUrl: 'https://photos.app.goo.gl/fixture',
        token: 'token',
        signal: new AbortController().signal,
        onPhase: vi.fn(),
      }),
    ).rejects.toThrow('did not expose')
  })
  it('rejects non-Photos and private-library URLs before calling the backend', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const url of [
      'https://evil.example/video',
      'https://photos.google.com/u/0/',
      'https://photos.google.com.evil.example/share/test',
    ]) {
      expect(isPhotosLink(url)).toBe(false)
      await expect(
        analyzePhotosVideo({
          photosUrl: url,
          token: 'token',
          signal: new AbortController().signal,
          onPhase: vi.fn(),
        }),
      ).rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
