# Deploying Gossip Genie

1. Create a new Netlify site from this folder (its own site, like Gameday).
2. Environment variables:
   - `ANTHROPIC_API_KEY` — the writer. Required.
   - `SYNC_TOKEN` — any long random string. Gates run, sync-now and pull.
   - `ANTHROPIC_MODEL` — optional; defaults to `claude-sonnet-4-5`.
   - `ANTHROPIC_WORKSPACE_ID` — only needed if the API key is not scoped to a workspace (the run log will say so).
   - `BUZZ_PAUSED` — set to `1` to stop publishing without redeploying.
3. Deploy. Then prime the feed (scheduled runs cannot be triggered by hand):
   `curl -X POST -H "x-sync-token: $SYNC_TOKEN" https://<site>/.netlify/functions/sync-now`
4. After 3–5 minutes, check `https://<site>/api/status`:
   - `history[0].published` and `byStrand` — what ran
   - `lastRun.lines` — per-source counts (a feed showing 0 items has moved its URL)
   - `lastRun.dropped` — every story rejected, with the stage and reason
5. The schedule (`sync-schedule`) then runs at 13:00, 19:00 and 00:00 UTC —
   6am, noon and 5pm Pacific in daylight time (an hour earlier in winter).

Needs Netlify background functions (the run takes a few minutes).

## Sharing — what a deploy has to get right

Share previews depend on two things being true on the live site. Both are
worth checking once, after the first deploy that includes them.

1. **Real paths reach the app.** Open `https://<site>/story/<any id>` in a new
   tab. It must show that story, not the front page and not a 404. The rules
   in `netlify.toml` that send `/story/:id` and friends to the page function
   sit *above* the `/*` catch-all, and order is what makes them work.

2. **Cards draw.** Open `https://<site>/og/home.png`. It should be a
   1200×630 PNG in brand type. If it is the generic site card everywhere, the
   function is running but cannot read the blob stores; if it 500s, resvg did
   not load — check that `external_node_modules` still lists `@resvg/resvg-js`
   in `netlify.toml`, since bundling that native module produces a function
   that loads nowhere.

Then paste a story link into <https://cards-dev.twitter.com/validator> or
Facebook's sharing debugger and confirm the title, blurb and picture are the
story's own. Facebook caches hard, so use its "Scrape Again" button after any
change to the tags.

The fonts in `netlify/fonts/` are committed on purpose — a deploy should not
depend on `npm run fonts` having been run. If the brand fonts are ever
updated, run it and commit the result.

`dist/index.html` is bundled into the page function through `included_files`
so the function serves the app Vite just built. If that ever stops working the
function falls back to fetching `/index.html` from the site itself, so the
symptom is slower story pages rather than broken ones.

## The Genie 100 — the first edition

The chart publishes itself every Monday at 13:00 UTC once a full week has been
measured. Two things are worth doing once.

1. **Check it fired.** After the first Monday, `https://<site>/api/chart`
   should return an edition with `entries`. Until then it returns
   `{"empty": true}` with the date of the next one, which is the correct
   answer and what the screen shows.

2. **Backfill, if there is history to backfill.** If the market has been
   running for several weeks before the chart shipped, those weeks can be
   published from the rollups already in the store:

   ```
   SYNC_TOKEN=$(netlify env:get SYNC_TOKEN)
   curl -X POST -H "x-sync-token: $SYNC_TOKEN" \
     "https://<site>/.netlify/functions/market-run-background?chart=1&backfill=1"
   ```

   It is safe to run twice: a week that already has an edition is skipped, and
   nobody gains a week on chart from a re-run.

An edition never changes once published. If one genuinely has to be replaced —
a bad week of data, say — add `&week=2026-W38&replace=1`, and know that the
records file is rebuilt from the earlier editions so the replacement does not
double-count anybody's weeks on chart.

`MARKET_PAUSED=1` stops the chart job along with the rest of the market.

## Before the first live run — check these

- GDELT rate-limits Netlify's shared addresses (HTTP 429 on the first run). It is kept as a bonus;
  the outlet RSS feeds in `pipeline/config.mjs` are what the app now relies on.
- The RSS URLs in `pipeline/config.mjs` were set from the agencies' published feed
  addresses and have not been fetched from this build environment. `/api/status`
  shows each one's item count after the first run.
- Cost: about 10–20 writer calls per run, 3 runs a day.
