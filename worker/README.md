# FantasAI CBS Worker

Cloudflare Worker that pulls your CBS Sports fantasy league and serves JSON to the FantasAI Football app.

Stays on the free tier for normal use (100k requests/day). Total cost: **$0**.

---

## What this does

CBS Sports doesn't publish a fantasy API. Their league pages are protected behind a login cookie and served as HTML. This worker:

1. Holds your CBS session cookie as a Cloudflare secret (never exposed to the browser)
2. Fetches CBS pages on your behalf
3. Parses the HTML and returns clean JSON
4. Caches responses for 5 minutes to be polite

The FantasAI Football frontend calls this worker instead of trying (and failing) to call CBS directly.

---

## One-time setup

### 1. Install prerequisites

```bash
# Node 24+ required (tested on v24.16.0)
node --version

# Install dependencies (includes wrangler)
cd worker
npm install
```

**Windows users:** Node 24 requires the system CA store for npm to reach the registry. This is set permanently in your user environment — you should only need to do this once:

```powershell
[System.Environment]::SetEnvironmentVariable("NODE_OPTIONS", "--use-system-ca", "User")
```

Restart any open terminals after running that.

### 2. Sign up for Cloudflare (free) + create an API token

Sign up at <https://dash.cloudflare.com> — no credit card needed for the free tier.

Then create an API token so wrangler can deploy without opening a browser (required if your antivirus blocks OAuth callbacks):

1. Cloudflare dashboard → top-right avatar → **My Profile** → **API Tokens** → **Create Token**
2. Use the **Edit Cloudflare Workers** template
3. Set **Account Resources** to your specific account
4. Click **Continue to summary** → **Create Token** → copy it (shown once)

Set it permanently in your user environment:

```powershell
[System.Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "your-token-here", "User")
```

Also add your account ID to `wrangler.toml` (find it in the Cloudflare dashboard URL: `dash.cloudflare.com/<account-id>/workers`):

```toml
account_id = "your-account-id-here"
```

### 3. Grab your CBS session cookie

You only do this once (or whenever CBS logs you out, usually every few weeks).

1. Open Chrome/Edge and log into your CBS league: <https://atotauleague.football.cbssports.com>
2. Confirm you can see your actual league dashboard (not a login screen)
3. Open DevTools (`F12`) → **Console** tab
4. Paste this and press Enter:
   ```javascript
   copy(document.cookie)
   ```
5. Your clipboard now has the full cookie string — paste it in the next step

The cookie is a long semicolon-separated string with 15–25 entries including session tokens, auth tokens, and preferences.

### 4. Set your secrets

**For local development**, create `worker/.dev.vars` (never commit this file):

```
CBS_COOKIE=paste_your_full_cookie_string_here
```

**For production deployment**, set secrets via wrangler from the `worker/` folder:

```powershell
# Paste the cookie string when prompted (it won't echo)
npx wrangler secret put CBS_COOKIE

# (Optional) Add a shared secret so only your FantasAI app can hit this worker
npx wrangler secret put FANTASAI_KEY
# When prompted, type any random string and remember it
```

> **Cookie size limit:** Cloudflare secrets have a 5.1 kB limit. The raw `document.cookie` output often exceeds this due to tracking cookies. If you hit the limit, run this in the browser Console instead to strip non-essential cookies before copying:
> ```javascript
> const strip = ['_ga','_gid','_gat','_fbp','_fbc','IDE','ar_debug',
>   'OptanonConsent','OptanonAlertBoxClosed','utag_main','surround',
>   'XFP_FIRSTPAGE','xfpFtag','receive-cookie-deprecation','audit_p',
>   'ketchFulfillmentState','AMCV_','AMCVS_','s_ecid','_li_','li_gc','li_pbid',
>   's_','ug_','xfp','_cb','_chartbeat','__gads','__gpi','__eoi',
>   'pxcts','_pxvid','_px','wickedfu'];
> const filtered = document.cookie.split('; ').filter(c => {
>   const name = c.split('=')[0].trim();
>   return !strip.some(t => name === t || name.startsWith(t));
> }).join('; ');
> copy(filtered);
> console.log(filtered.length + ' chars');
> ```

### 5. (Optional) Enable caching

