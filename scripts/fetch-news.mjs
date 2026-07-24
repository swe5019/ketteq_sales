// Fetches real industry headlines from public RSS feeds and writes them to
// src/data/news.json. Runs in GitHub Actions (which has open outbound network),
// NOT in the visitor's browser — that avoids CORS and keeps the site static.
//
// Primary source: Google News RSS search (no API key, topic-targeted, reliable).
// Optional extra feeds are tolerated — any feed that fails is skipped.
//
// Run locally/CI:  node scripts/fetch-news.mjs
// Safe by design:  if zero items are gathered, the existing news.json is kept.

import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'data', 'news.json')
const MAX_ITEMS = 30
const FETCH_TIMEOUT_MS = 15000

// Topic-targeted Google News RSS queries (supply chain planning software space).
const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`

const FEEDS = [
  { url: gnews('ketteQ supply chain planning'), source: '' },
  { url: gnews('Kinaxis OR "o9 Solutions" OR "Blue Yonder" supply chain planning'), source: '' },
  { url: gnews('"SAP Integrated Business Planning" OR Anaplan OR Logility supply chain planning'), source: '' },
  { url: gnews('supply chain planning software Gartner Magic Quadrant OR "agentic AI"'), source: '' },
  // Add more public RSS/Atom feeds here; failures are skipped automatically.
]

// Only keep items relevant to our space.
const RELEVANCE =
  /(supply chain|ketteq|kinaxis|o9 solutions|blue yonder|"sap ibp"|sap integrated business planning|anaplan|logility|demand planning|inventory planning|s&op|sales and operations planning|integrated business planning|agentic ai|gartner magic quadrant|forecast accuracy|planning platform)/i

// Map keyword hits to tags (incl. competitor ids used elsewhere in the app).
const TAG_RULES = [
  [/ketteq/i, 'ketteq'],
  [/kinaxis/i, 'competitor:kinaxis'],
  [/\bo9\b|o9 solutions/i, 'competitor:o9-solutions'],
  [/blue yonder/i, 'competitor:blue-yonder'],
  [/sap ibp|sap integrated business planning/i, 'competitor:sap-ibp'],
  [/anaplan/i, 'competitor:anaplan'],
  [/logility/i, 'competitor:logility'],
  [/gartner/i, 'gartner'],
  [/agentic ai|artificial intelligence|\bai\b/i, 'agentic-ai'],
  [/fund|raise|series [a-e]|valuation/i, 'funding'],
  [/acqui|merger|partnership|deal|selects|deploys/i, 'market-trend'],
]

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function stripHtml(s = '') {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toISODate(pubDate) {
  const d = new Date(pubDate)
  if (isNaN(d)) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function slugId(date, title) {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `n-${date}-${h.toString(36)}`
}

function deriveTags(text) {
  const tags = []
  for (const [re, tag] of TAG_RULES) if (re.test(text) && !tags.includes(tag)) tags.push(tag)
  return tags.length ? tags : ['industry']
}

// Exported for testing: turn one feed's XML into normalized news items.
export function parseFeed(xml, sourceFallback = '') {
  const data = parser.parse(xml)
  const channel = data?.rss?.channel ?? data?.feed ?? {}
  let items = channel.item ?? channel.entry ?? []
  if (!Array.isArray(items)) items = [items]
  const channelTitle = typeof channel.title === 'string' ? channel.title : sourceFallback

  return items
    .map((it) => {
      const rawTitle = stripHtml(typeof it.title === 'object' ? it.title['#text'] : it.title)
      // Google News appends " - Source" to titles and also provides a <source> tag.
      let source = ''
      if (it.source) source = typeof it.source === 'object' ? it.source['#text'] : it.source
      let title = rawTitle
      // Strip the trailing " - Publisher" segment Google News adds to every title.
      if ((source || rawTitle.includes(' - ')) && rawTitle.includes(' - ')) {
        const idx = rawTitle.lastIndexOf(' - ')
        if (!source) source = rawTitle.slice(idx + 3)
        title = rawTitle.slice(0, idx)
      }
      source = source || channelTitle || sourceFallback || 'Industry source'

      let url = ''
      if (typeof it.link === 'string') url = it.link
      else if (Array.isArray(it.link)) url = it.link.find((l) => l['@_href'])?.['@_href'] || ''
      else if (it.link?.['@_href']) url = it.link['@_href']
      url = url || it.guid?.['#text'] || it.guid || ''

      const date = toISODate(it.pubDate || it.published || it.updated)
      const summary = stripHtml(
        typeof it.description === 'object' ? it.description['#text'] : it.description || it.summary
      ).slice(0, 240)

      return { title: title.trim(), source: source.trim(), url, date, summary }
    })
    .filter((it) => it.title && it.url)
}

async function fetchFeed(feed) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (ketteQSalesNewsBot)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    return parseFeed(xml, feed.source)
  } catch (e) {
    console.warn(`Skipping feed (${feed.url}): ${e.message}`)
    return []
  } finally {
    clearTimeout(t)
  }
}

async function main() {
  const collected = []
  for (const feed of FEEDS) collected.push(...(await fetchFeed(feed)))

  // Relevance filter, dedupe by normalized title, finalize.
  const seen = new Set()
  const items = []
  for (const it of collected) {
    const text = `${it.title} ${it.summary}`
    if (!RELEVANCE.test(text)) continue
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      id: slugId(it.date, it.title),
      date: it.date,
      title: it.title,
      source: it.source,
      url: it.url,
      summary: it.summary,
      tags: deriveTags(text),
    })
  }

  items.sort((a, b) => b.date.localeCompare(a.date))
  const finalItems = items.slice(0, MAX_ITEMS)

  if (finalItems.length === 0) {
    console.warn('No items gathered — keeping existing news.json unchanged.')
    return
  }

  const before = (() => {
    try {
      return readFileSync(OUT, 'utf8')
    } catch {
      return ''
    }
  })()
  const after = JSON.stringify(finalItems, null, 2) + '\n'
  if (before.trim() === after.trim()) {
    console.log('news.json already up to date.')
    return
  }
  writeFileSync(OUT, after)
  console.log(`Wrote ${finalItems.length} items to news.json.`)
}

// Only run the network pipeline when executed directly (not when imported).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
