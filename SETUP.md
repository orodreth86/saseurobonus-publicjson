# Flight Bonus Notifier — daily page and RSS

Install this package in the PUBLIC repository:
`orodreth86/saseurobonus-publicjson`.

The private builder and existing `data/sasshops.json` publishing workflow stay as they are. This package reads the public JSON; it never changes that file or sends email.

## Install

1. Copy these files into the public repo, preserving their paths:
   - `.github/workflows/daily-news.yml` (make sure this hidden folder is included)
   - `scripts/build-daily-news.mjs`
   - `tests/daily-news.test.mjs`
   - This `SETUP.md` is optional.
2. Commit them to `main`.
3. In the public repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open **Actions → Daily bonus news and RSS → Run workflow** on `main`.
5. Open the Pages URL shown by the completed workflow.

Expected URLs (unless you configure a custom domain):
- Latest report: https://orodreth86.github.io/saseurobonus-publicjson/
- Archive: https://orodreth86.github.io/saseurobonus-publicjson/archive.html
- RSS: https://orodreth86.github.io/saseurobonus-publicjson/rss.xml

The workflow uses its built-in GITHUB_TOKEN; no new secret or external service is required. It needs permission to write the `daily-news-history` branch and deploy to the `github-pages` environment. If repository rules require all branch changes to go through PRs, allow this bot to write that history branch. The workflow does not write to `main`.

If this repository ALREADY has a GitHub Pages site, do not enable this workflow yet: it publishes the entire Pages site. Integrate the generator's output into that site's build instead.

## What readers get

- A responsive daily page showing old and new rewards, new shops, and shops removed from the feed.
- One archive page for every recorded date, including quiet days.
- RSS containing up to 90 editions with changes. Baseline and quiet days are omitted from RSS to avoid notification noise.
- Public-facing product branding is Flight Bonus Notifier; the flight reward column is called Flight points.

The first run saves a baseline and explicitly says tracking has started. It does not claim all existing shops are new. Changes begin on the following daily run. This version starts collecting from installation; it does not reconstruct old Git history.

The comparison is the latest published snapshot versus the previous recorded day's snapshot. It is not a log of every intraday movement. If a bonus increases and falls back between snapshots, it will not appear. If a scheduled run is missed, the next edition explicitly names the older comparison date.

A shop is normally identified by its normalized domain. Shops without domains use the flight slug or Trumf URL. Name/slug/URL edits on a matched domain do not become bonus news. Changing a domain is reported as a removed and added shop. Complementary duplicate-domain rows are merged; conflicting reward values stop the run for investigation.

Whitespace and decimal formatting changes are ignored. For Trumf, changes only to the calculated points in parentheses are ignored; cashback changes and qualifiers such as “Opptil” are reported. Availability of either offer is also tracked. All reward increases AND decreases are included.

## Schedule and reliability

The default cron is `45 21 * * *`: 21:45 UTC daily, which is 23:45 in Norway during summer time and 22:45 during winter time. GitHub may delay scheduled runs. The edition date uses Europe/Oslo.

Manual reruns on the same local date update that date's edition, still comparing against the previous day's baseline. RSS uses stable date-based GUIDs; whether an RSS reader alerts again on an edited edition is reader-specific.

Feed validation rejects empty or invalid JSON, a missing/invalid timestamp, data older than 36 hours, timestamps more than five minutes in the future, conflicting duplicate rewards, and a drop of more than 20% in shop count. On these failures the last deployed site stays live. Check Actions for failures. A genuine large removal requires inspecting the feed and deliberately adjusting the count guard before retrying.

The workflow keeps a one-file history on `daily-news-history`. It stores the latest two snapshots plus all dated reports. The branch is public because the data is already public. Do not delete it unless you intentionally want to reset the archive and baseline.

Saving history uses git object commands to update only that branch, avoiding push conflicts with the private feed publisher on main. If deployment fails after saving history, rerun on the same day; it rebuilds the edition safely.

GitHub can disable scheduled workflows in inactive public repositories; if updates stop, check Actions and re-enable the workflow. Your regular feed commits should normally keep the repo active.

## Local checks

Requires Node.js 24; no npm dependencies or package.json changes.

```sh
node --test tests/daily-news.test.mjs
node scripts/build-daily-news.mjs
```

The generator reads `data/sasshops.json`, saves `.daily-news/history.json`, and creates `_site/`. In the GitHub workflow, the history is restored before generation. Do not commit `_site/` or `.daily-news/` to main.

Optional environment variables: `SITE_URL`, `NEWS_INPUT`, `NEWS_HISTORY`, `NEWS_OUTPUT`. The configured Pages URL is passed automatically by the workflow. If you add a custom domain later, rerun the workflow to update RSS and navigation URLs.

## Extension link later

Once the page is live, a “Daily bonus changes” link can point to the latest-report URL above. The extension itself does not need to change for the website or RSS to work. RSS subscriptions are handled by readers; no subscriber data is stored by this site.
