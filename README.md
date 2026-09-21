# Gossip Genie

Family-friendly celebrity, health, fantastic-facts and bizarre news. 30 stories a
day (12 celebrity, 6 of each other strand), written in Kapang's own words,
auto-published three times a day, with a 1920×1080 Watch screen that runs as a
looping half-hour channel.

A Genie app (see ../genie-brand), built on the same pattern as El Niño Watch and Gameday Weather:
scheduled sync → normalised JSON in Netlify Blobs → the client only ever reads
our own API. The wipe and lower third (treatment B) are
copied into `src/ui` from `kapang-weather/packages/kapang-ui`.

## How a story gets on air

```
harvest        GDELT (mainstream outlets only) + US-government RSS (NASA, NIH, FDA) + UPI odd news
cluster        the same story from many outlets becomes one story with an outlet count
already done?  skip anything covered in the last 7 days
safety gate 1  blocklist on every source headline (crime, death, adult, politics, gossip patterns…)
verify         celebrity: 2+ independent outlets, always. Others: 2 outlets or one official source
score          coverage first, freshness second; this run's share of the 12/6/6/6 day
write          Claude writes headline, caption, body, key facts, quiz — only facts the sources agree on
safety gate 2  the writer's own family-safe verdict
safety gate 3  blocklist again on the finished copy
copy check     rejected if it shares 8+ consecutive words with a non-government source
image          celebrity: their own Wikimedia Commons photo under CC/PD only, credited
               facts: NASA library (public domain); others: Commons under CC/PD, no people
               anything unclear → a typographic card, never a guess
publish        merge into feed.json (72 h window), rebuild the Buzz Board
```

Writing stops for a strand the moment its quota is met, so the API is never
called for stories that will not run.

## Controls (no human approval step — these stand in for it)

| Control | How |
| --- | --- |
| Stop all publishing | set `BUZZ_PAUSED=1` on the site |
| Pull one story now | `curl -X POST -H "x-sync-token: $SYNC_TOKEN" "https://<site>/api/pull?id=<id>"` |
| Viewer reports | "Report a problem" on every story; 3 reports take it off air automatically |
| See what ran and why stories were dropped | `https://<site>/api/status` |

## The Genie 100

The market answers "who is hot right now", every fifteen minutes. Nobody
cites a number that changes every fifteen minutes — there is nothing to point
at and no reason to come back. So the same data is frozen once a week and
published as a chart.

```
chart week    Monday 00:00 → Sunday 23:59 UTC, the same boundary the daily rollup uses
a position    the Gossip Score AVERAGED across all seven days, not Sunday night's reading
eligibility   at least 5 of the 7 days measured, so a name added on Friday cannot chart
published     Monday 13:00 UTC (9am Eastern in summer, 8am in winter)
immutable     an edition is written once and never changes
```

Each entry carries what a chart entry has to carry: last week's position, the
move, peak position, weeks on chart, and NEW / RE for an entry and a re-entry.
Those are kept in a running records file (`charts/records.json`) rather than
recomputed, so a re-entry after two years off still knows it once reached
number four.

### What warrants a rise

Four rules, because "somebody got a story" is not a reason to go up.

**A week is seven days long for everybody.** `weekScore` used to average only
the days that had a reading, so a name present for four loud days scored the
mean of those four while a name present all week carried its quiet days too:
62/58/70/55 charted at 61.3 and a steady 48 charted at 48, and the spiky name
won *because the days it was absent cost nothing*. Absent days are now scored
at that celebrity's own trailing normal (damped by `CHART.quietDayFactor`),
or at the population's if they have no history yet. A day nobody at all was
measured on is an outage rather than an absence and is dropped from the week
for everyone.

**Momentum cannot manufacture a score.** It was a fourth weighted component,
folded from −100..+100 into 0..100 — so momentum of exactly zero scored 50
and handed every name a quarter of its weight for being alive. For a quiet
celebrity that was two thirds of their whole score. It is now a bounded
multiplier on the news component (`MOMENTUM_MODIFIER`): nothing accelerating
multiplies by 1 and is worth nothing, and a name with no coverage gets no
benefit at all, because there is nothing to multiply.

