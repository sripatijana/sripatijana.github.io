#!/usr/bin/env python3
"""Fetch journal RSS feeds, merge with existing data, write data/articles.json.

Run:  python scripts/fetch_feeds.py
Env:  KEEP_DAYS (default 21), MAX_ITEMS (default 4000)
"""
import html
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser

ROOT = Path(__file__).resolve().parent.parent
JOURNALS = ROOT / "journals.json"
OUT = ROOT / "data" / "articles.json"
STATUS = ROOT / "data" / "status.json"
KEEP_DAYS = int(os.environ.get("KEEP_DAYS", 21))
MAX_ITEMS = int(os.environ.get("MAX_ITEMS", 4000))
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36 ChemRadar/1.0 (+RSS reader)")

DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"'<>?#]+", re.I)
IMG_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
TAG_RE = re.compile(r"<[^>]+>")


def clean(text, limit=None):
    text = html.unescape(TAG_RE.sub(" ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    if limit and len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    return text


def find_doi(entry):
    for key in ("prism_doi", "dc_identifier", "id", "link"):
        val = entry.get(key) or ""
        m = DOI_RE.search(val)
        if m:
            return m.group(0).rstrip(".").lower()
    return None


def find_image(entry):
    for m in entry.get("media_content", []) + entry.get("media_thumbnail", []):
        if m.get("url"):
            return m["url"]
    for enc in entry.get("enclosures", []):
        if enc.get("type", "").startswith("image") and enc.get("href"):
            return enc["href"]
    blobs = [entry.get("summary", "")] + [c.get("value", "") for c in entry.get("content", [])]
    for b in blobs:
        m = IMG_RE.search(b)
        if m:
            return html.unescape(m.group(1))
    return None


def find_authors(entry):
    if entry.get("authors"):
        names = [a.get("name", "") for a in entry["authors"] if a.get("name")]
        if names:
            return clean(", ".join(names), 300)
    return clean(entry.get("author") or entry.get("dc_creator") or "", 300)


def find_date(entry, fallback):
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        t = entry.get(key)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc).isoformat()
    return fallback


def fetch(journal):
    now = datetime.now(timezone.utc).isoformat()
    try:
        feed = feedparser.parse(journal["url"], agent=UA, request_headers={"Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8"})
    except Exception as exc:  # network / parse crash
        return journal["id"], [], f"error: {exc}"
    status = getattr(feed, "status", None)
    if not feed.entries:
        return journal["id"], [], f"no entries (http {status}, {feed.get('bozo_exception', '')})"
    items = []
    for e in feed.entries:
        title = clean(e.get("title", ""))
        link = e.get("link", "")
        if not title or not link:
            continue
        summary_src = e.get("summary", "") or (e.get("content") or [{}])[0].get("value", "")
        items.append({
            "id": find_doi(e) or link,
            "doi": find_doi(e),
            "title": title,
            "link": link,
            "authors": find_authors(e),
            "summary": clean(summary_src, 600),
            "image": find_image(e),
            "journal": journal["id"],
            "date": find_date(e, now),
            "first_seen": now,
        })
    return journal["id"], items, f"ok ({len(items)})"


def main():
    journals = json.loads(JOURNALS.read_text())
    old = []
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text()).get("articles", [])
        except Exception:
            old = []
    by_id = {a["id"]: a for a in old}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch, journals))

    status, new_count = {}, 0
    for jid, items, msg in results:
        status[jid] = msg
        for it in items:
            if it["id"] in by_id:
                prev = by_id[it["id"]]
                it["first_seen"] = prev.get("first_seen", it["first_seen"])
                it["image"] = it["image"] or prev.get("image")
            else:
                new_count += 1
            by_id[it["id"]] = it

    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    arts = [a for a in by_id.values() if a["first_seen"] >= cutoff]
    arts.sort(key=lambda a: (a["first_seen"][:13], a["date"]), reverse=True)
    arts = arts[:MAX_ITEMS]

    OUT.parent.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()
    OUT.write_text(json.dumps({"updated": stamp, "articles": arts}, ensure_ascii=False, separators=(",", ":")))
    STATUS.write_text(json.dumps({"updated": stamp, "new": new_count, "feeds": status}, indent=1))

    for jid, msg in status.items():
        print(f"{jid:12s} {msg}")
    print(f"\n{new_count} new, {len(arts)} kept")
    ok = sum(1 for m in status.values() if m.startswith("ok"))
    if ok == 0:
        sys.exit("All feeds failed")


if __name__ == "__main__":
    main()
