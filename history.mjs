// Read-only API the bus tracker page calls to look up the shared history.
import { getStore } from "@netlify/blobs";

const WINDOW = 5 * 60 * 60 * 1000;
const BUCKET = 15 * 60 * 1000;
const LOOKBACK = 15 * 60 * 1000;
const toObj = (a) => ({ ts: a[0], label: a[1], route: a[2], stop: a[3], status: a[4], dir: a[5], lat: a[6], lon: a[7], stopId: a[8] ?? "" });
const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });

async function loadEvents(store, from, to) {
  const { blobs } = await store.list({ prefix: "events/" });
  const keys = blobs.map((b) => b.key).filter((k) => {
    const start = Number(k.slice(7));
    return start + BUCKET > from && start <= to + BUCKET;
  });
  const out = [];
  for (let i = 0; i < keys.length; i += 8) {
    const parts = await Promise.all(keys.slice(i, i + 8).map((k) => store.get(k, { type: "json" })));
    for (const part of parts) for (const a of part || []) if (a[0] >= from && a[0] <= to) out.push(a);
  }
  return out;
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const op = params.get("op");
  const store = getStore({ name: "bus-history", consistency: "strong" });
  const now = Date.now();
  const reply = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

  try {
    if (op === "status") {
      const meta = await store.get("meta", { type: "json" });
      if (!meta) return reply({ empty: true });
      const { blobs } = await store.list({ prefix: "events/" });
      const oldestBucket = blobs.length ? Math.min(...blobs.map((b) => Number(b.key.slice(7)))) : meta.since;
      return reply({ oldest: Math.max(oldestBucket, meta.since), updated: meta.updated });
    }

    if (op === "stops") {   // every stop name seen in the window, cached for 10 minutes
      const cache = await store.get("stops-cache", { type: "json" });
      if (cache && now - cache.at < 10 * 60 * 1000) return reply({ stops: cache.stops });
      const names = new Set();
      for (const a of await loadEvents(store, now - WINDOW, now)) if (a[3]) names.add(a[3]);
      const stops = [...names].sort((x, y) => x.localeCompare(y));
      await store.setJSON("stops-cache", { at: now, stops });
      return reply({ stops });
    }

    if (op === "bus") {
      const q = (params.get("q") || "").trim();
      if (!q) return reply({ events: [] });
      const all = await loadEvents(store, now - WINDOW, now);
      let rows = all.filter((a) => a[1] === q);
      if (!rows.length) rows = all.filter((a) => a[1].startsWith(q));
      return reply({ events: rows.map(toObj).sort((a, b) => b.ts - a.ts) });
    }

    if (op === "at") {
      const t = Number(params.get("t"));
      if (!t || t > now || t < now - WINDOW) return reply({ events: [] });
      const route = params.get("route") || "";
      const latest = new Map();   // each bus's most recent record at or before t, across all routes
      for (const a of await loadEvents(store, t - LOOKBACK, t)) {
        const prev = latest.get(a[1]);
        if (!prev || a[0] > prev[0]) latest.set(a[1], a);
      }
      const rows = [...latest.values()].map(toObj).filter((e) => !route || e.route === route).sort(byLabel);
      return reply({ events: rows });
    }

    if (op === "stopEvents") {
      let names = [], ids = [];
      try { names = JSON.parse(params.get("names") || "[]"); } catch { names = []; }
      try { ids = JSON.parse(params.get("ids") || "[]"); } catch { ids = []; }
      const wantedNames = new Set(names), wantedIds = new Set(ids.map(String));
      const since = Math.max(Number(params.get("since")) || 0, now - WINDOW);
      const heading = params.get("heading") === "1";
      const rows = (await loadEvents(store, since, now))
        .filter((a) => (wantedNames.has(a[3]) || wantedIds.has(String(a[8] ?? ""))) && (heading || a[4] !== "T"))
        .map(toObj);
      return reply({ events: rows });
    }

    return reply({ error: "unknown op" }, 400);
  } catch (err) {
    console.log("history error:", err.message);
    return reply({ error: "history lookup failed" }, 500);
  }
};

export const config = { path: "/api/history" };
