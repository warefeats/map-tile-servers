#!/usr/bin/env bash
# Cheaper shapes for Martin's table tile query, measured with pgbench as prepared statements (the
# plan cache in its default mode, as Martin runs it) over the 256-tile walk at 1 and 8 connections:
#   current   Martin 2.0.0's query as captured
#   notrans   without the no-op ST_Transform(geom, 3857) on a table already in 3857
#   once      the tile envelopes computed once per query (scalar subqueries become InitPlans)
#   both      notrans + once
#   bbox      the envelope as four float parameters computed by the client (BBOX's shape)
# Diagnostic only. Run with every engine stopped.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=m2-db
SECONDS_PER_RUN=${SECONDS_PER_RUN:-12}
OUT=.work/pg-shapes
mkdir -p "$OUT"
props_of() {
  case $1 in
    buildings) echo '"fid", "building", "name", "osm_id"' ;;
    roads) echo '"fid", "highway", "name", "osm_id"' ;;
    pois) echo '"fid", "amenity", "name", "osm_id", "shop", "tourism"' ;;
  esac
}
head='\set z 14
\set x random(8794, 8809)
\set y random(5366, 5381)'
env='ST_TileEnvelope(:z::integer, :x::integer, :y::integer)'
benv='ST_TileEnvelope(:z::integer, :x::integer, :y::integer, margin => 0.015625)'
for layer in buildings roads pois; do
  props=$(props_of $layer)
  mvt() { printf '%s\nSELECT ST_AsMVT(tile, '"'"'%s'"'"', 4096, '"'"'geom'"'"', '"'"'fid'"'"') FROM (SELECT ST_AsMVTGeom(%s, %s, 4096, 64, true) AS geom, %s FROM "bench"."%s" WHERE "geom" && %s) AS tile;\n' "$head" "$layer" "$1" "$2" "$props" "$layer" "$3"; }
  mvt 'ST_Transform("geom"::geometry, 3857)' "$env" "ST_Transform($benv, 3857)" > "$OUT/$layer-current.sql"
  mvt '"geom"::geometry' "$env" "$benv" > "$OUT/$layer-notrans.sql"
  mvt 'ST_Transform("geom"::geometry, 3857)' "(SELECT $env)" "(SELECT ST_Transform($benv, 3857))" > "$OUT/$layer-once.sql"
  mvt '"geom"::geometry' "(SELECT $env)" "(SELECT $benv)" > "$OUT/$layer-both.sql"
  # BBOX's shape: bounds computed by the client; pgbench computes them from z/x/y the same way.
  cat > "$OUT/$layer-bbox.sql" <<SQL
\\set z 14
\\set x random(8794, 8809)
\\set y random(5366, 5381)
\\set size 2445.98490512564
\\set minx -20037508.342789244 + :x * :size
\\set maxy 20037508.342789244 - :y * :size
\\set maxx :minx + :size
\\set miny :maxy - :size
\\set b 38.21851414258813
\\set bminx :minx - :b
\\set bminy :miny - :b
\\set bmaxx :maxx + :b
\\set bmaxy :maxy + :b
SELECT ST_AsMVT(tile, '$layer', 4096, 'geom', 'fid') FROM (SELECT ST_AsMVTGeom("geom", ST_MakeEnvelope(:minx::float8, :miny::float8, :maxx::float8, :maxy::float8, 3857), 4096, 64, true) AS geom, $props FROM "bench"."$layer" WHERE "geom" && ST_MakeEnvelope(:bminx::float8, :bminy::float8, :bmaxx::float8, :bmaxy::float8, 3857)) AS tile;
SQL
done
docker cp "$OUT/." "$DB:/tmp/shapes/" >/dev/null
: > "$OUT/results.txt"
for layer in buildings roads pois; do
  for clients in 1 8; do
    for shape in current notrans once both bbox; do
      line=$(docker exec -e PGPASSWORD=tiles "$DB" pgbench -n -M prepared -h 127.0.0.1 -U tiles -d bench -c "$clients" -j "$clients" -T "$SECONDS_PER_RUN" -f "/tmp/shapes/$layer-$shape.sql" 2>&1 | grep -E "^(tps|latency average|pgbench: error)" | tr '\n' ' ')
      printf '%-10s c=%-2s %-8s %s\n' "$layer" "$clients" "$shape" "$line" | tee -a "$OUT/results.txt"
    done
  done
done
