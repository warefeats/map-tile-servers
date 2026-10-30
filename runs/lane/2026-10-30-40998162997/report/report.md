# Archive lane

Dollars per million tiles at AWS list prices of 2026-10-29 (us-east-1); lower is better. A rank is shared unless the 95% confidence intervals over the passes do not overlap. The price takes each server's capacity capped at the instance's sustained network rate (1.875 Gbps); the measured capacity and the server container's CPU per tile at it stand beside each ranking, unranked.

## berlin, files, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.422 | 7.411–7.434 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 18,000 | 2,850 | – | 82.2 | 5.4 |

## berlin, files, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.426 | 7.419–7.434 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 18,000 | 2,847 | – | 82.3 | 5.6 |

## berlin, files, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.991 | 7.981–8.002 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 88,000 | 14,365 | – | 16.3 | 24.8 |

## berlin, files, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.997 | 7.990–8.004 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 88,000 | 14,370 | – | 16.3 | 25.4 |

## berlin, mbtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.727 | 6.703–6.750 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 7.418 | 7.394–7.442 | 3 |
| 2 | martin-1 1.16.1 | 7.420 | 7.410–7.429 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.422 | 7.177–7.667 | 2 |
| 2 | mbtileserver 0.11.0 | 7.428 | 7.392–7.463 | 3 |
| 2 | bbox 0.6.2 | 7.448 | 7.412–7.484 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,144 | – | 74.5 | 7.2 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 18,000 | 2,851 | – | 82.2 | 5.7 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,851 | – | 82.2 | 5.6 |
| tileserver-gl 5.7.0 (network-bound) | 5,000 | 2,850 | – | 82.2 | 17.6 |
| mbtileserver 0.11.0 (network-bound) | 11,333 | 2,848 | – | 82.3 | 10.4 |
| bbox 0.6.2 (network-bound) | 4,833 | 2,840 | – | 82.5 | 22.1 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.5%.

## berlin, mbtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.729 | 6.700–6.759 | 3 |
| 2 | martin-1 1.16.1 | 7.420 | 7.403–7.438 | 3 |
| 2 | mbtileserver 0.11.0 | 7.420 | 7.416–7.424 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.424 | 7.386–7.462 | 3 |
| 2 | bbox 0.6.2 | 7.424 | 7.393–7.455 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 7.435 | 7.398–7.471 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,142 | – | 74.6 | 6.7 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,850 | – | 82.3 | 5.3 |
| mbtileserver 0.11.0 (network-bound) | 14,000 | 2,850 | – | 82.3 | 10.9 |
| tileserver-gl 5.7.0 (network-bound) | 4,167 | 2,848 | – | 82.3 | 11.4 |
| bbox 0.6.2 (network-bound) | 4,833 | 2,848 | – | 82.3 | 41.4 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 18,000 | 2,844 | – | 82.4 | 6.8 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.5%.

## berlin, mbtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.336 | 7.314–7.358 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 7.987 | 7.965–8.010 | 3 |
| 2 | martin-1 1.16.1 | 7.988 | 7.979–7.998 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.991 | 7.760–8.221 | 2 |
| 2 | mbtileserver 0.11.0 | 7.996 | 7.963–8.030 | 3 |
| 2 | bbox 0.6.2 | 8.015 | 7.981–8.049 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,387 | – | 15.2 | 33.9 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 88,000 | 14,371 | – | 16.3 | 24.9 |
| martin-1 1.16.1 (network-bound) | 32,000 | 14,350 | – | 16.3 | 15.3 |
| tileserver-gl 5.7.0 | 10,000 | 10,000 | – | 16.3 | 20.0 |
| mbtileserver 0.11.0 (network-bound) | 32,000 | 14,377 | – | 16.3 | 10.3 |
| bbox 0.6.2 | 13,333 | 13,333 | – | 16.4 | 6.1 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.5–18.5%.

## berlin, mbtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.341 | 7.313–7.368 | 3 |
| 2 | martin-1 1.16.1 | 7.992 | 7.975–8.008 | 3 |
| 2 | mbtileserver 0.11.0 | 7.992 | 7.988–7.995 | 3 |
| 2 | bbox 0.6.2 | 7.995 | 7.966–8.024 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.995 | 7.959–8.031 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 8.005 | 7.971–8.039 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,360 | – | 15.3 | 30.7 |
| martin-1 1.16.1 (network-bound) | 36,000 | 14,371 | – | 16.3 | 17.1 |
| mbtileserver 0.11.0 (network-bound) | 34,667 | 14,368 | – | 16.3 | 9.6 |
| bbox 0.6.2 | 12,667 | 12,667 | – | 16.4 | 16.6 |
| tileserver-gl 5.7.0 | 7,667 | 7,667 | – | 16.3 | 12.3 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 88,000 | 14,370 | – | 16.3 | 25.6 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.5–18.6%.

