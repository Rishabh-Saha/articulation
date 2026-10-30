import assert from 'node:assert/strict'

// Run against `npm run dev:worker` with analysis disabled and no provider secrets.
const base = process.env.WORKER_URL || 'http://127.0.0.1:8787'
const home = await fetch(`${base}/`)
assert.equal(home.status, 200)
assert.match(home.headers.get('content-type') || '', /text\/html/)
const html = await home.text()
assert.match(html, /<div id="root"><\/div>/)
assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/)
console.log('PASS Worker serves the built app with its security headers')

const script = html.match(/src="([^"]+\.js)"/)?.[1]
assert.ok(script, 'Built app must reference a JavaScript asset')
const asset = await fetch(new URL(script, base))
assert.equal(asset.status, 200)
assert.match(asset.headers.get('content-type') || '', /javascript/)
console.log('PASS Worker serves the built JavaScript assets')

const analysis = await fetch(`${base}/api/analyze`, {
  method: 'POST',
  headers: { Origin: base },
})
assert.equal(analysis.status, 503)
assert.match(analysis.headers.get('content-type') || '', /application\/json/)
assert.equal(analysis.headers.get('cache-control'), 'no-store')
assert.match((await analysis.json()).error, /Automatic analysis setup is incomplete/)
console.log('PASS analysis reaches executable backend and stays disabled without configuration')

for (const path of ['/api', '/api/missing', '/api/analyze/extra']) {
  const response = await fetch(`${base}${path}`, {
    // A navigation must also reach the API, never the SPA fallback.
    headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
  })
  assert.equal(response.status, 404)
  assert.match(response.headers.get('content-type') || '', /application\/json/)
  assert.equal((await response.json()).error, 'Unknown API endpoint.')
}
console.log('PASS unknown API paths return JSON errors even for browser navigation')

const fallback = await fetch(`${base}/notebook`, {
  headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
})
assert.equal(fallback.status, 200)
assert.match(await fallback.text(), /<div id="root"><\/div>/)
console.log('PASS app navigation keeps the static site fallback')
console.log('5 local Worker runtime checks passed. No deployment or live AI calls were made.')
