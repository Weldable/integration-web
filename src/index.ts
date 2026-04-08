import { defineIntegration } from '@weldable/integration-core'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

const TIMEOUT_MS = 30_000
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const USER_AGENT = 'Mozilla/5.0 (compatible; weldable/1.0)'
const DEFAULT_MAX_CHARS = 50_000
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export default defineIntegration({
  id: 'web',
  name: 'Web',
  description: 'Make HTTP requests, scrape web pages, and fetch readable content.',
  icon: 'web',
  version: 1,
  auth: { type: 'none' },
  exampleUsage: "Look up the current price of Bitcoin",
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
          type: 'string',
          required: false,
          description: 'HTTP method: GET, POST, PUT, PATCH, or DELETE.',
          default: 'GET',
        },
        {
          name: 'headers',
          type: 'object',
          required: false,
          description: 'Custom HTTP headers as key-value pairs.',
        },
        {
          name: 'body',
          type: 'string',
          required: false,
          description: 'Request body. Not allowed with GET requests.',
        },
      ],
      outputFields: [
        { name: 'status', type: 'number', description: 'HTTP status code of the response.' },
        { name: 'body', type: 'string', description: 'Response body as a string (JSON responses are returned as a JSON string).' },
        { name: 'headers', type: 'object', description: 'Response headers as key-value pairs.' },
      ],
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

        const rawHeaders = args['headers']
        const headers: Record<string, string> = {}
        if (rawHeaders !== null && rawHeaders !== undefined && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
          for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
            headers[String(k)] = String(v)
          }
        }

        const body = args['body']
        if (body !== undefined && body !== null && method === 'GET') {
          throw new Error('api: "body" is not allowed with GET requests')
        }
        if (body !== undefined && body !== null && typeof body !== 'string') {
          throw new Error('api: "body" must be a string')
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

        try {
          const response = await fetch(url, {
            method,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            body: typeof body === 'string' ? body : undefined,
            redirect: 'follow',
            signal: controller.signal,
          })

          const responseBody = await response.text()
          const contentType = response.headers.get('content-type') ?? ''

          return {
            body: responseBody,
            url,
            content_type: contentType,
            status: response.status,
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
          description: 'CSS selector map defining what to extract. Each key maps to a CSS selector string or an object with css and optional extract ("text", "html", or an attribute name like "href").',
        },
        {
          name: 'headers',
          type: 'object',
          required: false,
          description: 'Custom HTTP headers as key-value pairs.',
        },
      ],
      outputFields: [
        { name: 'data', type: 'object', description: 'Extracted data keyed by the selector names provided in the input, each containing the matched text, html, or attribute value.' },
        { name: 'url', type: 'string', description: 'The final URL after any redirects.' },
        { name: 'status', type: 'number', description: 'HTTP status code of the page response.' },
      ],
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
      ],
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
          url: finalUrl,
          title,
          truncated,
        }
      },
    },
  ],
})