## berlin, pmtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.728 | 6.711–6.744 | 3 |
| 2 | go-pmtiles 1.31.2 | 7.427 | 7.413–7.441 | 3 |
| 2 | martin-1 1.16.1 | 7.435 | 7.407–7.462 | 3 |
| 2 | bbox 0.6.2 | 7.437 | 7.408–7.467 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 7.444 | 7.395–7.493 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.632 | 7.441–7.823 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,144 | – | 74.5 | 7.4 |
| go-pmtiles 1.31.2 (network-bound) | 8,333 | 2,848 | – | 82.3 | 26.2 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,845 | – | 82.4 | 5.1 |
| bbox 0.6.2 (network-bound) | 6,500 | 2,844 | – | 82.4 | 8.3 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 18,000 | 2,842 | – | 82.5 | 6.0 |
| tileserver-gl 5.7.0 | 292 | 292 | – | 82.6 | 45.3 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.3–1.5%.

## berlin, pmtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.729 | 6.673–6.786 | 3 |
| 1 | tileserver-gl 5.7.0 | 7.507 | 6.179–8.836 | 2 |
| 2 | martin-1 1.16.1 | 7.421 | 7.374–7.469 | 3 |
| 2 | bbox 0.6.2 | 7.427 | 7.399–7.455 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 7.432 | 7.408–7.456 | 3 |
| 2 | go-pmtiles 1.31.2 | 7.440 | 7.427–7.453 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,142 | – | 74.6 | 7.9 |
| tileserver-gl 5.7.0 | 360 | 360 | – | 81.9 | 41.6 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,849 | – | 82.3 | 5.8 |
| bbox 0.6.2 (network-bound) | 8,000 | 2,847 | – | 82.3 | 42.4 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 18,000 | 2,845 | – | 82.4 | 5.9 |
| go-pmtiles 1.31.2 (network-bound) | 8,333 | 2,842 | – | 82.5 | 17.9 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.5%.

## berlin, pmtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.337 | 7.321–7.352 | 3 |
| 2 | go-pmtiles 1.31.2 | 7.996 | 7.982–8.009 | 3 |
| 2 | martin-1 1.16.1 | 8.003 | 7.977–8.029 | 3 |
| 2 | bbox 0.6.2 | 8.005 | 7.977–8.033 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 8.011 | 7.965–8.057 | 3 |
| 2 | tileserver-gl 5.7.0 | 8.021 | 7.847–8.195 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 90,667 | 15,379 | – | 15.2 | 31.1 |
| go-pmtiles 1.31.2 (network-bound) | 24,000 | 14,387 | – | 16.3 | 26.3 |
| martin-1 1.16.1 (network-bound) | 32,000 | 14,357 | – | 16.3 | 19.8 |
| bbox 0.6.2 (network-bound) | 26,667 | 14,382 | – | 16.3 | 19.5 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 88,000 | 14,363 | – | 16.3 | 23.1 |
| tileserver-gl 5.7.0 | 2,125 | 2,125 | – | 16.5 | 41.0 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.5–18.5%.

## berlin, pmtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.341 | 7.287–7.394 | 3 |
| 1 | tileserver-gl 5.7.0 | 7.959 | 6.632–9.287 | 2 |
| 2 | martin-1 1.16.1 | 7.993 | 7.948–8.037 | 3 |
| 2 | bbox 0.6.2 | 7.998 | 7.971–8.024 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 8.003 | 7.980–8.026 | 3 |
| 2 | go-pmtiles 1.31.2 | 8.010 | 7.998–8.023 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,366 | – | 15.3 | 30.2 |
| tileserver-gl 5.7.0 | 2,000 | 2,000 | – | 16.4 | 36.4 |
| martin-1 1.16.1 (network-bound) | 34,667 | 14,368 | – | 16.3 | 11.5 |
| bbox 0.6.2 (network-bound) | 30,000 | 14,338 | – | 16.3 | 26.1 |
| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 88,000 | 14,370 | – | 16.3 | 24.2 |
| go-pmtiles 1.31.2 (network-bound) | 22,000 | 14,395 | – | 16.3 | 26.7 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.5–18.7%.

