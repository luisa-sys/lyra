#!/usr/bin/env bash
#
# scripts/classify-sitemap-freshness.sh
#
# BUGS-103 — decide whether /sitemap.xml was rendered PER REQUEST or served
# from cache, from the response headers alone.
#
# Reads a raw HTTP response header block on stdin. Prints one line:
#
#   PASS|FAIL|UNVERIFIED <human-readable reason>
#
# and exits 0 always — the VERDICT is the output, not the exit code, so the
# caller decides what a verdict means. (staging-soak.sh maps FAIL -> exit 2 and
# UNVERIFIED -> exit 1 for the run as a whole.)
#
# ── WHY THIS EXISTS: the previous instrument could not fail correctly ─────────
#
# The soak used to classify on `Cache-Control`, asserting `no-store|no-cache`
# for a dynamic render. That assertion is unsatisfiable on this route, and the
# probe therefore FAILED every day of its life without ever having passed once.
#
# `src/app/sitemap.ts` is a Next *metadata route*. Next's metadata-route loader
# generates the handler and hardcodes the header to a literal constant:
#
#     const CACHE_HEADERS = {
#       NO_CACHE:   'no-cache, no-store',
#       REVALIDATE: 'public, max-age=0, must-revalidate',
#     }
#     // getSingleSitemapRouteCode():
#     'Cache-Control': ${JSON.stringify(CACHE_HEADERS.REVALIDATE)},
#
# `getSingleSitemapRouteCode` is the branch a single sitemap with no
# `generateSitemaps` export takes, and it references neither `dynamic` nor
# `revalidate` nor any other route-segment config. Verified against the
# COMPILED artefact of this repo, not just the loader source — a local
# `npm run build` emits, in `.next/server/app/sitemap.xml/route.js`:
#
#     new NextResponse(b,{headers:{"Content-Type":"application/xml",
#       "Cache-Control":"public, max-age=0, must-revalidate"}})
#
# ...in the same build whose route table lists `ƒ /sitemap.xml` (Dynamic,
# server-rendered on demand). So the header is a CONSTANT: byte-identical in
# the fixed state and in the SEC-100 defect state. It carries zero information
# about prerender-vs-dynamic, which means the old probe could not have detected
# SEC-100 either. It was not a strict check; it was a check pointed at the
# wrong thing.
#
# ⚠️ The tempting "fix" — adding `max-age=0` to the accepted set — would have
# traded a permanent false FAIL for a permanent false PASS, and reported green
# in exactly the state the clause exists to catch. Do not reintroduce any
# Cache-Control assertion here.
#
# ── WHAT IT READS INSTEAD ────────────────────────────────────────────────────
#
# `x-vercel-cache` is Vercel's own edge telemetry and DOES vary with the thing
# we care about: a function invoked for this request reports MISS or BYPASS; a
# response served from the edge cache (which is what a prerendered sitemap
# becomes) reports HIT, STALE, PRERENDER or REVALIDATED. `age` is the
# secondary signal — a cached response accumulates it.
#
# ── BIAS: UNVERIFIED, DELIBERATELY ───────────────────────────────────────────
#
# Neither header is guaranteed to survive an intermediary. staging sits behind
# Cloudflare, and a proxy that strips `x-vercel-cache` leaves us genuinely
# unable to tell — which is UNVERIFIED, never PASS and never FAIL. The soak's
# C1 block already states this bias in prose; the old final `else` contradicted
# it by treating "a header I do not recognise" as proof of a regression.
#
# An unknown `x-vercel-cache` token is UNVERIFIED for the same reason: Vercel
# may add one, and a probe that fails on an unrecognised value is a probe that
# goes red on someone else's release note.
#
# Portability: bash 3.2 clean (gotcha #28) — no mapfile, no ${v,,}, no
# associative arrays. `grep -E` not BRE alternation (gotcha #30).

set -euo pipefail

# Header names are case-insensitive and Vercel/Cloudflare do not agree on
# casing, so lowercase the whole block once and match lowercase throughout.
headers=$(cat | tr 'A-Z' 'a-z')

hdr() { # <lowercase-header-name> -> value, or empty
  printf '%s' "$headers" \
    | sed -n "s/^$1:[[:space:]]*//p" \
    | head -1 \
    | tr -d '\r'
}

vercel_cache=$(hdr 'x-vercel-cache')
age=$(hdr 'age')

if [ -n "$vercel_cache" ]; then
  case "$vercel_cache" in
    miss|bypass)
      echo "PASS the function ran for this request (x-vercel-cache: $vercel_cache)"
      exit 0
      ;;
    hit|stale|prerender|revalidated)
      echo "FAIL served from the edge cache (x-vercel-cache: $vercel_cache) — SEC-130 regression: a suspended member's slug can persist in the sitemap until the next deploy"
      exit 0
      ;;
    *)
      echo "UNVERIFIED unrecognised x-vercel-cache token '$vercel_cache' — cannot classify, and guessing would make this probe fail on a Vercel release note"
      exit 0
      ;;
  esac
fi

# No x-vercel-cache. `age` is a weaker signal but a non-zero one is still
# positive evidence of a cache hit. `age: 0` is NOT evidence of a fresh render
# — a just-populated cache entry also reports 0 — so it does not yield PASS.
if [ -n "$age" ] && printf '%s' "$age" | grep -qE '^[0-9]+$' && [ "$age" -gt 0 ]; then
  echo "FAIL served from a cache (age: ${age}s, no x-vercel-cache) — SEC-130 regression: a suspended member's slug can persist in the sitemap until the next deploy"
  exit 0
fi

echo "UNVERIFIED no x-vercel-cache header and no non-zero age — an intermediary (Cloudflare) may have stripped Vercel's cache telemetry, so freshness cannot be observed from here. NOT a pass: Cache-Control is a Next constant on this route and cannot substitute (BUGS-103)."
exit 0
