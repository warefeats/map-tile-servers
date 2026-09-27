#!/usr/bin/env bash
# Database-side levers for Martin's PostGIS tiles, measured with pgbench inside the database
# container: the same prepared statement Martin sends (captured from the log by rig/sql-capture.ts),
# over the same 256-tile walk, at one and eight connections (Martin's pool), with one session setting
# changed at a time. Diagnostic only: nothing here feeds the verdict. Run with every engine stopped.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=m2-db
SECONDS_PER_RUN=${SECONDS_PER_RUN:-15}
OUT=.work/pg-levers
mkdir -p "$OUT"

# Martin 2.0.0's table query per layer, as captured (parameters are z, x, y), the same rows as
# WKB in tile coordinates (Martin's row query: what is left for the database if MVT encoding moves
# into Martin), and only the index scan with raw geometries (the floor under both).
props_of() {
  case $1 in
    buildings) echo '"fid", "osm_id", "name", "building"' ;;
    roads) echo '"fid", "osm_id", "name", "highway"' ;;
    pois) echo '"fid", "osm_id", "name", "amenity", "shop", "tourism"' ;;
  esac
}
for layer in buildings roads pois; do
  props=$(props_of $layer)
  where="\"geom\" && ST_Transform(ST_TileEnvelope(:z::integer, :x::integer, :y::integer, margin => 0.015625), 3857)"
  mvtgeom="ST_AsMVTGeom(ST_Transform(\"geom\"::geometry, 3857), ST_TileEnvelope(:z::integer, :x::integer, :y::integer), 4096, 64, true)"
  head='\set z 14
\set x random(8794, 8809)
\set y random(5366, 5381)'
  printf '%s\nSELECT ST_AsMVT(tile, '"'"'%s'"'"', 4096, '"'"'geom'"'"', '"'"'fid'"'"') FROM (SELECT %s AS geom, %s FROM "bench"."%s" WHERE %s) AS tile;\n' "$head" "$layer" "$mvtgeom" "$props" "$layer" "$where" > "$OUT/$layer-mvt.sql"
  printf '%s\nSELECT * FROM (SELECT ST_AsBinary(%s) AS g, %s FROM "bench"."%s" WHERE %s) AS tile WHERE g IS NOT NULL;\n' "$head" "$mvtgeom" "$props" "$layer" "$where" > "$OUT/$layer-rows.sql"
  printf '%s\nSELECT "geom", %s FROM "bench"."%s" WHERE %s;\n' "$head" "$props" "$layer" "$where" > "$OUT/$layer-scan.sql"
done
docker cp "$OUT/." "$DB:/tmp/levers/" >/dev/null

run() { # name script clients options
  local name=$1 script=$2 clients=$3 opts=$4
  local line
  line=$(docker exec -e PGOPTIONS="$opts" -e PGPASSWORD=tiles "$DB" pgbench -n -M prepared -h 127.0.0.1 -U tiles -d bench -c "$clients" -j "$clients" -T "$SECONDS_PER_RUN" -f "/tmp/levers/$script" 2>/dev/null | grep -E "^(tps|latency average)" | tr '\n' ' ')
  printf '%-34s c=%-2s %s\n' "$name" "$clients" "$line" | tee -a "$OUT/results.txt"
}

: > "$OUT/results.txt"
docker exec "$DB" psql -U postgres -d bench -At -c "SHOW jit; SHOW max_parallel_workers_per_gather; SHOW plan_cache_mode; SELECT version();" | tee -a "$OUT/results.txt"
for layer in buildings roads pois; do
  for clients in 1 8; do
    run "$layer default" $layer-mvt.sql $clients ""
    run "$layer no parallel workers" $layer-mvt.sql $clients "-c max_parallel_workers_per_gather=0"
    run "$layer jit off" $layer-mvt.sql $clients "-c jit=off"
    run "$layer custom plans only" $layer-mvt.sql $clients "-c plan_cache_mode=force_custom_plan"
    run "$layer generic plans only" $layer-mvt.sql $clients "-c plan_cache_mode=force_generic_plan"
    run "$layer rows (encode moved out)" $layer-rows.sql $clients ""
    run "$layer scan only" $layer-scan.sql $clients ""
  done
done
echo "results in $OUT/results.txt"