## planet, files, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.142 | 5.944–6.340 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 959 | 959 | – | 67.6 | 15.9 |

## planet, files, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.100 | 5.959–6.242 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,104 | 1,104 | – | 67.3 | 34.3 |

## planet, files, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.747 | 6.577–6.917 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,021 | 1,021 | – | 0.5 | 32.5 |

## planet, files, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.720 | 6.610–6.829 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,188 | 1,188 | – | 0.5 | 10.8 |

## planet, mbtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | martin-1 1.16.1 | 6.104 | 6.041–6.166 | 3 |
| 1 | martin-2 2.0.0-beta.4 (pre-release) | 6.111 | 5.982–6.240 | 3 |
| 1 | mbtileserver 0.11.0 | 6.165 | 6.055–6.276 | 3 |
| 1 | tileserver-gl 5.7.0 | 6.356 | 4.233–8.478 | 2 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| martin-1 1.16.1 | 1,833 | 1,833 | – | 67.5 | 5.1 |
| martin-2 2.0.0-beta.4 (pre-release) | 1,875 | 1,875 | – | 67.6 | 4.1 |
| mbtileserver 0.11.0 | 1,875 | 1,875 | – | 68.2 | 4.3 |
| tileserver-gl 5.7.0 | 177 | 177 | – | 68.1 | 48.0 |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

## planet, mbtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | martin-2 2.0.0-beta.4 (pre-release) | 6.097 | 6.024–6.170 | 3 |
| 1 | mbtileserver 0.11.0 | 6.125 | 6.058–6.192 | 3 |
| 1 | martin-1 1.16.1 | 6.159 | 6.106–6.212 | 3 |
| 1 | tileserver-gl 5.7.0 | 6.186 | 6.155–6.218 | 3 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| martin-2 2.0.0-beta.4 (pre-release) | 1,875 | 1,875 | – | 67.4 | 3.9 |
| mbtileserver 0.11.0 | 1,875 | 1,875 | – | 67.8 | 4.0 |
| martin-1 1.16.1 | 1,875 | 1,875 | – | 68.1 | 4.9 |
| tileserver-gl 5.7.0 | 750 | 750 | – | 68.0 | 27.0 |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

## planet, mbtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.323 | 4.739–5.908 | 3 |
| 2 | martin-1 1.16.1 | 6.735 | 6.678–6.792 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 6.743 | 6.621–6.865 | 3 |
| 2 | tileserver-gl 5.7.0 | 6.762 | 6.426–7.098 | 3 |
| 2 | mbtileserver 0.11.0 | 6.794 | 6.690–6.898 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 2,250 | 2,250 | – | 0.5 | 31.1 |
| martin-1 1.16.1 | 5,500 | 5,500 | – | 0.5 | 14.3 |
| martin-2 2.0.0-beta.4 (pre-release) | 7,500 | 7,500 | – | 0.5 | 1.7 |
| tileserver-gl 5.7.0 | 584 | 584 | – | 0.5 | 26.7 |
| mbtileserver 0.11.0 | 7,500 | 7,500 | – | 0.5 | 1.6 |

## planet, mbtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.803 | 5.420–6.187 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 6.733 | 6.664–6.802 | 3 |
| 2 | mbtileserver 0.11.0 | 6.760 | 6.697–6.823 | 3 |
| 2 | tileserver-gl 5.7.0 | 6.781 | 6.731–6.831 | 3 |
| 2 | martin-1 1.16.1 | 6.792 | 6.742–6.842 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 3,083 | 3,083 | – | 0.5 | 23.9 |
| martin-2 2.0.0-beta.4 (pre-release) | 7,500 | 7,500 | – | 0.5 | 1.7 |
| mbtileserver 0.11.0 | 7,500 | 7,500 | – | 0.5 | 1.5 |
| tileserver-gl 5.7.0 | 1,458 | 1,458 | – | 0.5 | 16.8 |
| martin-1 1.16.1 | 5,667 | 5,667 | – | 0.5 | 8.1 |

