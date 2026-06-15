/**
 * Unit tests for the web integration. Run with `npm test` (tsx --test).
 *
 * The actions call the global `fetch`, so each test stubs `globalThis.fetch`
 * with a fake Response. The headline guard is the output-contract PARITY test:
 * declared outputFields == mockExecute() keys == execute() keys, per action.
 * Nothing in integration-core enforces mock-vs-real parity today, so this is the
 * regression net that keeps the Foundry picker honest and hermetic test mode true.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import web from './index.ts'

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

type Action = (typeof web.actions)[number]

function action(id: string): Action {
  const a = web.actions.find((x) => x.id === `web.${id}`)
  if (!a) throw new Error(`no web.${id} action`)
  return a
}

const ctx = { seed: 'web-test', log: () => {}, getCredentials: () => ({ token: 't' }), http: {} } as never

interface FakeResponseInit {
  body?: string
  status?: number
  headers?: Record<string, string>
  url?: string
}

function fakeResponse({ body = '', status = 200, headers = {}, url = 'https://example.com' }: FakeResponseInit = {}): Response {
  const h = new Headers(headers)
  const enc = new TextEncoder()
  return {
    status,
    url,
    headers: h,
    text: async () => body,
    arrayBuffer: async () => enc.encode(body).buffer,
  } as unknown as Response
}

const realFetch = globalThis.fetch
let lastUrl = ''
let lastInit: RequestInit | undefined

/** Install a fetch stub that records the call and returns the given response. */
function stubFetch(resp: Response | ((url: string, init?: RequestInit) => Response)): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    lastUrl = String(input)
    lastInit = init
    return typeof resp === 'function' ? resp(String(input), init) : resp
  }) as typeof fetch
}

test.afterEach(() => {
  globalThis.fetch = realFetch
  lastUrl = ''
  lastInit = undefined
})

// ---------------------------------------------------------------------------
// C1 / C7 — output-contract parity (the headline guard)
// ---------------------------------------------------------------------------

test('output-contract parity: declared == mock == execute keys, per action', async () => {
  // api
  stubFetch(fakeResponse({ body: '{"a":1}', headers: { 'content-type': 'application/json' } }))
  const apiExec = await action('api').execute!({ url: 'https://x.test', method: 'GET' }, ctx)
  const apiMock = await action('api').mockExecute({ url: 'https://x.test' }, ctx)
  const apiDecl = (action('api').outputFields ?? []).map((f) => f.name)
  assert.deepEqual(Object.keys(apiExec).sort(), apiDecl.slice().sort(), 'api execute vs declared')
  assert.deepEqual(Object.keys(apiMock).sort(), apiDecl.slice().sort(), 'api mock vs declared')

  // scrape
  stubFetch(fakeResponse({ body: '<html><body><h1>Hi</h1></body></html>' }))
  const scrapeExec = await action('scrape').execute!({ url: 'https://x.test', selectors: { title: 'h1' } }, ctx)
  const scrapeMock = await action('scrape').mockExecute({ url: 'https://x.test' }, ctx)
  const scrapeDecl = (action('scrape').outputFields ?? []).map((f) => f.name)
  assert.deepEqual(Object.keys(scrapeExec).sort(), scrapeDecl.slice().sort(), 'scrape execute vs declared')
  assert.deepEqual(Object.keys(scrapeMock).sort(), scrapeDecl.slice().sort(), 'scrape mock vs declared')

  // fetch
  stubFetch(fakeResponse({ body: '<html><head><title>T</title></head><body>x</body></html>', headers: { 'content-type': 'text/html' } }))
  const fetchExec = await action('fetch').execute!({ url: 'https://x.test' }, ctx)
  const fetchMock = await action('fetch').mockExecute({ url: 'https://x.test' }, ctx)
  const fetchDecl = (action('fetch').outputFields ?? []).map((f) => f.name)
  assert.deepEqual(Object.keys(fetchExec).sort(), fetchDecl.slice().sort(), 'fetch execute vs declared')
  assert.deepEqual(Object.keys(fetchMock).sort(), fetchDecl.slice().sort(), 'fetch mock vs declared')
})

