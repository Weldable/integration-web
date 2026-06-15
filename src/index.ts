import { defineIntegration } from '@weldable/integration-core'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_AGENT = 'Mozilla/5.0 (compatible; weldable/1.0)'
const DEFAULT_MAX_CHARS = 50_000
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

// ---------------------------------------------------------------------------
// Request helpers (shared by the api action)
// ---------------------------------------------------------------------------

/** Coerce an args `headers` object into a string->string header map. */
function toHeaderMap(raw: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  if (raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      headers[String(k)] = String(v)
    }
  }
  return headers
}

/**
 * Merge a `query` object into a URL without disturbing anything already there.
 *
 * The existing query string on `url` is preserved byte-for-byte (we never
 * re-serialize it, so a value the author already encoded — e.g. `%2F` — stays
 * exactly as written). Structured params are appended: each value is encoded
 * once, an array value emits a repeated key, and a `#fragment` is kept at the
 * end. We do not strip or dedupe the URL's own params, so an author who already
 * hand-built `?a=1` keeps working and simply gets the structured params added.
 * On a duplicate key both values are sent (`?a=1&a=2`); which one a server
 * honors is server-dependent, so we do not promise a precedence.
 *
 * Values must be scalars (string/number/boolean) or an array of scalars. A
 * nested object/array value throws rather than serializing to `[object Object]`.
 */
function mergeQuery(url: string, rawQuery: unknown): string {
  if (rawQuery === null || rawQuery === undefined) return url
  if (typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
    throw new Error('api: "query" must be an object of key-value pairs')
  }

  const encodePair = (key: string, v: unknown): string => {
    if (typeof v === 'object') {
      throw new Error(`api: "query" value for "${key}" must be a string, number, or boolean`)
    }
    return `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`
  }

  const parts: string[] = []
  for (const [k, v] of Object.entries(rawQuery as Record<string, unknown>)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === null || item === undefined) continue
        parts.push(encodePair(k, item))
      }
    } else {
      parts.push(encodePair(k, v))
    }
  }
  if (parts.length === 0) return url

  const qs = parts.join('&')
  // Keep the appended query before any #fragment.
  const hashIdx = url.indexOf('#')
  const base = hashIdx === -1 ? url : url.slice(0, hashIdx)
  const fragment = hashIdx === -1 ? '' : url.slice(hashIdx)
  // Join cleanly: a URL ending in `?` or `&` appends directly (no empty pair),
  // an existing query gets `&`, otherwise start the query with `?`.
  const sep = base.endsWith('?') || base.endsWith('&') ? '' : base.includes('?') ? '&' : '?'
  return `${base}${sep}${qs}${fragment}`
}

/**
 * Resolve the request body. A string is sent verbatim. An object or array is
 * sent as JSON, and we default `Content-Type: application/json` unless the
 * author already set a content-type header (so an explicit content-type always
 * wins). Mutates `headers` to add the default content-type when applicable.
 */
function resolveBody(raw: unknown, headers: Record<string, string>): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')
    if (!hasContentType) headers['Content-Type'] = 'application/json'
    return JSON.stringify(raw)
  }
  throw new Error('api: "body" must be a string, or an object/array to send as JSON')
}