KV storage caches CBS HTML for 5 minutes, reducing load and speeding things up.

```powershell
npx wrangler kv:namespace create CACHE
```

It prints something like:
```
[[kv_namespaces]]
binding = "CACHE"
id = "abc123def456..."
```

Paste those 3 lines into `wrangler.toml` (uncomment the placeholder block).

### 6. Deploy

From the project root (`d:\Project\Fantasy\`), run:

```powershell
.\deploy
```

This builds the app and deploys all three pieces (app, worker, worker-api) in one shot.

To deploy just this worker individually:

```powershell
npx wrangler deploy
```

Output looks like:
```
Published fantasai-cbs (1.23 sec)
  https://fantasai-cbs.YOUR-SUBDOMAIN.workers.dev
```

That URL is your worker. Save it.

---

## Local development

```bash
cd worker
npm run dev
# Ready on http://127.0.0.1:8787
```

Wrangler loads `.dev.vars` automatically. Open `http://127.0.0.1:8787/api/health` in your browser — you should see `"hasCookie": true`.

## Verify it works

```bash
# Should return { ok: true, hasCookie: true, ... }
curl http://127.0.0.1:8787/api/health
```

Then try a real endpoint:

```bash
curl http://127.0.0.1:8787/api/cbs/league
```

If it returns `{ error: "CBS auth failed..." }`, your cookie is wrong or expired. Re-run step 3 + step 4.

If it returns `{ error: "CBS returned the login page..." }`, same fix.

---

## Adapting the parsers to your league

**This is the part you'll likely need to iterate on.**

The parsers in `src/index.js` use HTMLRewriter with selectors that are educated guesses based on common CBS Sports patterns. CBS doesn't publish their schema, so you'll need to adjust selectors to match what your actual league pages return.

### Workflow

1. Use the debug endpoint to see raw HTML from any CBS page:
   ```
   /api/debug/fetch?path=/standings
   /api/debug/fetch?path=/teams/1
   /api/debug/fetch?path=/draft/results?year=2024
   /api/debug/fetch?path=/players/rankings
   ```

2. Open the response in your browser, search for player names you recognize.

3. Note the surrounding HTML — what classes, data attributes, table structures?

4. Edit the relevant parser function in `src/index.js`:
   - `parseTeams` → for standings/team list
   - `parseRoster` → for `/teams/{id}` pages
   - `parseRankings` → for the rankings page
   - `parseDraft` → for draft history
   - `parseTransactions` → for /transactions

5. Redeploy: `wrangler deploy`

6. Test the corresponding endpoint and verify the JSON looks right.

### Tips

- HTMLRewriter docs: <https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/>
- CBS often uses `data-*` attributes — those are gold for parsing (`data-player-id`, `data-team-id`)
- If selectors fail entirely, the fallback regex paths kick in, but they're less precise
- Class names sometimes have hashed suffixes (`team-name_AbC123`); use partial matches: `[class*="team-name"]`

---

## Endpoints

Base URL (local dev): `http://127.0.0.1:8787`
Base URL (production): `https://fantasai-cbs.fantasai.workers.dev`

| Method | Path | Query Params | Returns |
|---|---|---|---|
| GET | `/api/health` | — | Worker status, `hasCookie`, `requiresKey`, available routes |
| GET | `/api/cbs/league` | — | League name (`ATO Tau League`), season year, team count, scoring format |
| GET | `/api/cbs/teams` | — | All 12 teams with id, name, W/L/T record, PF, PA |
| GET | `/api/cbs/rosters` | — | Every team's roster keyed by team id (one CBS fetch per team — slow) |
| GET | `/api/cbs/rankings` | `pos=ALL` | CBS consensus Top 200; filter by `QB`, `RB`, `WR`, `TE`, `K`, `DST` |
| GET | `/api/cbs/draft` | `year=<YYYY>` | Full draft order: pick number, round, pick-in-round, team, player |
| GET | `/api/cbs/transactions` | — | Waiver claims and trades (empty off-season) |
| GET | `/api/cbs/scoring` | — | Detected scoring format (`Standard`, `PPR`, `Half PPR`) |
| GET | `/api/debug/fetch` | `path=<cbs-path>`, `full=1` | Raw HTML from any CBS path — use to inspect selectors |

### Authentication header

If you set `FANTASAI_KEY`, every endpoint except `/api/health` requires:
```
X-FantasAI-Key: <your-key>
```

### Example responses

```bash
# Health check
curl https://fantasai-cbs.fantasai.workers.dev/api/health
# { "ok": true, "hasCookie": true, "requiresKey": false, ... }

# League info
curl https://fantasai-cbs.fantasai.workers.dev/api/cbs/league
# { "source": "cbs", "league": { "name": "ATO Tau League", "season": 2026, "leagueSize": 12, "scoring": "Half PPR" } }

# Teams/standings
curl https://fantasai-cbs.fantasai.workers.dev/api/cbs/teams
# { "source": "cbs", "teams": [ { "id": "1", "name": "Bourbon is a Vegetable", "record": "0-0-0", "w": 0, "l": 0, "t": 0, "pf": 0, "pa": 0 }, ... ] }

# Rankings — top 200 consensus
curl https://fantasai-cbs.fantasai.workers.dev/api/cbs/rankings
# { "source": "cbs", "position": "ALL", "count": 200, "rankings": [ { "rank": 1, "playerId": "...", "name": "Jahmyr Gibbs", "pos": "RB", "team": "DET" }, ... ] }

# Rankings filtered by position
curl "https://fantasai-cbs.fantasai.workers.dev/api/cbs/rankings?pos=QB"
# { "count": 21, "rankings": [ { "rank": 29, "name": "Josh Allen", "pos": "QB", "team": "BUF" }, ... ] }

# Draft order (players null until draft day)
curl "https://fantasai-cbs.fantasai.workers.dev/api/cbs/draft?year=2025"
# { "picks": [ { "pickNum": 1, "round": 1, "pickInRound": 1, "team": "Howdy Hut", "player": null }, ... ] }

# Scoring format
curl https://fantasai-cbs.fantasai.workers.dev/api/cbs/scoring
# { "scoring": { "format": "Half PPR", "detected": { "isHalfPPR": true, "isPPR": false } } }

# Debug — inspect raw HTML for any CBS path
curl "https://fantasai-cbs.fantasai.workers.dev/api/debug/fetch?path=/standings&full=1"
```

---

## Tail logs in real time

```bash
wrangler tail
```

Then call your worker from the app — you'll see every request and any errors.

---

## Common problems

**`CBS_COOKIE secret not set`** — You skipped step 4. Run `npx wrangler secret put CBS_COOKIE`.

**`CBS auth failed (401)`** — Cookie expired. Grab a fresh one and re-run `npx wrangler secret put CBS_COOKIE`.

**`CBS returned the login page`** — Same as above. CBS sometimes returns 200 OK with a login page rather than a 401; the worker detects this.

**Cookie too large (5.1 kB limit)** — Use the stripping script in step 4 to remove tracking cookies before uploading.

**`wrangler` not recognized** — Use `npx wrangler` instead. Wrangler is installed locally, not globally.

**OAuth browser blocked by antivirus** — Use a Cloudflare API token instead of OAuth (see step 2). Set `CLOUDFLARE_API_TOKEN` as a permanent environment variable.

**`Failed to automatically retrieve account IDs`** — Add `account_id` to `wrangler.toml` (see step 2).

**Rosters return empty arrays** — The roster parser (`parseRoster` in `src/index.js`) uses placeholder selectors. Once the season starts and rosters are populated, use `/api/debug/fetch?path=/teams/1` to inspect the HTML and update the selectors. All other parsers (`teams`, `rankings`, `draft`, `transactions`) are confirmed working against the live CBS HTML.

**Wrangler asks for a credit card** — You're trying to use a paid feature. The free tier (Workers + KV) does not require a card. If prompted, double-check you're on the free plan.

---

## Updating

Whenever you edit `src/index.js`:

```powershell
npx wrangler deploy
```

That's it. New version is live in seconds. Old versions stay rolled-back-able from the Cloudflare dashboard.

---

## Costs

- Free tier: 100,000 requests / day, 10ms CPU / request
- Realistic usage for one person tracking one league: 500–2,000 requests / day
- If you ever exceed: $5/month for 10M requests

For your league of 12, even if everyone used FantasAI heavily, you'd stay well under the free tier.