## planet, pmtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | go-pmtiles 1.31.2 | 6.104 | 6.070–6.139 | 3 |
| 1 | martin-2 2.0.0-beta.4 (pre-release) | 6.134 | 6.101–6.168 | 3 |
| 1 | martin-1 1.16.1 | 6.155 | 6.023–6.288 | 3 |
| 2 | bbox 0.6.2 | 6.166 | 6.145–6.188 | 3 |
| – | tileserver-gl 5.7.0 (priced in 1 of 3 passes) | 6.356 | – | 1 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| go-pmtiles 1.31.2 (network-bound) | 3,750 | 3,465 | – | 67.6 | 27.5 |
| martin-2 2.0.0-beta.4 (pre-release) | 1,625 | 1,625 | – | 67.8 | 14.9 |
| martin-1 1.16.1 (network-bound) | 4,333 | 3,436 | – | 68.2 | 14.5 |
| bbox 0.6.2 | 1,625 | 1,625 | – | 68.1 | 14.3 |
| tileserver-gl 5.7.0 | 42 | 42 | – | 65.5 | 44.0 |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 2.0% of its answers at capacity, where the others' empty answers are 2.0–2.3%.

## planet, pmtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | martin-2 2.0.0-beta.4 (pre-release) | 6.088 | 5.898–6.278 | 3 |
| 1 | go-pmtiles 1.31.2 | 6.104 | 6.058–6.150 | 3 |
| 1 | martin-1 1.16.1 | 6.109 | 6.061–6.158 | 3 |
| 1 | bbox 0.6.2 | 6.193 | 6.145–6.241 | 3 |
| – | tileserver-gl 5.7.0 (held no rate within the target) | – | – | 0 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| martin-2 2.0.0-beta.4 (pre-release) | 1,625 | 1,625 | – | 67.3 | 3.2 |
| go-pmtiles 1.31.2 (network-bound) | 3,917 | 3,464 | – | 67.7 | 24.5 |
| martin-1 1.16.1 (network-bound) | 4,500 | 3,461 | – | 67.7 | 24.3 |
| bbox 0.6.2 | 1,625 | 1,625 | – | 68.5 | 8.0 |
| tileserver-gl 5.7.0 | 0 | 0 | – | – | – |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 2.0% of its answers at capacity, where the others' empty answers are 2.0–2.0%.

## planet, pmtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.462 | 5.139–5.785 | 3 |
| 2 | tileserver-gl 5.7.0 | 6.711 | 6.390–7.031 | 3 |
| 2 | go-pmtiles 1.31.2 | 6.751 | 6.718–6.783 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 6.760 | 6.728–6.792 | 3 |
| 2 | bbox 0.6.2 | 6.791 | 6.771–6.811 | 3 |
| 2 | martin-1 1.16.1 | 6.799 | 6.674–6.923 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 1,375 | 1,375 | – | 0.5 | 25.8 |
| tileserver-gl 5.7.0 | 417 | 417 | – | 0.5 | 48.4 |
| go-pmtiles 1.31.2 | 3,250 | 3,250 | – | 0.5 | 7.8 |
| martin-2 2.0.0-beta.4 (pre-release) | 6,000 | 6,000 | – | 0.5 | 4.3 |
| bbox 0.6.2 | 3,833 | 3,833 | – | 0.5 | 19.0 |
| martin-1 1.16.1 | 4,000 | 4,000 | – | 0.5 | 8.6 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 12.6% of its answers at capacity, where the others' empty answers are 12.5–12.8%.

## planet, pmtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.727 | 5.596–5.858 | 3 |
| 2 | martin-2 2.0.0-beta.4 (pre-release) | 6.721 | 6.542–6.901 | 3 |
| 2 | go-pmtiles 1.31.2 | 6.752 | 6.709–6.796 | 3 |
| 2 | martin-1 1.16.1 | 6.757 | 6.712–6.803 | 3 |
| 2 | bbox 0.6.2 | 6.821 | 6.775–6.866 | 3 |
| 2 | tileserver-gl 5.7.0 | 6.823 | 6.606–7.041 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 2,000 | 2,000 | – | 0.5 | 26.0 |
| martin-2 2.0.0-beta.4 (pre-release) | 6,500 | 6,500 | – | 0.5 | 3.6 |
| go-pmtiles 1.31.2 | 3,750 | 3,750 | – | 0.5 | 16.0 |
| martin-1 1.16.1 | 4,083 | 4,083 | – | 0.5 | 7.5 |
| bbox 0.6.2 | 4,500 | 4,500 | – | 0.5 | 16.1 |
| tileserver-gl 5.7.0 | 459 | 459 | – | 0.5 | 48.6 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 12.7% of its answers at capacity, where the others' empty answers are 12.4–12.6%.