**A rise has to be visible in more than one place.** Three independent
signals — coverage (how much was written), breadth (how many separate
newsrooms wrote it) and search (how many people went looking afterwards). A
real event moves more than one; one outlet repeating itself moves coverage
alone. A climb that clears the score but not the corroboration bar still
charts — the score is the score — and is marked **thin**, on the screen and
on its own share card. Falls are never marked thin: a fall is not a claim
that needs propping up. The test only runs once every signal has a previous
reading, because requiring two of two is a stricter bar than two of three and
would punish a name for our own missing history.

**Sustained is not the same as spiky.** `weekShape` classifies every week as
`sustained`, `building`, `fading`, `spike` or `steady`, which is the
difference between a new level and a loud Tuesday — and is the spine of the
sentence the chart writes about it.

### Why a name moved

`market/evidence.mjs` builds one record per entry, from the same numbers that
produced the rank: the move, the week day by day, which signals moved and by
how much, how many corroborated it, and the hard evidence behind it.
`src/lib/narrative.js` turns that record into English with deterministic
templates — no model call, a hundred lines published instantly and identically
every time, and no way for a sentence to drift from the number it explains.

This replaced a `reason` that was looked up after the fact — "which story in
the feed mentions this person most recently?" — computed in a different file
from the score and frequently about a different event. A name could climb on
search interest with no coverage at all and still be captioned with whichever
article carried their name. The story survives inside the record as
supporting evidence, somewhere for a reader to go; it is no longer the
explanation.

The chart page, the front-page strip, the Watch countdown and the share card
all read that one record, so the four surfaces cannot describe the same rank
four ways. `market/rules.test.mjs` runs each rule end to end.

```
market/chart.mjs       pure: chart weeks, the week's score, building an edition
market/chartjob.mjs    reads the rollups, writes the edition, idempotent
netlify/functions/chart-weekly.mjs   the Monday schedule
/api/chart             this week · /api/chart/2026-W38 · /api/chart/index
/chart, /chart/:id     the screens, with their own preview cards
```

Locally:

```
npm run market:once                     # fill .market-data/
node scripts/chart-local.mjs            # build and print the last complete week
node scripts/chart-local.mjs --backfill # every week the data covers
```

On the live site the job runs itself. To fill in weeks that were missed, or to
publish for the first time from history already in the store:

```
SYNC_TOKEN=$(netlify env:get SYNC_TOKEN)
curl -X POST -H "x-sync-token: $SYNC_TOKEN" \
  "https://<site>/.netlify/functions/market-run-background?chart=1&backfill=1"
```

### One chart, two states

The front page used to carry two ranked lists of celebrity names with signed
numbers beside them — the chart and a live movers strip — in the same visual
language, with nothing saying why there were two. There is now one ranking in
two states, and they are the same screen:

```
/chart/live   this week so far — provisional, rewritten every 15 minutes,
              counting down to Monday
/chart        last week — published, frozen, permanent
```

That is also what makes the site worth returning to. A weekly chart is the
same page for six days out of seven; the running order moves every quarter of
an hour, the countdown ticks, and rows carry a badge for what has moved since
*this reader* last looked (`src/lib/lastseen.js` — kept in the browser, never
sent anywhere, and held for half an hour so a refresh does not wipe the marks
you came back to read).

The live standings are built at the end of every ingestion run from rollups
already in memory, plus today's snapshots reconstructed into a partial day, and
written to `charts/live.json`. They are never written to a published key and
carry `live: true` and `provisional: true` so nothing can mistake a running
order for an edition.

### Reading the chart

A score bar on every row, anchored at zero rather than scaled to whoever is
top — so a quiet week looks like a quiet week and two weeks can be put side by
side. One series, so no legend: the score column beside it names it. The bar
hue was validated against the up/down/new status colours and the dark surface
for colour-vision separation; the obvious blues failed against the neutral ink
and are not used.

A row's reason line shows only our own published stories. "Being covered by X
and Y" is useful on one row and wallpaper on a hundred, so on the chart it is
kept for the number one.

