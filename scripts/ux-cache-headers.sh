#!/usr/bin/env bash
# Martin 2.0 under three Cache-Control policies on 4G, the policies alternating round by round:
# today's (no header), "public, max-age=86400", and "max-age=0, stale-while-revalidate=86400".
# Results land in .work/ux/cc-ux, cc-ux-maxage and cc-ux-swr; src/ux/analyze.ts reads them.
set -euo pipefail
cd "$(dirname "$0")/.."
for family in archive postgis; do
  candidate=$([ "$family" = archive ] && echo martin-2-pmtiles || echo martin-2)
  for round in 1 2 3; do
    for variant in ux ux-maxage ux-swr; do
      bun run src/ux/run.ts --family="$family" --tag="cc-$variant" --round="$round" --candidates="$candidate" --profiles=4g --martin-variant="$variant"
    done
  done
done