export default defineIntegration({
  id: 'web',
  name: 'Web',
  description: 'Make HTTP requests, scrape web pages, and fetch readable content.',
  icon: 'web',
  version: 1,
  auth: { type: 'none' },
  exampleUsage: 'Look up the current price of Bitcoin',
  actions: [
    {
      actionId: 'api',
      name: 'HTTP request',
      description: 'Make an HTTP request to any URL and return the response.',
      intents: [
        'call an API',
        'make an HTTP request',
        'fetch from a URL',
        'hit an endpoint',
        'send a GET request',
        'call a REST API',
        'make a web request',
        'query an endpoint',
        'POST to a webhook',
        'fetch JSON from a URL',
      ],
      preview: '{method|GET} {url}',
      inputFields: [
        {
          name: 'url',
          type: 'string',
          required: true,
          description: 'The target URL.',
        },
        {
          name: 'method',
          type: 'enum',
          required: false,
          description: 'HTTP method.',
          default: 'GET',
          options: [
            { label: 'GET', value: 'GET' },
            { label: 'POST', value: 'POST' },
            { label: 'PUT', value: 'PUT' },
            { label: 'PATCH', value: 'PATCH' },
            { label: 'DELETE', value: 'DELETE' },
          ],
        },
        {
          name: 'query',
          type: 'object',
          required: false,
          description:
            'Query parameters as key-value pairs. Appended to the URL and encoded for you, so do not also pre-encode the values.',
        },
        {
          name: 'headers',
          type: 'object',
          required: false,
          description: 'Custom HTTP headers as key-value pairs.',
        },
        {
          name: 'body',
          type: 'text',
          required: false,
          description:
            'Request body. Provide a string, or an object to send as JSON (content-type is set for you unless you set one). Not allowed with GET requests.',
        },
      ],
      outputFields: [
        { name: 'status', type: 'number', description: 'HTTP status code of the response.' },
        {
          name: 'body',
          type: 'string',
          description: 'Response body as a string (JSON responses are returned as a JSON string).',
        },
        {
          name: 'json',
          type: 'object',
          description:
            'Response body parsed as JSON when the response is JSON, otherwise null (a JSON array or value is returned here too). The raw string is always in body.',
        },
        { name: 'headers', type: 'object', description: 'Response headers as key-value pairs.' },
        { name: 'url', type: 'string', description: 'Final URL after any redirects.' },
        { name: 'content_type', type: 'string', description: 'Response content type, from the content-type header.' },
      ],
      mockExecute: async (args, _ctx) => ({
        status: 200,
        body: '{}',
        json: {},
        headers: { 'content-type': 'application/json' },
        url: String(args.url ?? 'https://example.com'),
        content_type: 'application/json',
      }),
      execute: async (args) => {
        const url = args['url']
        if (typeof url !== 'string' || !url) {
          throw new Error('api: "url" is required and must be a string')
        }

        const method = typeof args['method'] === 'string' ? args['method'].toUpperCase() : 'GET'
        if (!VALID_METHODS.has(method)) {
          const valid = [...VALID_METHODS].sort().join(', ')
          throw new Error(`api: "method" must be one of ${valid}`)
        }

        const headers = toHeaderMap(args['headers'])
        // Prefer a JSON response when the server negotiates on Accept, unless the
        // author set their own Accept header. `*/*` keeps non-JSON endpoints working.
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'accept')) {
          headers['Accept'] = 'application/json, */*;q=0.8'
        }

        const rawBody = args['body']
        if (rawBody !== undefined && rawBody !== null && method === 'GET') {
          throw new Error('api: "body" is not allowed with GET requests')
        }
        const body = resolveBody(rawBody, headers)

        const finalUrl = mergeQuery(url, args['query'])

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

        try {
          const response = await fetch(finalUrl, {
            method,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            body,
            redirect: 'follow',
            signal: controller.signal,
          })

          const responseBody = await response.text()
          const contentType = response.headers.get('content-type') ?? ''

          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })

          let json: unknown = null
          if (contentType.toLowerCase().includes('json')) {
            try {
              json = JSON.parse(responseBody)
            } catch {
              json = null
            }
          }

          return {
            status: response.status,
            body: responseBody,
            json,
            headers: responseHeaders,
            url: response.url || finalUrl,
            content_type: contentType,
          }
        } finally {
          clearTimeout(timer)
        }
      },
    },
    {
      actionId: 'scrape',
      name: 'Scrape webpage',
      description: 'Extract data from a web page by selecting HTML elements.',
      intents: [
        'scrape a website',
        'extract data from a webpage',
        'pull content from a site',
        'get data from a web page',
        'read information from a URL',
        'grab text from a website',
        'crawl a page for data',
        'parse a webpage',
        'get the price from a website',
        'monitor a web page',
      ],
      preview: '{url}',
      inputFields: [
        {
          name: 'url',
          type: 'string',
          required: true,
          description: 'The target web page URL.',
        },
        {
          name: 'selectors',
          type: 'object',
          required: true,
          description:
            'CSS selector map defining what to extract. Each key maps to a CSS selector string or an object with css and optional extract ("text", "html", or an attribute name like "href").',
        },
        {
          name: 'headers',
          type: 'object',
          required: false,
          description: 'Custom HTTP headers as key-value pairs.',
        },
      ],
      outputFields: [
        { name: 'status', type: 'number', description: 'HTTP status code of the page response.' },
        { name: 'url', type: 'string', description: 'The final URL after any redirects.' },
        {
          name: 'results',
          type: 'object',
          description:
            'Extracted data keyed by your selector names. Each key holds an array of all matching values (text, html, or the attribute).',
        },
      ],
      mockExecute: async (args, _ctx) => ({
        status: 200,
        url: String(args.url ?? 'https://example.com'),
        results: {},
      }),
      execute: async (args) => {
        const url = args['url']
        if (typeof url !== 'string' || !url) {
          throw new Error('scrape: "url" is required and must be a string')
        }

        const rawSelectors = args['selectors']
        if (rawSelectors === null || rawSelectors === undefined || typeof rawSelectors !== 'object' || Array.isArray(rawSelectors)) {
          throw new Error('scrape: "selectors" is required and must be an object')
        }

        // Normalize selectors: each value is a string (css selector, extract=text)
        // or an object with { css: string, extract?: string }
        type NormalizedSelector = { css: string; extract: string }
        const normalized: Record<string, NormalizedSelector> = {}
        for (const [key, val] of Object.entries(rawSelectors as Record<string, unknown>)) {
          if (typeof val === 'string') {
            normalized[key] = { css: val, extract: 'text' }
          } else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            const selectorObj = val as Record<string, unknown>
            const css = selectorObj['css']
            if (typeof css !== 'string' || !css) {
              throw new Error(`scrape: selector "${key}" dict must have a "css" string key`)
            }
            const extract = selectorObj['extract'] ?? 'text'
            if (typeof extract !== 'string') {
              throw new Error(`scrape: selector "${key}" "extract" must be a string`)
            }
            normalized[key] = { css, extract }
          } else {
            throw new Error(`scrape: selector "${key}" must be a string or object`)
          }
        }

        const requestHeaders: Record<string, string> = { 'User-Agent': USER_AGENT }
        const rawHeaders = args['headers']
        if (rawHeaders !== null && rawHeaders !== undefined && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
          for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
            if (typeof v === 'string') {
              requestHeaders[String(k)] = v
            }
          }
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

        let response: Response
        let buffer: ArrayBuffer
        try {
          response = await fetch(url, {
            headers: requestHeaders,
            redirect: 'follow',
            signal: controller.signal,
          })
          buffer = await response.arrayBuffer()
        } finally {
          clearTimeout(timer)
        }

        if (buffer.byteLength > MAX_BYTES) {
          throw new Error(`scrape: response too large for ${url}`)
        }

        const html = new TextDecoder('utf-8').decode(buffer)
        const $ = cheerio.load(html)

        const results: Record<string, string[]> = {}
        for (const [name, { css, extract }] of Object.entries(normalized)) {
          const extracted: string[] = []
          $(css).each((_i, el) => {
            let value: string
            if (extract === 'text') {
              value = $(el).text().trim()
            } else if (extract === 'html') {
              value = $(el).html() ?? ''
            } else {
              // attr:attrname or bare attrname
              const attrName = extract.startsWith('attr:') ? extract.slice(5) : extract
              value = $(el).attr(attrName) ?? ''
            }
            if (value) {
              extracted.push(value)
            }
          })
          results[name] = extracted
        }

        return {
          status: response.status,
          url: response.url || url,
          results,
        }
      },
    },
    {
      actionId: 'fetch',
      name: 'Fetch page content',
      description: 'Fetch a web page and return its content as readable markdown or plain text, with scripts, styles, and navigation stripped.',
      intents: [
        'fetch a web page',
        'read a webpage',
        'get the content of a URL',
        'download page text',
        'read a website',
        'read the content of a website',
        'read a web page as text',
        'get readable content from a URL',
        'fetch page as markdown',
        'extract text from a webpage',
        'get the text of a website',
      ],
      preview: '{url}',
      inputFields: [
        {
          name: 'url',
          type: 'string',
          required: true,
          description: 'The web page URL to fetch.',
        },
        {
          name: 'maxChars',
          type: 'number',
          required: false,
          description: 'Maximum characters to return. Long pages are truncated. Default: 50000.',
        },
      ],
      outputFields: [
        { name: 'content', type: 'string', description: 'Readable page content as markdown or plain text with scripts, styles, and navigation stripped.' },
        { name: 'url', type: 'string', description: 'The final URL after any redirects.' },
        { name: 'title', type: 'string', description: 'Page title extracted from the HTML.' },
        { name: 'truncated', type: 'boolean', description: 'True when the page was cut off at maxChars.' },
      ],
      mockExecute: async (args, _ctx) => ({
        content: '# Mock Page\n\nThis is mock page content for workflow authoring.',
        url: String(args.url ?? 'https://example.com'),
        title: 'Mock Page',
        truncated: false,
      }),
      execute: async (args) => {
        const url = args['url']
        if (typeof url !== 'string' || !url) {
          throw new Error('fetch: "url" is required and must be a string')
        }

        let maxChars = typeof args['maxChars'] === 'number' && args['maxChars'] > 0
          ? args['maxChars']
          : DEFAULT_MAX_CHARS

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

        let response: Response
        let buffer: ArrayBuffer
        try {
          response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            redirect: 'follow',
            signal: controller.signal,
          })

          // Check content-length before downloading
          const contentLength = response.headers.get('content-length')
          if (contentLength !== null && parseInt(contentLength, 10) > MAX_BYTES) {
            throw new Error(`fetch: response too large for ${url}`)
          }

          buffer = await response.arrayBuffer()
        } finally {
          clearTimeout(timer)
        }

        if (buffer.byteLength > MAX_BYTES) {
          throw new Error(`fetch: response too large for ${url}`)
        }

        const raw = new TextDecoder('utf-8').decode(buffer)
        const contentType = response.headers.get('content-type') ?? ''
        const finalUrl = response.url

        const isHtml = contentType.includes('html') || raw.trimStart().startsWith('<')

        let text: string
        let title = ''

        if (isHtml) {
          const $ = cheerio.load(raw)

          // Extract title before stripping
          title = $('title').first().text().trim()

          // Strip noisy tags (same as Python: script, style, nav, footer)
          $('script, style, nav, footer').remove()

          const td = new TurndownService({ headingStyle: 'atx' })
          text = td.turndown($.html())
        } else {
          text = raw
        }

        const truncated = text.length > maxChars
        if (truncated) {
          text = text.slice(0, maxChars) + `\n\n[truncated at ${maxChars} chars]`
        }

        return {
          content: text,
          url: finalUrl || url,
          title,
          truncated,
        }
      },
    },
  ],
})