**The archive is the asset.** Daily rollups are kept indefinitely
(`RETENTION.rollupDays`), and a test asserts it. GDELT and Wikipedia will both
answer about today and neither will answer about a Tuesday nobody recorded —
weeks on chart, peak positions and every long-range comparison are counted
from that file, and it cannot be rebuilt. There is no meaningful space to save
by pruning it.

## Screens

- `/` home — animated Watch tile, today's count out of 30, market strip, topic tabs, follow a topic or person
- `/story/<id>` — story, key facts, why it's buzzing, sources, photo credit, report
- `/chart`, `/chart/<week>` — the Genie 100: this week's edition and the archive
- `/market`, `/market/<slug>` — the live Celebrity Market and one celebrity's page
- `/buzz` — redirects to the market
- `/quiz` — five true-or-false questions a day, streak kept on the device
- `/watch` — the 1920×1080 channel. `?speed=10` and `?seg=numberOne` for QA
- `/vertical` — the same show at 1080×1920 for TikTok, Reels and Shorts: faster pace (30 s stories),
  everything readable kept inside the platforms' safe zones (top 150 px, bottom 420 px, right 120 px).
  `?guides=1` shows those zones in red.

The Watch show clock (`src/lib/rundown.js`) is a chart show, not rolling news.
The half hour is the Genie 100 counted down: title card → Top Story → number
ten, then a story or a break between each position, down to number one, then
the ten in full and loop (about 18 minutes). The running order is written out
as data in `SHOW`, so it can be read and argued with rather than derived from
three constants.

Ten is a countdown; twenty is a list, so `COUNTDOWN = 10`. The story block
rotates by the half hour (`rotate`), which is what stops the channel showing
the same nine stories all day while twenty-one sit unused. Mornings lean
Health/Facts, evenings Celebrity, never two celebrity stories back to back, and
never two chart positions back to back either. New stories that land mid-show
jump the queue with a "Just in" tag.

With no chart — before the first market run, or if the store is unreachable —
it falls back to the old news shape rather than showing an empty countdown. A
channel with no chart is still a channel. Sponsor breaks are not built yet —
room is left in the clock.

Where a viewer joins comes from the wall clock (`src/lib/showclock.js`), nudged
forward past anything they have already watched. That nudge looks THROUGH
furniture: the title card carries no stories and so can never have been seen,
and a join that stopped there would hand a returning viewer the top story they
watched this morning.

Until the first run publishes, the app shows a clearly labelled sample feed.
Sample celebrities are fictional on purpose.

## Develop

```
npm install
npm test            # safety, clustering, quotas, parsing, writer, images, feed, full runs,
                    # rundown, routing, share copy, preview tags and alert rules
npm run dev         # http://localhost:5175
ANTHROPIC_API_KEY=… npm run run:local   # one real run into .data/, which dev serves at /api/feed
```

`npm test` covers everything that is pure. The screens are fixed pixel
canvases, so they are checked in a real browser instead — Playwright, which is
deliberately NOT a dependency of this project (its postinstall downloads
browsers and would sit in the middle of every Netlify build):

```
npm i --no-save playwright && npx playwright install chromium

node scripts/watch-audit.mjs --url http://localhost:5175            # every segment, both cuts:
node scripts/watch-audit.mjs --url http://localhost:5175 --stress   # clipped, offstage, overlapping
node scripts/watch-controls-audit.mjs --url http://localhost:5175   # tap, skip, pause, join, catch-up
node scripts/watch-timing-audit.mjs --url http://localhost:5175     # the show runs to its own clock
node scripts/wide-motion-audit.mjs --url http://localhost:5175      # the reel cuts and footage plays
node scripts/vertical-crop-audit.mjs --url http://localhost:5175    # nobody's head is cropped off
node scripts/bulletin-audit.mjs --url http://localhost:5175         # the presenter and her headlines
node scripts/market-audit.mjs --url http://localhost:5175           # the market screens at every width
node scripts/share-audit.mjs --url http://localhost:5175            # routes, preview tags, cards, bell
```