test('api: response headers are returned as an object (not discarded)', async () => {
  stubFetch(fakeResponse({ body: 'ok', headers: { 'content-type': 'text/plain', 'x-trace': 'abc' } }))
  const out = await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.equal((out.headers as Record<string, string>)['x-trace'], 'abc')
  assert.equal(out.content_type, 'text/plain')
})

// ---------------------------------------------------------------------------
// C2 — query merge
// ---------------------------------------------------------------------------

test('query: appended to a clean url and encoded once', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test/p', query: { q: 'a b', page: 2 } }, ctx)
  assert.equal(lastUrl, 'https://x.test/p?q=a%20b&page=2')
})

test('query: preserves an existing query string byte-for-byte and appends with &', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test/p?a=1&keep=%2F', query: { b: 2 } }, ctx)
  assert.equal(lastUrl, 'https://x.test/p?a=1&keep=%2F&b=2')
})

test('query: array value emits a repeated key', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test', query: { id: [1, 2] } }, ctx)
  assert.equal(lastUrl, 'https://x.test?id=1&id=2')
})

test('query: lands before a #fragment', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test/p#section', query: { a: 1 } }, ctx)
  assert.equal(lastUrl, 'https://x.test/p?a=1#section')
})

test('query: a non-object throws', async () => {
  stubFetch(fakeResponse())
  await assert.rejects(() => action('api').execute!({ url: 'https://x.test', query: 'a=1' }, ctx), /query.*must be an object/)
})

test('query: a nested-object value throws instead of emitting [object Object]', async () => {
  stubFetch(fakeResponse())
  await assert.rejects(
    () => action('api').execute!({ url: 'https://x.test', query: { filter: { eq: 1 } } }, ctx),
    /value for "filter".*string, number, or boolean/,
  )
})

test('query: an empty object leaves the url unchanged', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test/p', query: {} }, ctx)
  assert.equal(lastUrl, 'https://x.test/p')
})

test('query: a url ending in ? or & does not produce an empty pair', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test?', query: { a: 1 } }, ctx)
  assert.equal(lastUrl, 'https://x.test?a=1')
  await action('api').execute!({ url: 'https://x.test?a=1&', query: { b: 2 } }, ctx)
  assert.equal(lastUrl, 'https://x.test?a=1&b=2')
})

// ---------------------------------------------------------------------------
// C3 — object body
// ---------------------------------------------------------------------------

test('body: an object is sent as JSON with a default content-type', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test', method: 'POST', body: { hello: 'world' } }, ctx)
  assert.equal(lastInit?.body, '{"hello":"world"}')
  const sent = lastInit?.headers as Record<string, string>
  assert.equal(sent['Content-Type'], 'application/json')
})

test('body: an explicit content-type is not overridden', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!(
    { url: 'https://x.test', method: 'POST', body: { a: 1 }, headers: { 'content-type': 'application/vnd.api+json' } },
    ctx,
  )
  const sent = lastInit?.headers as Record<string, string>
  // the author's header wins; no second content-type key is injected
  assert.equal(sent['content-type'], 'application/vnd.api+json')
  assert.equal(sent['Content-Type'], undefined)
})

test('body: a string passes through unchanged with no auto content-type', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test', method: 'POST', body: 'raw-string' }, ctx)
  assert.equal(lastInit?.body, 'raw-string')
  const sent = (lastInit?.headers as Record<string, string>) ?? {}
  assert.equal(sent['Content-Type'], undefined)
})

test('body: rejected on GET', async () => {
  stubFetch(fakeResponse())
  await assert.rejects(() => action('api').execute!({ url: 'https://x.test', method: 'GET', body: 'x' }, ctx), /not allowed with GET/)
})

// ---------------------------------------------------------------------------
// C6 — method
// ---------------------------------------------------------------------------

test('method: a lowercase value is upcased and used', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test', method: 'post', body: 'x' }, ctx)
  assert.equal(lastInit?.method, 'POST')
})

