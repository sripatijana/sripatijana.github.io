# Chem Radar collector (Cloudflare Worker)

Runs on Cloudflare's free Workers plan as `chemradar` → https://chemradar.janasripati.workers.dev

- Cron `*/4 * * * *`: refreshes 2 journals per run (rotating), so every journal is refreshed hourly and each run stays under the free plan's 10 ms CPU limit. KV writes ≈ 720/day (free limit 1,000).
- KV namespace bound as `FEEDS` (one key per journal).
- `GET /articles.json`: merged feed used by ../index.html (CORS enabled, cached 5 min)
- `GET /status`: last fetch result for every journal

To add or remove a journal, edit the `JOURNALS` list in `worker.js` **and** `../journals.json`, then redeploy the worker (Cloudflare dashboard → Workers & Pages → chemradar → Edit code, paste, Deploy).
