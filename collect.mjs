// Runs on a schedule (every minute). Records where every MBTA bus is, but only when something changed,
// into Netlify Blobs, and keeps 5 hours of it. This is what makes the history shared and always-on.
import { getStore } from "@netlify/blobs";

const WINDOW = 5 * 60 * 60 * 1000;      // how long to keep history
const BUCKET = 15 * 60 * 1000;          // records are grouped into 15-minute blobs
const HEARTBEAT = 5 * 60 * 1000;        // re-record an unchanged bus this often
const CODE = { STOPPED_AT: "S", INCOMING_AT: "I", IN_TRANSIT_TO: "T" };
const round = (n) => (n == null ? null : Math.round(Number(n) * 1e5) / 1e5);

export default async () => {
  const store = getStore({ name: "bus-history", consistency: "strong" });
  // Strongly recommended: a free MBTA API key (api-v3.mbta.com) set as the MBTA_API_KEY environment variable.
  // Without one, requests from Netlify's shared servers can hit MBTA's anonymous rate limit.
  const headers = process.env.MBTA_API_KEY ? { "x-api-key": process.env.MBTA_API_KEY } : {};

  let json = null;
  for (let attempt = 0; attempt < 3 && !json; attempt++) {
    try {
      const res = await fetch("https://api-v3.mbta.com/vehicles?filter[route_type]=3&include=stop", { headers });
      if (!res.ok) throw new Error("MBTA responded " + res.status);
      json = await res.json();
    } catch (err) {
      console.log("MBTA fetch failed:", err.message);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!json) return;

  const stops = {};
  for (const i of json.included || []) if (i.type === "stop") stops[i.id] = i.attributes.name;

  const now = Date.now();
  const previous = (await store.get("state", { type: "json" })) || {};
  const next = {};
  const events = [];

  for (const v of json.data || []) {
    const a = v.attributes;
    if (!a.label) continue;
    const label = String(a.label);
    const route = v.relationships?.route?.data?.id || "";
    const stop = stops[v.relationships?.stop?.data?.id] || "";
    const status = CODE[a.current_status] || "T";
    const key = [route, stop, status, a.direction_id].join("|");
    const prev = previous[label];
    if (prev && prev[0] === key && now - prev[1] < HEARTBEAT) { next[label] = prev; continue; }  // unchanged
    next[label] = [key, now];
    // compact record: [time, bus, route, stop, status, direction, lat, lon, stop number]
    events.push([Date.parse(a.updated_at) || now, label, route, stop, status, a.direction_id ?? null, round(a.latitude), round(a.longitude), String(v.relationships?.stop?.data?.id ?? "")]);
  }

  if (events.length) {
    const bucketKey = "events/" + Math.floor(now / BUCKET) * BUCKET;
    const existing = (await store.get(bucketKey, { type: "json" })) || [];
    await store.setJSON(bucketKey, existing.concat(events));
  }
  await store.setJSON("state", next);

  const meta = (await store.get("meta", { type: "json" })) || { since: now };
  meta.updated = now;
  await store.setJSON("meta", meta);

  // Drop anything older than the retention window
  const { blobs } = await store.list({ prefix: "events/" });
  for (const b of blobs) {
    if (Number(b.key.slice(7)) < now - WINDOW - BUCKET) await store.delete(b.key);
  }
  console.log(`Recorded ${events.length} changes across ${Object.keys(next).length} buses`);
};

export const config = { schedule: "* * * * *" };
