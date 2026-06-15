# @weldable/integration-web

Web scraping actions for Weldable.

Part of the [Weldable](https://weldable.ai/) integration library — see [@weldable/integration-core](https://github.com/weldable/integration-core) for the full catalog.

## Install

```bash
npm install @weldable/integration-web @weldable/integration-core
```

`@weldable/integration-core` is a peer dependency and must be installed alongside this package.

## Usage

```ts
import integration from '@weldable/integration-web'

// Fetch a page as markdown
const fetch = integration.actions.find(a => a.id === 'web.fetch')!

const page = await fetch.execute(
  { url: 'https://example.com/blog/latest' },
  ctx, // ActionContext from your Weldable-compatible host
)

console.log(page.content)   // page body converted to markdown
console.log(page.truncated) // true when the page was cut off at maxChars

// Make a raw HTTP request. Pass query params as an object (encoded for you) and
// a JSON body as an object (serialized for you, with a JSON content-type set).
const api = integration.actions.find(a => a.id === 'web.api')!

const response = await api.execute(
  {
    url: 'https://api.example.com/data',
    method: 'POST',
    query: { page: 2, tag: ['a', 'b'] },
    body: { query: 'hello' },
  },
  ctx,
)

response.status       // HTTP status code
response.json         // parsed JSON when the response is JSON, otherwise null
response.body         // raw response body as a string
response.headers      // response headers as an object
response.url          // final URL after any redirects
response.content_type // response content type

// Scrape specific elements with CSS selectors. Each selector value is a CSS
// string, or an object with `css` and an optional `extract` ("text" | "html" |
// an attribute name). Each key holds an array of all matching values.
const scrape = integration.actions.find(a => a.id === 'web.scrape')!

const data = await scrape.execute(
  {
    url: 'https://example.com/pricing',
    selectors: {
      title: 'h1',
      prices: { css: '.price', extract: 'text' },
      links: { css: 'a.tier', extract: 'href' },
    },
  },
  ctx,
)

data.results.prices // e.g. ['$39', '$129']