test('method: an invalid value throws', async () => {
  stubFetch(fakeResponse())
  await assert.rejects(() => action('api').execute!({ url: 'https://x.test', method: 'TRACE' }, ctx), /method.*must be one of/)
})

test('method: declared as an enum with all valid methods', () => {
  const method = (action('api').inputFields ?? []).find((f) => f.name === 'method')
  assert.equal(method?.type, 'enum')
  assert.deepEqual((method?.options ?? []).map((o) => o.value).sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
})

// ---------------------------------------------------------------------------
// C4 — response JSON parsing
// ---------------------------------------------------------------------------

test('json: a JSON response is parsed into json while body stays the raw string', async () => {
  stubFetch(fakeResponse({ body: '{"n":42}', headers: { 'content-type': 'application/json; charset=utf-8' } }))
  const out = await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.deepEqual(out.json, { n: 42 })
  assert.equal(out.body, '{"n":42}')
})

test('json: invalid JSON with a json content-type leaves json null and never throws', async () => {
  stubFetch(fakeResponse({ body: 'not json', headers: { 'content-type': 'application/json' } }))
  const out = await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.equal(out.json, null)
  assert.equal(out.body, 'not json')
})

test('json: a non-JSON response leaves json null', async () => {
  stubFetch(fakeResponse({ body: '<html></html>', headers: { 'content-type': 'text/html' } }))
  const out = await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.equal(out.json, null)
})

test('json: a JSON array response is returned in json (declared object is advisory)', async () => {
  stubFetch(fakeResponse({ body: '[1,2,3]', headers: { 'content-type': 'application/json' } }))
  const out = await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.deepEqual(out.json, [1, 2, 3])
})

test('json: a +json structured-suffix content-type is parsed', async () => {
  stubFetch(fakeResponse({ body: '{"ok":true}', headers: { 'content-type': 'application/vnd.api+json' } }))
  const out = await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.deepEqual(out.json, { ok: true })
})

test('accept: a default Accept header is sent and is overridable', async () => {
  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test' }, ctx)
  assert.match((lastInit?.headers as Record<string, string>)['Accept'], /application\/json/)

  stubFetch(fakeResponse())
  await action('api').execute!({ url: 'https://x.test', headers: { Accept: 'text/csv' } }, ctx)
  const sent = lastInit?.headers as Record<string, string>
  assert.equal(sent['Accept'], 'text/csv')
})

// ---------------------------------------------------------------------------
// scrape + fetch behavior
// ---------------------------------------------------------------------------

test('scrape: each selector returns an array of all matches, plus url + status', async () => {
  stubFetch(
    fakeResponse({
      body: '<html><body><a class="l" href="/1">one</a><a class="l" href="/2">two</a></body></html>',
      url: 'https://x.test/final',
    }),
  )
  const out = await action('scrape').execute!(
    { url: 'https://x.test', selectors: { links: { css: 'a.l', extract: 'href' }, labels: 'a.l' } },
    ctx,
  )
  assert.deepEqual((out.results as Record<string, string[]>).links, ['/1', '/2'])
  assert.deepEqual((out.results as Record<string, string[]>).labels, ['one', 'two'])
  assert.equal(out.url, 'https://x.test/final')
  assert.equal(out.status, 200)
})

test('fetch: truncates and sets truncated when the page exceeds maxChars', async () => {
  const long = 'x'.repeat(200)
  stubFetch(fakeResponse({ body: long, headers: { 'content-type': 'text/plain' } }))
  const out = await action('fetch').execute!({ url: 'https://x.test', maxChars: 50 }, ctx)
  assert.equal(out.truncated, true)
  assert.match(out.content as string, /\[truncated at 50 chars\]/)
})

test('fetch: truncated is false for a short page', async () => {
  stubFetch(fakeResponse({ body: 'short', headers: { 'content-type': 'text/plain' } }))
  const out = await action('fetch').execute!({ url: 'https://x.test' }, ctx)
  assert.equal(out.truncated, false)
})
