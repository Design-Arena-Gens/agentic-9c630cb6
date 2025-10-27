# Agentic YouTube Shorts Automation

Full-stack automation agent that monitors a content folder, generates metadata with AI, and uploads YouTube Shorts on an optimized schedule. Built with Next.js (App Router) and serverless-friendly Node utilities so it can deploy cleanly to Vercel.

## Key Capabilities

- 📁 Watches `content/videos` for new `.mp4`, `.mov`, or `.m4v` files
- 🧠 Extracts metadata from sidecar files or generates titles/descriptions/hashtags with OpenAI
- 🔥 Expands SEO keywords with trending prompts (OpenAI)
- 🖼️ Captures a thumbnail frame via FFmpeg and (optionally) overlays a watermark
- ⏱️ Schedules uploads according to custom time windows and max daily limits
- ☁️ Uploads to YouTube Data API v3 (Shorts-ready), supports private/scheduled releases
- 📈 Fetches post-publish analytics and drafts improvement tips using AI
- 🛡️ Avoids duplicate uploads using content hashes
- 🔔 Sends summary notifications via email, Discord webhook, or Telegram bot
- 📊 Dashboard (Next.js) to trigger runs on demand and review pipeline state
- 🗃️ Persists state in Vercel Postgres when available, with JSON-file fallback for local dev

## Project Structure

```
content/            # Drop videos + optional metadata files here
app/                # Next.js App Router UI & API routes
lib/                # Agent orchestration, scheduling, metadata, notifications
scripts/run-agent.ts# Node entrypoint for cron/CLI execution
```

## Configuration

Copy `.env.example` to `.env.local` and fill in the relevant values:

- **YouTube OAuth**: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- **OpenAI** (optional, required for AI metadata): `OPENAI_API_KEY`
- **Postgres** (recommended in production): `POSTGRES_URL` (or any compatible URL supported by `@vercel/postgres`)
- **Scheduling**: `TIMEZONE`, `UPLOAD_WINDOWS` (`HH:MM` comma list), `MAX_DAILY_UPLOADS`
- **Notifications**: choose one of email / Discord webhook / Telegram via `NOTIFICATION_CHANNEL`
- **Watermarking**: toggle `ENABLE_WATERMARK` and point `WATERMARK_IMAGE` at a PNG asset

> When Postgres credentials are absent, the agent falls back to a JSON store at `AGENT_DATA_STORE` (default `.agent-data.json`).

## Content Metadata

For any video file (e.g., `my-short.mp4`), the agent looks for a sibling metadata file:

- `my-short.json` – JSON object with keys like `title`, `description`, `tags`, `hashtags`
- `my-short.txt` or `.md` – simple `key: value` lines (ignored text and `#` comments allowed)

Missing fields are completed with OpenAI if an API key is supplied.

## Running Locally

```bash
npm install
npm run dev        # UI at http://localhost:3000
npm run agent:run  # Executes a single automation pass
```

The dashboard also exposes a "Run Agent" button that triggers `/api/agent`.

## Scheduling

- Use `npm run agent:cron` in a system scheduler (cron, pm2, etc.)
- On Vercel, configure a [cron job](https://vercel.com/docs/cron-jobs) to hit `POST https://<your-domain>/api/agent`

## Deployment

1. Ensure environment variables are configured in Vercel (including `POSTGRES_URL` for persistence)
2. Trigger the recommended build: `npm run build`
3. Deploy: `vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-9c630cb6`

After deployment, verify the production site:

```bash
curl https://agentic-9c630cb6.vercel.app
```

## Notes & Limits

- FFmpeg is bundled via `@ffmpeg-installer/ffmpeg`; ensure the binary is allowed in your target platform.
- YouTube scheduling requires `privacyStatus` of `private` or `unlisted` until the scheduled publish time.
- Remember to keep your refresh token valid; regenerate if uploads start failing with `401` errors.
- For advanced analytics, extend `lib/analytics.ts` to query YouTube Analytics API or persist deeper metrics.

