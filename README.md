# MBTA Bus Tracker with shared 5-hour history

One site that everyone opens, with a collector that records every bus once a minute, around the clock.

## Files
- public/index.html – the bus tracker page
- netlify/functions/collect.mjs – scheduled collector (runs every minute, keeps 5 hours)
- netlify/functions/history.mjs – lookup API the page calls (/api/history)
- netlify.toml, package.json – Netlify settings

## Deploy (browser only, nothing to install)
1. On github.com create a new repository and drag the CONTENTS of this folder into "Add file > Upload files"
   (keep the netlify and public folders intact). Commit.
2. On netlify.com choose "Add new site > Import an existing project", pick GitHub and that repository.
   Leave the build command empty. Deploy.
   (Drag-and-drop deploys do not include functions, so the GitHub route is required.)
3. Recommended: get a free key at api-v3.mbta.com, then in Netlify go to Site configuration > Environment variables
   and add MBTA_API_KEY. Without it, MBTA may rate-limit Netlify's shared servers.
4. Open the site. The history panel should read "Shared history, recorded around the clock…".
   Right after the first deploy it may say the collector hasn't recorded anything yet; give it a couple of minutes.
5. Check it is running: Netlify > Logs > Functions > collect should show a line every minute.

History only exists from the moment the collector starts. It cannot be backfilled.
