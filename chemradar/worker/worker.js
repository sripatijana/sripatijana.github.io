// Chem Radar feed collector — Cloudflare Worker (free plan friendly)
// Cron (every 4 min) refreshes 2 journals per run, rotating, so each run stays
// within the free plan's 10 ms CPU budget; every journal is refreshed hourly.
// KV writes: 2 x 360 runs = 720/day (free limit 1,000).
// GET /articles.json  -> merged feed for the website (CORS enabled)
// GET /status         -> per-journal fetch status
// Requires a KV namespace bound as FEEDS.

const JOURNALS = [
  ["jacs", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jacsat"],
  ["orglett", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=orlef7"],
  ["acscatal", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=accacs"],
  ["joc", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=joceah"],
  ["acscentsci", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=acscii"],
  ["jacsau", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jaaucr"],
  ["chemrev", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=chreay"],
  ["accounts", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=achre4"],
  ["oprd", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=oprdfk"],
  ["organomet", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=orgnd7"],
  ["jmedchem", "https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jmcmar"],
  ["angew", "https://onlinelibrary.wiley.com/action/showFeed?jc=15213773&type=etoc&feed=rss"],
  ["chemeurj", "https://onlinelibrary.wiley.com/action/showFeed?jc=15213765&type=etoc&feed=rss"],
  ["adsc", "https://onlinelibrary.wiley.com/action/showFeed?jc=16154169&type=etoc&feed=rss"],
  ["cctc", "https://onlinelibrary.wiley.com/action/showFeed?jc=18673899&type=etoc&feed=rss"],
  ["ejoc", "https://onlinelibrary.wiley.com/action/showFeed?jc=10990690&type=etoc&feed=rss"],
  ["nature", "https://www.nature.com/nature.rss"],
  ["nchem", "https://www.nature.com/nchem.rss"],
  ["ncomms", "https://www.nature.com/ncomms.rss"],
  ["natcatal", "https://www.nature.com/natcatal.rss"],
  ["natsynth", "https://www.nature.com/natsynth.rss"],
  ["science", "https://www.science.org/action/showFeed?type=axatoc&feed=rss&jc=science"],
  ["chem", "https://www.cell.com/chem/inpress.rss"],
  ["chemsci", "https://feeds.rsc.org/rss/sc"],
  ["chemcomm", "https://feeds.rsc.org/rss/cc"],
  ["obc", "https://feeds.rsc.org/rss/ob"],
  ["qo", "https://feeds.rsc.org/rss/qo"],
  ["greenchem", "https://feeds.rsc.org/rss/gc"],
  ["csr", "https://feeds.rsc.org/rss/cs"],
  ["cst", "https://feeds.rsc.org/rss/cy"],
];

const RUNS_PER_HOUR = 15;           // cron */4
const KEEP_DAYS = 21;
const MAX_PER_JOURNAL = 300;
const SUMMARY_LEN = 350;
const UA = "Mozilla/5.0 (compatible; ChemRadar/1.0; +https://sripatijana.github.io/chemradar/)";

// ---------- tiny RSS / RDF / Atom parser (regex based, cheap on CPU) ----------
const ENT = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", minus: "−",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", deg: "°", times: "×", middot: "·",
  plusmn: "±", rarr: "→", larr: "←", harr: "↔", rlarr: "⇄", prime: "′", Prime: "″", micro: "µ",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", eta: "η", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Delta: "Δ", Sigma: "Σ", Omega: "Ω", Lambda: "Λ", Phi: "Φ", Psi: "Ψ", Gamma: "Γ", Pi: "Π",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é",
  egrave: "è", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú", ccedil: "ç", ntilde: "ñ",
};
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
  });
}
function unwrap(s) {
  const c = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return c ? c[1] : decode(s);
}
const RX = new Map();
function rx(name, flags) {
  const k = name + flags;
  let r = RX.get(k);
  if (!r) RX.set(k, r = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, flags));
  r.lastIndex = 0;
  return r;
}
function tag(block, name) {
  if (block.indexOf("<" + name) < 0) return "";
  const m = block.match(rx(name, "i"));
  return m ? unwrap(m[1]) : "";
}
function tags(block, name) {
  if (block.indexOf("<" + name) < 0) return [];
  const re = rx(name, "gi");
  const out = []; let m;
  while ((m = re.exec(block))) out.push(unwrap(m[1]));
  return out;
}
function text(html, limit) {
  if (limit && html.length > limit * 8) html = html.slice(0, limit * 8);
  let t = decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  if (limit && t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>?#]+/i;

function parseFeed(xml, journal, now) {
  const items = [];
  const re = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    const title = text(tag(b, "title"));
    let link = tag(b, "link");
    if (!link) { const l = b.match(/<link[^>]*href="([^"]+)"/i); link = l ? decode(l[1]) : ""; }
    link = link.trim();
    if (!title || !link) continue;
    const doiSrc = tag(b, "prism:doi") || tag(b, "dc:identifier") || link;
    const dm = doiSrc.match(DOI_RE) || link.match(DOI_RE);
    const doi = dm ? dm[0].replace(/\.$/, "").toLowerCase() : null;
    const desc = tag(b, "description") || tag(b, "content:encoded") || tag(b, "summary") || tag(b, "content");
    let image = null;
    const mi = b.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) || desc.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (mi) image = decode(mi[1]);
    let authors = tags(b, "dc:creator");
    if (!authors.length) authors = tags(b, "name");
    if (!authors.length) { const a = tag(b, "author"); if (a) authors = [a]; }
    const ds = tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated") || tag(b, "prism:publicationDate");
    const d = ds ? new Date(ds.trim()) : null;
    items.push({
      id: doi || link, doi, title, link,
      authors: text(authors.join(", "), 300),
      summary: text(desc, SUMMARY_LEN),
      image, journal,
      date: d && !isNaN(d) ? d.toISOString() : now,
      first_seen: now,
    });
  }
  return items;
}

// ---------- storage: one KV key per journal, value = "<fetchedISO>\n<status>\n<json array>" ----------
function split(v) {
  const i = v.indexOf("\n"), j = v.indexOf("\n", i + 1);
  return { t: v.slice(0, i), status: v.slice(i + 1, j), json: v.slice(j + 1) };
}

async function refresh(env, id, url) {
  const now = new Date().toISOString();
  const prevRaw = await env.FEEDS.get("j:" + id);
  const prev = prevRaw ? split(prevRaw) : null;
  let status, merged;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" }, cf: { cacheTtl: 300 } });
    if (!res.ok) throw new Error("http " + res.status);
    const items = parseFeed(await res.text(), id, now);
    if (!items.length) throw new Error("no entries");
    const old = prev ? JSON.parse(prev.json) : [];
    const seen = new Map(old.map(a => [a.id, a]));
    for (const it of items) {
      const p = seen.get(it.id);
      if (p) { it.first_seen = p.first_seen; it.image = it.image || p.image; }
      seen.set(it.id, it);
    }
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
    merged = [...seen.values()].filter(a => a.first_seen >= cutoff)
      .sort((a, b) => b.first_seen.localeCompare(a.first_seen) || b.date.localeCompare(a.date))
      .slice(0, MAX_PER_JOURNAL);
    status = `ok (${items.length})`;
  } catch (e) {
    status = "error: " + e.message;
    merged = null;
  }
  const json = merged ? JSON.stringify(merged) : (prev ? prev.json : "[]");
  await env.FEEDS.put("j:" + id, `${merged ? now : (prev ? prev.t : "")}\n${status}\n${json}`);
  return status;
}

async function batch(env, when) {
  const slot = Math.floor(when / (36e5 / RUNS_PER_HOUR)) % RUNS_PER_HOUR;  // 4-min slot within the hour
  const per = Math.ceil(JOURNALS.length / RUNS_PER_HOUR);
  const todo = JOURNALS.slice(slot * per, slot * per + per);
  return Promise.all(todo.map(([id, url]) => refresh(env, id, url).then(s => [id, s])));
}

// ---------- HTTP ----------
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

async function combined(env) {
  const vals = await Promise.all(JOURNALS.map(([id]) => env.FEEDS.get("j:" + id)));
  let updated = "", parts = [];
  for (const v of vals) {
    if (!v) continue;
    const { t, json } = split(v);
    if (t > updated) updated = t;
    if (json.length > 2) parts.push(json.slice(1, -1));   // strip [ ] — no JSON.parse needed
  }
  return `{"updated":${updated ? `"${updated}"` : "null"},"articles":[${parts.join(",")}]}`;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(batch(env, event.scheduledTime));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/articles.json") {
      const cache = caches.default;
      const key = new Request(url.origin + "/articles.json");
      let res = await cache.match(key);
      if (!res) {
        res = new Response(await combined(env), {
          headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
        });
        ctx.waitUntil(cache.put(key, res.clone()));
      }
      return res;
    }

    if (url.pathname === "/status") {
      const vals = await Promise.all(JOURNALS.map(([id]) => env.FEEDS.get("j:" + id)));
      const out = {};
      JOURNALS.forEach(([id], i) => {
        if (!vals[i]) { out[id] = "not fetched yet"; return; }
        const { t, status } = split(vals[i]);
        out[id] = `${status} · last ok ${t || "never"}`;
      });
      return new Response(JSON.stringify(out, null, 1), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    return new Response("Chem Radar feed collector. Endpoints: /articles.json, /status", { headers: CORS });
  },
};