Pass `--shots out/` to any of them to keep a PNG per frame. They drive the
show through its own QA switches (`?seg=`, `?speed=`), which the app reads from
the query string and the fragment both — a legacy `#/watch?seg=quiz` link with
anything before the hash used to lose them silently.

The timing audit is the exception: it watches the channel at real speed for
three and a half minutes, because `?speed=` scales the segments and the wipe's
hold but not its sweeps, and so distorts the one ratio it is measuring. It is
there because a show can be correct in every frame and still run at the wrong
length — which it did. The join offset was applied to every segment rather
than to the one segment that was joined, so after a minute or so the channel
put each chart position on air for three tenths of a second (the floor in
`useSegmentEnd`) and wiped again. Nothing static could see it. This times each
segment against the duration the stage declares in `data-dur`, and times the
handover against `HANDOVER_SECONDS`.

See DEPLOY.md to put it live.

## Sharing

Every address is a real path, not a fragment. That is the whole point: a
fragment never reaches the server, so for as long as the app routed on `#/`,
every link anybody shared previewed as the same generic page. Old `#/…` links
still work — `src/lib/useRoute.js` rewrites them before the first render.

```
/chart, /chart/:week, /story/:id,     → netlify/functions/page.mjs
/market, /market/:slug, /strand/:key,    the built app with this page's own
/watch, /vertical, /quiz                 title, blurb and card in its head
/og/*.png                             → netlify/functions/og.mjs
                                         the card itself, drawn on demand
```

`/` is not routed through the function: its tags never change, so they sit in
`index.html` and the front page stays a plain CDN hit.

Cards are hand-drawn SVG rasterised by resvg (`netlify/lib/card.mjs`). Text is
measured against the real font files (`netlify/lib/textmetrics.mjs`) so
headlines wrap and shrink to the box, and the up/down arrows are drawn paths —
neither Bebas Neue nor IBM Plex has a triangle glyph. The brand TTFs live in
`netlify/fonts/` and are regenerated from the @fontsource woff files with
`npm run fonts`.

```
npm run cards                          # draw every card variant to out/cards
node scripts/share-audit.mjs --url http://localhost:5175 --shots out/
```

The share control itself is `src/ui/Share.jsx`: the operating system's share
sheet on a touch screen, a short menu everywhere else. Nothing is appended to
the URL — a link with a campaign parameter on it is not the same link the next
person shares.

## Notifications

A bell in the header, worked out in the page from the feed and the market the
app has already loaded (`src/lib/alerts.js`). Nothing is polled and nothing
leaves the browser. It says four kinds of thing: a followed celebrity in
today's stories, a followed celebrity whose score has moved sharply, a followed
strand with something new, and a quiz streak about to lapse — plus a count of
what is new since the reader was last here.

What has been read is kept in its own storage key (`src/lib/noticestate.js`),
separate from follows and quiz streaks, because it changes on every visit.

Push notifications are deliberately not built. They would need a service
worker, a VAPID key pair, a subscription store and a server-side job to decide
who to wake — and, more to the point, a reason for somebody to say yes to the
permission prompt. The bell is that reason, and it comes first.

## Brand

Gossip Genie uses the shared Genie mark. `src/brand/Genie.jsx` and `src/brand/genie.css`
are copied from `~/Documents/genie-brand` — don't edit them here; regenerate them there.
The Netlify Blobs store keeps its original name (`kapang-buzz`) so the feed carried over.

## Genie Quiz

After each run, `pipeline/quiz.mjs` asks Claude for 6 multiple-choice questions sparked by the day's
stories — one step broader than the story (the science, place, record, film or song behind it), never
the headline read back. A second Claude pass fact-checks every marked answer; anything it isn't sure of
is dropped. Stored as `feed.quiz`, rebuilt when new stories land or after 8 hours, and the last good quiz
stays if a build fails. On the Watch screens the question ("Comment A, B, C or D") comes first and the
**Answer Reveal** — with the explanation as the reward — plays three stories later. The website quiz
uses the same questions.
