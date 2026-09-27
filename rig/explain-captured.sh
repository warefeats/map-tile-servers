#!/usr/bin/env bash
# EXPLAIN (ANALYZE) the exact statements Martin 2.0.0 and 1.16.1 prepared for the roads, pois and
# buildings tiles, as captured by rig/sql-capture.ts, executed as a prepared statement eight times so
# the plan cache's switch to a generic plan (after five executions) shows up. Diagnostic only.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=.work/sql-capture
DB=m2-db
for id in martin-2 martin-1; do
  log="$OUT/$id.log"
  [ -f "$log" ] || { echo "no capture for $id; run rig/sql-capture.ts first"; exit 1; }
done
# Pull each distinct prepared statement text out of the log: PostgreSQL logs "execute <name>: <sql>".
extract() { # id layer
  grep -E "execute [^:]+: " "$OUT/$1.log" | sed -E 's/.*execute [^:]+: //' | grep -F "\"$2\"" | head -1
}
for layer in roads pois buildings; do
  for id in martin-2 martin-1; do
    sql=$(extract "$id" "$layer")
    [ -n "$sql" ] || { echo "no $layer statement captured for $id"; continue; }
    echo "=================== $id / $layer"
    echo "$sql" | cut -c1-400
    docker exec -i -e PGPASSWORD=tiles "$DB" psql -h 127.0.0.1 -U tiles -d bench -At -q <<SQL 2>&1 | grep -E "Gather|Workers|Parallel|JIT|Execution Time|Planning Time|Index Scan|Bitmap|Seq Scan|Aggregate" | sed 's/^/  /'
PREPARE q(int2, int8, int8) AS $sql;
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
EXPLAIN (ANALYZE, COSTS ON) EXECUTE q(14, 8802, 5371);
SQL
  done
done
