# Postwire

News in **Marketing**, **Product**, **Finance** and **Others**, each with ready-to-post LinkedIn drafts. Open a headline, get three post options in your own voice and a graphic to go with them.

Zero dependencies. Node 20+.

```bash
npm start            # http://127.0.0.1:3000 (create the first account: it becomes the owner)
npm run refresh      # one-off fetch of the news feeds (e.g. from cron)
npm run users -- list   # owner tools: see "Running it as a business"
npm test
```

## What people see

- **A left sidebar** with the four news sections, **My style**, **Saved**, a light/dark switch and the account card (a top bar on phones).
- **One page per section.** Each has its own tabs: Marketing (All, Campaigns, News, Case studies), Product (All, Launches, Features, For PMs), Finance (All, Markets, Funding, Economy, Fintech), Others (All, Science & tech, Sport, Entertainment, Health). **Others** is everything outside the first three: India and world news, science, sport and culture. Plus India / Global, a 3 / 7 / 30 day switch, search, **Show me different ones** and a ✕ to hide a story.
- **Headlines only.** Each card is a headline, its publisher, its age and a link to the original. No publisher photos, no article text.
- **Click a story** for three LinkedIn post options (story-led, lesson-led, question-led), editable and ready to copy, and four downloadable graphics in three LinkedIn sizes, drawn from the headline in the section's colour.
- **My style**: paste your own posts and every draft follows your rhythm and tone.
- **Saved**: keep posts, copy them, open them in LinkedIn's post box, export as Markdown.
- **Light and dark mode**, remembered per browser.

## Writing the posts

| Route | Cost | How |
|---|---|---|
| **AI key** | pay per use | Set `ANTHROPIC_API_KEY` in `.env`. Posts appear instantly in the story panel. Each person gets `AI_DAILY_LIMIT` (default 30) AI posts a day; a story they already opened is free to reopen. |
| **Free chatbot** | free | In a story press *Copy prompt for a free chatbot*, paste it into Claude, ChatGPT or Gemini, then press *Paste the answer*. The app splits the reply into three options. |
| **Local AI** | free | Install Ollama, then `LLM_BASE_URL=http://localhost:11434/v1` and `LLM_MODEL=llama3.1`. Needs a capable computer; smaller models write less well. |

Without any of these the post is an outline with `[blanks]`.

**Truth rules in every prompt:** only facts from the headline and the feed's own short summary; no invented numbers, quotes or personal stories; a source line at the end. **Finance** posts are additionally forbidden from investment advice, price targets, predictions and buy/sell/hold views, and the panel says "News only, not investment advice". **Others** posts are told to stay balanced and respectful, not to take sides on political, religious or other divisive issues, and not to speculate about people. Posts are drafts: always read them before you post. LinkedIn does not allow automated reading of profiles or feeds, so the app never touches your LinkedIn; it only opens LinkedIn's post box with your text for you to review and publish.

## Running it as a business

**Accounts.** Sign-up and login with email and password (scrypt-hashed, 30-day session cookie, rate-limited). Everyone's saved posts and style samples are private to them. The **first account is the owner** (full access, sees *Account > Owner tools* and can fetch news). Any data from the single-user days is adopted by the owner.

**Plans.** New accounts get a free trial (`TRIAL_DAYS`, default 7). After it ends the API answers *402* and the app shows the Upgrade page with `PRICE_LABEL` and a **Subscribe** button pointing at `UPGRADE_URL` (for example a Razorpay Payment Link). Until payments are automated, grant access by hand when someone pays:

```bash
npm run users -- grant someone@example.com 30    # 30 days of paid access
npm run users -- list                            # who is on trial, paid, expired
npm run users -- revoke someone@example.com
npm run users -- password someone@example.com NewPassword1   # no email reset yet
npm run users -- create friend@example.com TempPass123 "Friend" 
npm run users -- admin|unadmin|delete <email>
```

Set `ALLOW_SIGNUP=0` for an invite-only beta (create accounts with `users create`). Set `REQUIRE_LOGIN=0` to run privately on your own computer with no login.

