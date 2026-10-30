import { afterEach, describe, expect, it, vi } from 'vitest'
import { pageMedia, photosShareUrl, readPhotosRequest, resolvePhotosVideo } from '../server/photos'

const share = 'https://photos.google.com/share/test?key=fixture'
const short = 'https://photos.app.goo.gl/fixture'
const base = 'https://lh3.googleusercontent.com/test-video'
const mp4 = new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])
const record = (id = 'AF1Qvideo', url = base) => [
  id,
  [url, 1920, 1080],
  1700000000,
  null,
  null,
  1700000000,
]
const html = (records: unknown[] = [record()]) =>
  `<html><script>AF_initDataCallback({key:'ds:1',hash:'2',data:${JSON.stringify([null, records])},sideChannel:{}});</script></html>`
afterEach(() => vi.unstubAllGlobals())
describe('Google Photos URL restrictions', () => {
  it.each([short, share, `${share.split('?')[0]}/photo/AF1Qvideo?key=fixture`])(
    'accepts a shared video page: %s',
    (url) => {
      expect(photosShareUrl(url).protocol).toBe('https:')
    },
  )
  it.each([
    'http://photos.google.com/share/test',
    'https://photos.google.com.evil.example/share/test',
    'https://user:pass@photos.google.com/share/test',
    'https://photos.google.com:8080/share/test',
    'https://photos.google.com/u/0/',
    'https://127.0.0.1/video',
    'https://photos.app.goo.gl/one/two',
    'https://evil.example/share/test',
  ])('rejects unsafe or unsupported input: %s', (value) => {
    expect(() => photosShareUrl(value)).toThrow()
  })
  it('bounds and validates the JSON body', async () => {
    expect(
      await readPhotosRequest(
        new Request('https://journal.example', {
          method: 'POST',
          body: JSON.stringify({ photosUrl: short }),
        }),
      ),
    ).toBe(short)
    for (const body of [
      'not JSON',
      JSON.stringify({ photosUrl: 'https://evil.example' }),
      ' '.repeat(8193),
    ]) {
      await expect(
        readPhotosRequest(new Request('https://journal.example', { method: 'POST', body })),
      ).rejects.toThrow()
    }
  })
})
describe('public shared page parsing', () => {
  it('reads the one selected media record, not arbitrary images on the page', () => {
    expect(pageMedia(html(), new URL(share))).toBe(`${base}=dv`)
    expect(() => pageMedia(`<img src="${base}">`, new URL(share))).toThrow()
  })
  it('requires an individual item when an album contains several records', () => {
    const album = html([record(), record('AF1Qother', `${base}-other`)])
    expect(() => pageMedia(album, new URL(share))).toThrow('several items')
    expect(
      pageMedia(album, new URL('https://photos.google.com/share/test/photo/AF1Qother?key=fixture')),
    ).toBe(`${base}-other=dv`)
    expect(() =>
      pageMedia(
        album,
        new URL('https://photos.google.com/share/test/photo/AF1Qmissing?key=fixture'),
      ),
    ).toThrow()
  })
  it('never evaluates scripts and rejects media URLs outside known Google video hosts', () => {
    expect(() =>
      pageMedia(
        '<script>AF_initDataCallback({data:(globalThis.hacked=true)});</script>',
        new URL(share),
      ),
    ).toThrow()
    expect('hacked' in globalThis).toBe(false)
    for (const url of [
      'https://evil.example/file',
      'https://127.0.0.1/file',
      'https://lh3.googleusercontent.com.evil.example/file',
      'http://lh3.googleusercontent.com/file',
    ]) {
      expect(() => pageMedia(html([record('AF1Qvideo', url)]), new URL(share))).toThrow()
    }
  })
})
describe('bounded public video retrieval', () => {
  it('follows a short link and streams only an actual MP4, without forwarding credentials', async () => {
    const fetch = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(init?.headers).toEqual({
        Accept: input.hostname === 'lh3.googleusercontent.com' ? 'video/mp4' : 'text/html',
      })
      expect(init?.redirect).toBe('manual')
      if (input.href === short)
        return new Response(null, { status: 302, headers: { Location: share } })
      if (input.href === share)
        return new Response(html(), { headers: { 'Content-Type': 'text/html' } })
      return new Response(mp4, {
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.length) },
      })
    })
    vi.stubGlobal('fetch', fetch)
    const source = await resolvePhotosVideo(short, 20 * 1024 * 1024)
    expect(source.filename).toBe('Google Photos video.mp4')
    expect(source.length).toBe(mp4.length)
    expect(new Uint8Array(await new Response(source.body).arrayBuffer())).toEqual(mp4)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('bounds media even when the server omits Content-Length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) =>
        input.hostname === 'photos.google.com'
          ? new Response(html(), { headers: { 'Content-Type': 'text/html' } })
          : new Response(new Uint8Array(100), { headers: { 'Content-Type': 'video/mp4' } }),
      ),
    )
    await expect(resolvePhotosVideo(share, 20)).rejects.toThrow('exceeded')
  })
  it('rejects thumbnail responses rather than sending an image for a video review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) =>
        input.hostname === 'photos.google.com'
          ? new Response(html(), { headers: { 'Content-Type': 'text/html' } })
          : new Response('thumbnail', { headers: { 'Content-Type': 'image/jpeg' } }),
      ),
    )
    await expect(resolvePhotosVideo(share, 100)).rejects.toThrow('preview image')
  })
  it.each([
    'https://accounts.google.com/login',
    'https://127.0.0.1/private',
    'https://evil.example/file',
  ])('does not follow a page redirect to %s', async (location) => {
    const fetch = vi.fn(
      async () => new Response(null, { status: 302, headers: { Location: location } }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(resolvePhotosVideo(short, 100)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not follow a video redirect to an arbitrary host', async () => {
    const fetch = vi.fn(async (input: URL) =>
      input.hostname === 'photos.google.com'
        ? new Response(html(), { headers: { 'Content-Type': 'text/html' } })
        : new Response(null, { status: 302, headers: { Location: 'https://evil.example/video' } }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(resolvePhotosVideo(share, 100)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