## Start with 1,000 more sources (Berlin, reported)

| format | arch | server | first tile (ms) | last source's tile (ms) | never served | passes |
| :-- | :-- | :-- | --: | --: | --: | --: |
| mbtiles | amd64 | bbox 0.6.2 | 8,787 | 8,796 | 0 | 3 |
| mbtiles | amd64 | martin-1 1.16.1 | 2,267 | 2,275 | 0 | 3 |
| mbtiles | amd64 | martin-2 2.0.0-beta.4 | 1,892 | 1,899 | 0 | 3 |
| mbtiles | amd64 | mbtileserver 0.11.0 | 3,474 | 3,484 | 0 | 3 |
| mbtiles | amd64 | tileserver-gl 5.7.0 | 2,376 | 2,387 | 0 | 2 |
| mbtiles | amd64 | versatiles 5.4.1 | 4,386 | 4,395 | 0 | 3 |
| mbtiles | arm64 | bbox 0.6.2 | 8,241 | 8,249 | 0 | 3 |
| mbtiles | arm64 | martin-1 1.16.1 | 2,203 | 2,211 | 0 | 3 |
| mbtiles | arm64 | martin-2 2.0.0-beta.4 | 1,969 | 1,977 | 0 | 3 |
| mbtiles | arm64 | mbtileserver 0.11.0 | 5,039 | 5,049 | 0 | 3 |
| mbtiles | arm64 | tileserver-gl 5.7.0 | 2,046 | 2,058 | 0 | 3 |
| mbtiles | arm64 | versatiles 5.4.1 | 6,656 | 6,667 | 0 | 3 |
| pmtiles | amd64 | bbox 0.6.2 | – | – | 0 | 3 |
| pmtiles | amd64 | go-pmtiles 1.31.2 | 970 | 978 | 0 | 3 |
| pmtiles | amd64 | martin-1 1.16.1 | 1,190 | 1,200 | 0 | 3 |
| pmtiles | amd64 | martin-2 2.0.0-beta.4 | 1,162 | 1,169 | 0 | 3 |
| pmtiles | amd64 | tileserver-gl 5.7.0 | 2,511 | 2,522 | 0 | 3 |
| pmtiles | amd64 | versatiles 5.4.1 | 1,758 | 1,767 | 0 | 3 |
| pmtiles | arm64 | bbox 0.6.2 | – | – | 0 | 3 |
| pmtiles | arm64 | go-pmtiles 1.31.2 | 820 | 830 | 0 | 3 |
| pmtiles | arm64 | martin-1 1.16.1 | 1,441 | 1,450 | 0 | 3 |
| pmtiles | arm64 | martin-2 2.0.0-beta.4 | 1,543 | 1,551 | 0 | 3 |
| pmtiles | arm64 | tileserver-gl 5.7.0 | 2,686 | 2,698 | 0 | 2 |
| pmtiles | arm64 | versatiles 5.4.1 | 1,755 | 1,764 | 0 | 3 |

## Not measured

| unit | not measured in | why |
| :-- | :-- | :-- |
| bbox-mbtiles-planet-amd64 | every pass (skipped) | BBOX 0.6.2 cannot open Planetiler's deduplicated MBTiles schema (tiles_shallow and tiles_data under a tiles view): "Invalid data format for MBTile file" |
| bbox-mbtiles-planet-arm64 | every pass (skipped) | BBOX 0.6.2 cannot open Planetiler's deduplicated MBTiles schema (tiles_shallow and tiles_data under a tiles view): "Invalid data format for MBTile file" |
| tileserver-gl-mbtiles-berlin-amd64 | pass 2 | aws ec2 run-instances: aws: [ERROR]: An error occurred (RequestLimitExceeded) when calling the RunInstances operation (reached max retries: 9): Request limit exceeded. The account has been throttled on ec2:RunInstances because it exceeded its request rate limit. |
| tileserver-gl-pmtiles-berlin-arm64 | pass 2 | aws ec2 run-instances: aws: [ERROR]: An error occurred (RequestLimitExceeded) when calling the RunInstances operation (reached max retries: 9): Request limit exceeded. The account has been throttled on ec2:RunInstances because it exceeded its request rate limit. |