**Not built yet** (needed before you scale): automatic payment webhooks (Razorpay/Stripe) so access switches on and off by itself; password reset by email; a real database instead of JSON files; invoices/GST handling; monitoring and backups.

## The public landing page

Visitors who are not logged in see the landing page at the home address. It shows **today's real headlines** in each section (headline, publisher, age and a link to the original, six per section, refreshed with the news) with a *Write a post →* button that leads to sign-up. It is fed by the public endpoint `/api/public/headlines`, which never includes summaries. If you would rather not show any headlines to the public, set `PUBLIC_HEADLINES=0` and the section simply disappears.

## Content rights

The app stores each story's headline, publisher, link, date and the feed's own short summary, and shows **only the headline, publisher, age and link**. The summary is used only as input when writing a draft. It never copies publishers' photos or article pages (set `FETCH_ARTICLE_TEXT=1` only if you accept the trade-off). Check each publisher's feed terms before charging for the service; `sources.json` is the list to review, and *Account > Owner tools* shows each feed's health. The generated graphics are text-only designs you can use freely.

## Going live checklist

1. **Host** the app on a Node service with a **persistent disk** (Render, Railway, Fly.io…) and **HTTPS**. Point `DATA_DIR` at the disk.
2. **Environment variables** (never in the repo): `HOST=0.0.0.0`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `APP_NAME`, `PRICE_LABEL`, `UPGRADE_URL`, `SUPPORT_EMAIL`, `ANTHROPIC_API_KEY` (set a spend limit in the provider's console), `REFRESH_AT=09:00`.
3. Open the site and **create your own account first**: it becomes the owner. Then decide `ALLOW_SIGNUP`.
4. **Legal:** have a lawyer complete `public/terms.html` and `public/privacy.html` (both are marked DRAFT), and check GST/tax, India's DPDP Act duties, the name's trademark, and the publishers' feed terms.
5. **Back up** the `DATA_DIR` folder (users, saved posts, stories).
6. Buy the domain, point it at the host, and confirm the login cookie shows the *Secure* flag.

## Configuration

See `.env.example` for every setting with a comment. The ones that matter most: `APP_NAME`, `TRIAL_DAYS`, `AI_DAILY_LIMIT`, `FRESH_DAYS`, `REFRESH_AT` / `APP_TIMEZONE`, `PRICE_LABEL`, `UPGRADE_URL`, `ALLOW_SIGNUP`, `REQUIRE_LOGIN`, `DATA_DIR`.

## Where the data lives

Plain JSON files in `DATA_DIR`: `store.json` (stories, 30 days), `users.json` (accounts; passwords are scrypt hashes), `sessions.json` (hashed session tokens), `saved.json`, `voice.json`, `ai-cache.json` (drafts per user, kept two weeks). Fine for a first few hundred users; move to a database before you grow past that.

## Sources and refresh

`sources.json` lists about 55 feeds across the four sections (plus Google News searches). Publishers move feed addresses: a failing feed shows its error under *Account > Owner tools*. The app fetches every hour by default, or at `REFRESH_AT` times, and catches up if it was off. Stories are merged across outlets (by URL, then headline similarity) within each section, classified by keywords in the headline, and kept for 30 days. These feed addresses could not be tested from the build sandbox, so expect to adjust a few on first run.

## Landing page

`docs/index.html` (with `docs/landing.js`) is the public landing page. **The app serves it itself**: visitors who are not logged in see it at the home address, and *Get started* / *Log in* lead to the sign-up and login pages. Logged-in visitors get the app at the same address.

If you also publish the page somewhere else (for example GitHub Pages, via `.github/workflows/pages.yml`), the buttons cannot reach the app until you tell them where it lives: set `APP_URL` at the top of the "Get started" section of `docs/landing.js` (for example `const APP_URL = 'https://postwire.example';`). Until then, outside the app, the buttons show a "Preview only" message instead of going anywhere.
