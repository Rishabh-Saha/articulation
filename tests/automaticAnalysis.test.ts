import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeVideo } from '../src/automaticAnalysis'
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
