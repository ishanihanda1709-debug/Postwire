# The Marketing Brief

A simple site that shows trending ad campaigns and marketing news from India and around the world. Click any story and get a short LinkedIn post in your voice, plus pictures to post with it.

Zero dependencies. Node 20+.

```bash
npm start            # http://127.0.0.1:3000, the first refresh runs automatically
npm run refresh      # one-off refresh (e.g. from cron)
npm test
```

## What you see

- **Trending**: stories covered by several outlets, recent, with a picture, campaigns first. Tabs for **Campaigns** and **News**, an India / Global switch, and search.
- **Show me different ones**: swaps the current picks for a fresh set from the best matches, never repeating what you've already seen. When fresh ones run low it mixes earlier stories back in.
- **Not for me (✕ on a card)**: hides that story for good, with Undo. Hidden stories are remembered in your browser only, and a link at the bottom brings them back.
- **Fetch new stories** (top right): checks the publications for anything new.
- **Click a story**: three LinkedIn post options (story-led, lesson-led, question-led), each ready to edit and copy, and pictures to go with it:
  - a **text card** (your own graphic, 1080x1350) with the takeaway,
  - a **photo card** using the publisher's image,
  - the **original image** to download.

## Posts in your voice

Writing a finished post needs an Anthropic API key:

```bash
ANTHROPIC_API_KEY=your-key AUTHOR_NAME="Your Name" npm start
```

The post format is: a curiosity hook, one idea per line, a turn, the real lesson, a short contrast line ("Everyone talks about X. Very few notice Y."), then a source line. It is 110 to 170 words.

To make it sound like you, copy `voice/my-posts.example.md` to `voice/my-posts.md` and paste 3 to 6 of your own past posts, separated by `---`. The app matches your rhythm and tone and never copies your content. The file is git-ignored.

LinkedIn does not allow automated reading of profiles or feeds, so the app cannot read your feed. Pasting your posts is the way to teach it your style.

Without an API key you still get the stories and picture cards, and the post is an outline with `[blanks]` to fill in.

## Truthfulness

- The post may only use facts from the source. The prompt forbids invented numbers, quotes, results and personal stories ("I was there", "I met...").
- Every story shows its publisher and date and links to the original. Dates are publication dates.
- Publisher images belong to the publisher. Credit them or check usage rights. The text card is your own graphic.
- Nothing is bundled with the repo. A story with no image shows a placeholder, never a stock or invented image.
- Always read the post before you publish it.

## Configuration

| Var | Default | |
|---|---|---|
| `PORT` / `HOST` | 3000 / 127.0.0.1 | Set `HOST=0.0.0.0` only behind auth |
| `REFRESH_MINUTES` | 60 | Background refresh. Use 1440 for daily. It only runs while the server is running |
| `ANTHROPIC_API_KEY` | – | Needed for finished posts |
| `ANTHROPIC_MODEL` | claude-sonnet-5-5 | |
| `AUTHOR_NAME` | – | Printed on the picture cards |
| `ACCESS_TOKEN` | – | If set, write endpoints need header `x-access-token` (the UI prompts for it) |
| `VOICE_FILE`, `SOURCES_FILE`, `DATA_DIR` | voice/my-posts.md, sources.json, data/ | |

## Sources

`sources.json` lists the feeds (Ads of the World, Creative Review, Adweek, Marketing Dive, Marketing Week, Campaign, Digiday, Search Engine Land, Social Media Today, MarTech, Campaign India, afaqs, exchange4media, BestMediaInfo, ET BrandEquity, and two Google News searches for campaigns). Publishers move feed addresses. If a source fails, the empty-state message names it; fix or remove it in `sources.json`. These addresses could not be tested from the build sandbox, so expect to adjust a few on first run.

## How refresh works

Fetch feeds in parallel, drop items older than 60 days, merge duplicate stories across outlets (by URL, then headline similarity), fill missing images and summaries from the article's own metadata, label each as campaign or news, and save to `data/store.json`.

## Landing page

`docs/index.html` is a static landing page. `.github/workflows/pages.yml` publishes it with GitHub Pages when `main` changes. One-time setup: **Settings → Pages → Source: GitHub Actions**. The app itself is a Node server you run yourself and is not hosted by Pages.
