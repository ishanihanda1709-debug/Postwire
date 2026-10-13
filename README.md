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
- **Thumbnails**: every card shows the publisher's own photo when there is one. When there isn't, it shows a free stock photo about the story's topic with a **Stock photo** label (hover for the credit). If none can be loaded it falls back to a colour block. Set `STOCK_THUMBS=0` to turn stock thumbnails off.
- **Not for me (✕ on a card)**: hides that story for good, with Undo. Hidden stories are remembered in your browser only, and a link at the bottom brings them back.
- **♡ Save this post**: in a story, saves the post you are looking at (and keeps your edits). Everything saved is under **♥ Saved**, where you can copy a post, open it in LinkedIn's post box (you review and post it yourself), delete it, or **Export all** as Markdown. Saved posts are stored in `data/saved.json`.
- **Fetch new stories** (top right): checks the publications for anything new.
- **Only fresh stories**: the page shows stories from the last 3 days by default (change with `FRESH_DAYS`, or use the 3 / 7 / 30 day switch). Cards show how old a story is, like "5 h ago" or "Yesterday".
- **Click a story**: three LinkedIn post options (story-led, lesson-led, question-led), each ready to edit and copy, and pictures to go with it:
  - a gallery of **ready-to-post creatives** in 3 LinkedIn sizes (portrait 4:5, square, landscape): four of your own graphics (Cobalt, Sunshine, Midnight quote, Pink poster) and, when the story has a publisher image, two photo styles. They contain only the headline, a one-line subtitle, the publisher and your name. Download as PNG and add to your post,
  - **stock photos** about the story's topic: pick one and the photo creatives are redrawn with it. They are illustrative only, labelled as such, carry a credit line (with a Copy button), and are never searched by brand or people names. Photos come from Openverse (no key needed) or Pexels (free key: set `PEXELS_API_KEY`),
  - the **original image** to download.

## Posts in your voice

Writing a finished post needs an Anthropic API key. Copy `.env.example` to `.env`, fill in your key, and start the app:

```bash
cp .env.example .env     # then edit .env: ANTHROPIC_API_KEY=... and AUTHOR_NAME=Your Name
npm start
```

`.env` is git-ignored, so the key stays on your machine. The header shows **AI connected** when it is picked up, or **AI not connected** if not. Never paste your key into a chat, an issue or a commit.

The post format is: a curiosity hook, one idea per line, a turn, the real lesson, a short contrast line ("Everyone talks about X. Very few notice Y."), then a source line. It is 110 to 170 words.

The easiest way: open the **My style** tab and paste 3 to 6 of your own posts, one at a time. They are stored in `data/voice.json`. Alternatively, copy `voice/my-posts.example.md` to `voice/my-posts.md` and paste 3 to 6 of your own past posts, separated by `---`. The app matches your rhythm and tone and never copies your content. The file is git-ignored.

LinkedIn does not allow automated reading of profiles or feeds, so the app cannot read your feed. Pasting your posts is the way to teach it your style.

### Free options

- **No key (always free):** open a story and press **1. Copy prompt for a free chatbot**. The prompt includes the writing rules, your sample posts and the story. Paste it into Claude.ai, ChatGPT or Gemini, then press **2. Paste the answer** and paste the reply. The app splits it into three options you can edit, save with ♥, and pair with picture cards (the card headline is the first line of your post). Pasted posts are kept only if you save them.
- **Free local AI:** install Ollama, run `ollama pull llama3.1`, and put `LLM_BASE_URL=http://localhost:11434/v1` and `LLM_MODEL=llama3.1` in `.env`. It costs nothing per use but needs a reasonably capable computer, and smaller models write less well and sometimes fail to return clean output.
- **Other providers:** any service with an OpenAI-compatible API works through `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY`. Check the provider's own page for current free limits and terms.

Without any of these you still get the stories and picture cards, and the post is an outline with `[blanks]` to fill in.

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
| `FRESH_DAYS` | 3 | Only show stories published in the last N days, so posts stay relevant. The page also has a 3 / 7 / 30 day switch. Stories with no publish date are left out |
| `REFRESH_MINUTES` | 60 | Background refresh interval. It only runs while the server is running |
| `REFRESH_AT` | – | Refresh at fixed times instead, e.g. `09:00` or `09:00,18:00` (24h). If the app was off at that time, it catches up when it starts |
| `APP_TIMEZONE` | Asia/Kolkata | Time zone for `REFRESH_AT` |
| `ANTHROPIC_API_KEY` | – | Needed for finished posts |
| `ANTHROPIC_MODEL` | claude-sonnet-5-5 | |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | – | Use any OpenAI-compatible AI instead of Anthropic (free tiers, local Ollama) |
| `PEXELS_API_KEY` | – | Optional free key from pexels.com/api for stock photos. Without it the app uses Openverse (no key, lower limits) |
| `AUTHOR_NAME` | – | Printed on the picture cards |
| `ACCESS_TOKEN` | – | If set, every API call needs it, so the site's data and your saved posts are private. The page asks for it once |
| `VOICE_FILE`, `SOURCES_FILE`, `DATA_DIR` | voice/my-posts.md, sources.json, data/ | |

## Going live checklist

Secrets (set them in your host's environment settings, never in the repo):

1. `ANTHROPIC_API_KEY`: your Anthropic key. Set a monthly spend limit for it in the Anthropic console.
2. `ACCESS_TOKEN`: a long random string you invent (for example 32+ characters). Without it, anyone with the link can read the site and your saved posts.

Settings:

3. `HOST=0.0.0.0` (the host usually sets `PORT` itself).
4. `DATA_DIR` pointing at a persistent disk, so stories and saved posts survive redeploys. Put your `my-posts.md` in the same folder.
5. `AUTHOR_NAME`, `REFRESH_AT=09:00` and `APP_TIMEZONE` if you want them.

Use HTTPS (hosts like Render, Railway and Fly.io provide it). No other keys are needed: the news feeds are public.

## Sources

`sources.json` lists the feeds (Ads of the World, Creative Review, Adweek, Marketing Dive, Marketing Week, Campaign, Digiday, Search Engine Land, Social Media Today, MarTech, Campaign India, afaqs, exchange4media, BestMediaInfo, ET BrandEquity, and two Google News searches for campaigns). Publishers move feed addresses. If a source fails, the empty-state message names it; fix or remove it in `sources.json`. These addresses could not be tested from the build sandbox, so expect to adjust a few on first run.

## Where the data lives

No database server. Everything is plain JSON files in `data/`: `store.json` (stories), `saved.json` (your saved posts) and `ai-cache.json` (generated posts, so a story is only written once). The app has its own built-in scheduler, so nothing else needs to be set up. Back up the `data/` folder to keep your saved posts.

## How refresh works

Fetch feeds in parallel, drop items older than 60 days, merge duplicate stories across outlets (by URL, then headline similarity), fill missing images and summaries from the article's own metadata, label each as campaign or news, and save to `data/store.json`.

## Landing page

`docs/index.html` is a static landing page. `.github/workflows/pages.yml` publishes it with GitHub Pages when `main` changes. One-time setup: **Settings → Pages → Source: GitHub Actions**. The app itself is a Node server you run yourself and is not hosted by Pages.
