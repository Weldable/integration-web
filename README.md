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

console.log(page.content) // page body converted to markdown

// Make a raw HTTP request
const api = integration.actions.find(a => a.id === 'web.api')!

const response = await api.execute(
  {
    url: 'https://api.example.com/data',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'hello' }),
  },
  ctx,
)

// Scrape specific elements with CSS selectors
const scrape = integration.actions.find(a => a.id === 'web.scrape')!

const data = await scrape.execute(
  {
    url: 'https://example.com/pricing',
    selectors: {
      title: { selector: 'h1', extract: 'text' },
      price: { selector: '.price', extract: 'text' },
    },
  },
  ctx,
)
