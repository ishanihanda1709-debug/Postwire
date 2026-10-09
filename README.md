# The Marketing Brief

A personal marketing-intelligence and portfolio site. It pulls fresh stories from marketing publications' RSS feeds (India and global), removes duplicates, and lets you turn any story into a case-study breakdown and LinkedIn post drafts, then save the best to a portfolio.

Zero dependencies. Node 20+.

```bash
npm start            # http://127.0.0.1:3000, first refresh runs automatically
npm run refresh      # one-off refresh from the CLI (e.g. from cron)
npm test
```

## What is sourced vs. generated

| Label | Meaning |
|---|---|
| **Sourced** (green) | Headline, publisher, date, summary, image and video come from the publisher's feed/page. Every card links to the original; images are hotlinked with credit, never re-hosted. Dates are *publication* dates; feeds do not provide launch dates. |
| **AI-generated** (blue) | Case-study breakdown and LinkedIn drafts. Only created when `ANTHROPIC_API_KEY` is set. The model is told to use only the article text and to write "Not stated in the source" instead of guessing. Each breakdown shows its evidence basis (full article vs. headline-only) and a confidence level. |
| **Your notes / Scaffold** | With no API key you still get an editable breakdown worksheet and LinkedIn scaffolds containing only the headline/publisher/date plus `[brackets]` for your own take. |

No content is bundled with the repo. If a feed has no image the card shows a typographic placeholder, never a stock or invented image.

## Configuration (env vars)

| Var | Default | |
|---|---|---|
| `PORT` / `HOST` | 3000 / 127.0.0.1 | Set `HOST=0.0.0.0` only behind auth |
| `REFRESH_MINUTES` | 60 | Background refresh interval |
| `ANTHROPIC_API_KEY` | – | Enables AI breakdowns and drafts |
| `ANTHROPIC_MODEL` | claude-sonnet-5-5 | |
| `ACCESS_TOKEN` | – | If set, write/AI endpoints require header `x-access-token` (the UI prompts for it) |
| `MAX_AGE_DAYS` / `KEEP_DAYS` | 60 / 120 | Ingest cutoff / retention |
| `DATA_DIR`, `SOURCES_FILE` | ./data, ./sources.json | |

## Sources

`sources.json` lists the feeds (Ads of the World, Creative Review, Adweek, Marketing Dive, Marketing Week, Campaign, Digiday, Search Engine Land, Social Media Today, MarTech, Campaign India, afaqs, exchange4media, BestMediaInfo, ET BrandEquity, plus two Google News queries for campaign coverage). Publishers move feed URLs; the **Sources** tab shows per-feed health and errors so you can fix or disable them in that file. These URLs were not verifiable from the build sandbox (outbound access to them was blocked), so expect to adjust a few on first run.

## How refresh works

1. Fetch every feed in parallel, parse RSS/Atom, drop items older than `MAX_AGE_DAYS`.
2. Dedupe by canonical URL (tracking params stripped), then by headline similarity across outlets. Near-duplicates become "also covered by" links on one card.
3. Enrich new items missing an image/summary/video from the article's `og:` tags.
4. Classify (campaign / case study / news; topic tags; India vs global) by keywords in the headline and summary only.
5. Persist to `data/store.json`. Portfolio lives in `data/portfolio.json` and can be exported as Markdown.

Deploying: any Node host with a persistent disk works. Without a persistent disk the store and portfolio reset on redeploy.
