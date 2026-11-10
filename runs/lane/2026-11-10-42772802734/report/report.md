# Archive lane

Dollars per million tiles at AWS list prices of 2026-10-29 (us-east-1); lower is better. A rank is shared unless the 95% confidence intervals over the passes do not overlap. The price takes each server's capacity capped at the instance's sustained network rate (1.875 Gbps); the measured capacity and the server container's CPU per tile at it stand beside each ranking, unranked.

## berlin, files, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.433 | 7.411–7.455 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 18,000 | 2,846 | 28 | 82.4 | 6.6 |

## berlin, files, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.428 | 7.405–7.452 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 18,000 | 2,846 | 19 | 82.3 | 5.6 |

## berlin, files, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 8.001 | 7.980–8.021 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 88,000 | 14,356 | 15 | 16.3 | 26.6 |

## berlin, files, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 7.999 | 7.977–8.022 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 (network-bound) | 88,000 | 14,366 | 12 | 16.3 | 26.6 |

## berlin, mbtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | tileserver-gl 5.7.0 | 7.408 | 7.344–7.472 | 2 |
| 1 | mbtileserver 0.11.0 | 7.425 | 7.420–7.431 | 3 |
| 1 | martin-1 1.16.1 | 7.428 | 7.405–7.451 | 2 |
| – | versatiles 5.4.1 (priced in 1 of 3 passes) | 6.729 | – | 1 |
| – | bbox 0.6.2 (priced in 1 of 3 passes) | 7.424 | – | 1 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| tileserver-gl 5.7.0 (network-bound) | 4,750 | 2,855 | 282 | 82.1 | 15.1 |
| mbtileserver 0.11.0 (network-bound) | 11,333 | 2,849 | 252 | 82.3 | 10.7 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,847 | 159 | 82.3 | 5.1 |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,143 | 31 | 74.6 | 7.9 |
| bbox 0.6.2 (network-bound) | 4,500 | 2,849 | 543 | 82.3 | 6.1 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.5%.

## berlin, mbtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.730 | 6.712–6.747 | 3 |
| 2 | martin-2 build ff76524 (pre-release) | 7.415 | 7.393–7.437 | 3 |
| 2 | mbtileserver 0.11.0 | 7.415 | 7.392–7.438 | 3 |
| 2 | martin-1 1.16.1 | 7.426 | 7.394–7.457 | 3 |
| 2 | bbox 0.6.2 | 7.430 | 7.421–7.440 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.450 | 7.418–7.482 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,142 | 28 | 74.6 | 7.3 |
| martin-2 build ff76524 (pre-release) (network-bound) | 18,000 | 2,852 | 41 | 82.2 | 6.0 |
| mbtileserver 0.11.0 (network-bound) | 13,667 | 2,852 | 196 | 82.2 | 7.9 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,847 | 138 | 82.3 | 5.6 |
| bbox 0.6.2 (network-bound) | 4,833 | 2,846 | 509 | 82.4 | 41.4 |
| tileserver-gl 5.7.0 (network-bound) | 4,667 | 2,838 | 264 | 82.6 | 19.3 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.5%.

## berlin, mbtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | tileserver-gl 5.7.0 | 7.978 | 7.918–8.037 | 2 |
| 1 | mbtileserver 0.11.0 | 7.994 | 7.988–7.999 | 3 |
| 1 | martin-1 1.16.1 | 7.997 | 7.975–8.018 | 2 |
| – | versatiles 5.4.1 (priced in 1 of 3 passes) | 7.338 | – | 1 |
| – | bbox 0.6.2 (priced in 1 of 3 passes) | 7.993 | – | 1 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| tileserver-gl 5.7.0 | 9,500 | 9,500 | 134 | 16.3 | 12.9 |
| mbtileserver 0.11.0 (network-bound) | 32,000 | 14,367 | 94 | 16.3 | 13.5 |
| martin-1 1.16.1 (network-bound) | 32,000 | 14,352 | 115 | 16.3 | 12.1 |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,343 | 23 | 15.3 | 32.0 |
| bbox 0.6.2 | 13,000 | 13,000 | 172 | 16.3 | 4.4 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.7% of its answers at capacity, where the others' empty answers are 18.5–18.5%.

## berlin, mbtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.341 | 7.324–7.357 | 3 |
| 2 | martin-2 build ff76524 (pre-release) | 7.986 | 7.966–8.007 | 3 |
| 2 | mbtileserver 0.11.0 | 7.987 | 7.965–8.009 | 3 |
| 2 | martin-1 1.16.1 | 7.997 | 7.967–8.027 | 3 |
| 2 | bbox 0.6.2 | 8.001 | 7.992–8.010 | 3 |
| 2 | tileserver-gl 5.7.0 | 8.020 | 7.990–8.050 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,375 | 21 | 15.2 | 40.7 |
| martin-2 build ff76524 (pre-release) (network-bound) | 88,000 | 14,365 | 26 | 16.3 | 24.3 |
| mbtileserver 0.11.0 (network-bound) | 34,667 | 14,364 | 81 | 16.3 | 9.5 |
| martin-1 1.16.1 (network-bound) | 36,000 | 14,368 | 101 | 16.3 | 12.2 |
| bbox 0.6.2 | 12,667 | 12,667 | 169 | 16.3 | 9.5 |
| tileserver-gl 5.7.0 | 8,333 | 8,333 | 143 | 16.3 | 19.0 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.5–18.6%.

## berlin, pmtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.739 | 6.645–6.833 | 2 |
| 2 | go-pmtiles 1.31.2 | 7.416 | 7.373–7.459 | 3 |
| 2 | bbox 0.6.2 | 7.462 | 7.199–7.725 | 2 |
| – | martin-1 1.16.1 (priced in 1 of 3 passes) | 7.420 | – | 1 |
| – | tileserver-gl 5.7.0 (priced in 1 of 3 passes) | 7.444 | – | 1 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,139 | 32 | 74.7 | 7.3 |
| go-pmtiles 1.31.2 (network-bound) | 8,333 | 2,852 | 357 | 82.2 | 22.1 |
| bbox 0.6.2 (network-bound) | 6,500 | 2,835 | 485 | 82.7 | 10.8 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,851 | 160 | 82.2 | 5.0 |
| tileserver-gl 5.7.0 | 313 | 313 | 7,058 | 80.6 | 48.7 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.6%.

## berlin, pmtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 6.726 | 6.707–6.745 | 3 |
| 2 | bbox 0.6.2 | 7.407 | 7.394–7.419 | 3 |
| 2 | martin-1 1.16.1 | 7.419 | 7.390–7.449 | 3 |
| 2 | go-pmtiles 1.31.2 | 7.432 | 7.398–7.467 | 3 |
| 2 | martin-2 build ff76524 (pre-release) | 7.433 | 7.417–7.448 | 3 |
| 3 | tileserver-gl 5.7.0 | 7.542 | 7.436–7.648 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 20,000 | 3,144 | 28 | 74.6 | 6.9 |
| bbox 0.6.2 (network-bound) | 8,000 | 2,855 | 419 | 82.1 | 42.3 |
| martin-1 1.16.1 (network-bound) | 18,000 | 2,850 | 140 | 82.2 | 5.5 |
| go-pmtiles 1.31.2 (network-bound) | 9,000 | 2,845 | 302 | 82.4 | 16.9 |
| martin-2 build ff76524 (pre-release) (network-bound) | 18,000 | 2,845 | 42 | 82.4 | 5.5 |
| tileserver-gl 5.7.0 | 375 | 375 | 5,829 | 82.3 | 43.3 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.5% of its answers at capacity, where the others' empty answers are 1.5–1.6%.

## berlin, pmtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.348 | 7.259–7.436 | 2 |
| 2 | go-pmtiles 1.31.2 | 7.985 | 7.944–8.025 | 3 |
| 2 | bbox 0.6.2 | 8.028 | 7.780–8.276 | 2 |
| – | tileserver-gl 5.7.0 (priced in 1 of 3 passes) | 7.857 | – | 1 |
| – | martin-1 1.16.1 (priced in 1 of 3 passes) | 7.989 | – | 1 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,365 | 23 | 15.3 | 34.6 |
| go-pmtiles 1.31.2 (network-bound) | 22,667 | 14,382 | 126 | 16.3 | 13.0 |
| bbox 0.6.2 (network-bound) | 26,000 | 14,333 | 114 | 16.4 | 7.8 |
| tileserver-gl 5.7.0 | 2,250 | 2,250 | 1,140 | 16.5 | 32.0 |
| martin-1 1.16.1 (network-bound) | 32,000 | 14,364 | 114 | 16.3 | 12.2 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.1–18.5%.

## berlin, pmtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 7.338 | 7.320–7.355 | 3 |
| 2 | bbox 0.6.2 | 7.979 | 7.967–7.991 | 3 |
| 2 | martin-1 1.16.1 | 7.991 | 7.963–8.018 | 3 |
| 2 | tileserver-gl 5.7.0 | 7.997 | 7.911–8.083 | 3 |
| 2 | go-pmtiles 1.31.2 | 8.003 | 7.970–8.035 | 3 |
| 2 | martin-2 build ff76524 (pre-release) | 8.003 | 7.989–8.018 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 (network-bound) | 96,000 | 15,350 | 21 | 15.3 | 37.3 |
| bbox 0.6.2 (network-bound) | 30,000 | 14,359 | 102 | 16.3 | 21.9 |
| martin-1 1.16.1 (network-bound) | 34,667 | 14,364 | 104 | 16.3 | 13.0 |
| tileserver-gl 5.7.0 | 2,250 | 2,250 | 1,072 | 16.5 | 31.8 |
| go-pmtiles 1.31.2 (network-bound) | 22,667 | 14,375 | 121 | 16.3 | 20.0 |
| martin-2 build ff76524 (pre-release) (network-bound) | 88,000 | 14,364 | 25 | 16.3 | 24.1 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 18.5% of its answers at capacity, where the others' empty answers are 18.4–18.6%.

## planet, files, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.166 | 5.758–6.575 | 2 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,125 | 1,125 | 61 | 67.9 | 15.6 |

## planet, files, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.183 | 6.047–6.319 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,208 | 1,208 | 62 | 68.2 | 26.3 |

## planet, files, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.778 | 6.395–7.162 | 2 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,188 | 1,188 | 50 | 0.5 | 34.0 |

## planet, files, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | nginx 1.30.4 | 6.803 | 6.678–6.928 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| nginx 1.30.4 | 1,292 | 1,292 | 48 | 0.5 | 17.9 |

## planet, mbtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | martin-1 1.16.1 | 6.109 | 6.001–6.218 | 3 |
| – | mbtileserver 0.11.0 (priced in 1 of 3 passes) | 6.156 | – | 1 |
| – | tileserver-gl 5.7.0 (priced in 1 of 3 passes) | 6.546 | – | 1 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| martin-1 1.16.1 | 1,542 | 1,542 | 588 | 67.4 | 19.7 |
| mbtileserver 0.11.0 | 1,875 | 1,875 | 278 | 68.1 | 3.8 |
| tileserver-gl 5.7.0 | 219 | 219 | 531 | 69.8 | 35.7 |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

## planet, mbtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | martin-1 1.16.1 | 6.105 | 6.006–6.204 | 3 |
| 1 | mbtileserver 0.11.0 | 6.114 | 6.097–6.131 | 3 |
| 1 | martin-2 build ff76524 (pre-release) | 6.158 | 5.952–6.365 | 3 |
| 1 | tileserver-gl 5.7.0 | 6.176 | 5.942–6.411 | 3 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| martin-1 1.16.1 | 1,875 | 1,875 | 714 | 67.5 | 4.8 |
| mbtileserver 0.11.0 | 1,875 | 1,875 | 228 | 67.6 | 3.7 |
| martin-2 build ff76524 (pre-release) | 1,833 | 1,833 | 150 | 68.1 | 3.7 |
| tileserver-gl 5.7.0 | 875 | 875 | 347 | 68.0 | 33.0 |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

## planet, mbtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.383 | 4.154–6.613 | 2 |
| 2 | martin-1 1.16.1 | 6.732 | 6.659–6.805 | 3 |
| – | mbtileserver 0.11.0 (priced in 1 of 3 passes) | 6.785 | – | 1 |
| – | tileserver-gl 5.7.0 (priced in 1 of 3 passes) | 6.938 | – | 1 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 2,250 | 2,250 | 1,445 | 0.5 | 29.3 |
| martin-1 1.16.1 | 5,500 | 5,500 | 580 | 0.5 | 20.9 |
| mbtileserver 0.11.0 | 7,500 | 7,500 | 68 | 0.5 | 1.5 |
| tileserver-gl 5.7.0 | 688 | 688 | 264 | 0.5 | 31.9 |

## planet, mbtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.852 | 5.476–6.227 | 3 |
| 2 | martin-1 1.16.1 | 6.741 | 6.648–6.834 | 3 |
| 2 | mbtileserver 0.11.0 | 6.750 | 6.734–6.766 | 3 |
| 2 | tileserver-gl 5.7.0 | 6.781 | 6.559–7.002 | 3 |
| 2 | martin-2 build ff76524 (pre-release) | 6.791 | 6.595–6.986 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 3,083 | 3,083 | 1,086 | 0.5 | 23.7 |
| martin-1 1.16.1 | 4,833 | 4,833 | 550 | 0.5 | 6.0 |
| mbtileserver 0.11.0 | 7,500 | 7,500 | 65 | 0.5 | 1.4 |
| tileserver-gl 5.7.0 | 1,708 | 1,708 | 173 | 0.5 | 18.7 |
| martin-2 build ff76524 (pre-release) | 7,500 | 7,500 | 82 | 0.5 | 1.6 |

## planet, pmtiles, server alone, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | martin-1 1.16.1 | 6.057 | 6.054–6.061 | 2 |
| 1 | bbox 0.6.2 | 6.069 | 5.996–6.141 | 3 |
| – | go-pmtiles 1.31.2 (priced in 1 of 3 passes) | 6.084 | – | 1 |
| – | tileserver-gl 5.7.0 (priced in 1 of 3 passes) | 6.687 | – | 1 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| martin-1 1.16.1 (network-bound) | 4,250 | 3,492 | 809 | 67.1 | 13.5 |
| bbox 0.6.2 | 1,625 | 1,625 | 888 | 67.0 | 22.4 |
| go-pmtiles 1.31.2 (network-bound) | 3,750 | 3,477 | 760 | 67.4 | 33.6 |
| tileserver-gl 5.7.0 | 63 | 63 | 8,211 | 69.1 | 48.6 |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.9% of its answers at capacity, where the others' empty answers are 1.2–2.0%.

## planet, pmtiles, server alone, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | bbox 0.6.2 | 6.115 | 5.897–6.332 | 3 |
| 1 | martin-2 build ff76524 (pre-release) | 6.124 | 6.101–6.147 | 3 |
| 1 | go-pmtiles 1.31.2 | 6.136 | 6.068–6.203 | 3 |
| 1 | martin-1 1.16.1 | 6.139 | 6.056–6.223 | 3 |
| – | tileserver-gl 5.7.0 (held no rate within the target) | – | – | 0 |
| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| bbox 0.6.2 | 1,667 | 1,667 | 879 | 67.6 | 12.0 |
| martin-2 build ff76524 (pre-release) (network-bound) | 9,000 | 3,453 | 245 | 67.9 | 2.8 |
| go-pmtiles 1.31.2 (network-bound) | 4,000 | 3,446 | 672 | 68.0 | 25.6 |
| martin-1 1.16.1 (network-bound) | 4,000 | 3,444 | 855 | 68.0 | 11.0 |
| tileserver-gl 5.7.0 | 0 | 0 | – | – | – |
| versatiles 5.4.1 | 0 | 0 | – | – | – |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 2.1% of its answers at capacity, where the others' empty answers are 1.9–2.0%.

## planet, pmtiles, behind a CDN, amd64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.341 | 3.007–7.676 | 2 |
| 1 | bbox 0.6.2 | 6.699 | 6.630–6.768 | 3 |
| 1 | martin-1 1.16.1 | 6.706 | 6.702–6.710 | 2 |
| 1 | tileserver-gl 5.7.0 | 6.854 | 6.399–7.309 | 2 |
| – | go-pmtiles 1.31.2 (priced in 1 of 3 passes) | 6.731 | – | 1 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 1,375 | 1,375 | 2,179 | 0.5 | 23.4 |
| bbox 0.6.2 | 4,000 | 4,000 | 664 | 0.5 | 14.8 |
| martin-1 1.16.1 | 4,250 | 4,250 | 776 | 0.5 | 22.6 |
| tileserver-gl 5.7.0 | 360 | 360 | 2,746 | 0.5 | 40.6 |
| go-pmtiles 1.31.2 | 3,250 | 3,250 | 887 | 0.5 | 6.9 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 12.6% of its answers at capacity, where the others' empty answers are 12.6–12.9%.

## planet, pmtiles, behind a CDN, arm64

| rank | server | $ per M tiles | 95% CI | passes |
| --: | :-- | --: | --: | --: |
| 1 | versatiles 5.4.1 | 5.895 | 5.737–6.053 | 3 |
| 2 | tileserver-gl 5.7.0 | 6.736 | 6.592–6.880 | 3 |
| 2 | bbox 0.6.2 | 6.747 | 6.540–6.954 | 3 |
| 2 | martin-2 build ff76524 (pre-release) | 6.770 | 6.749–6.792 | 3 |
| 2 | go-pmtiles 1.31.2 | 6.782 | 6.718–6.846 | 3 |
| 2 | martin-1 1.16.1 | 6.785 | 6.706–6.864 | 3 |

| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |
| :-- | --: | --: | --: | --: | --: |
| versatiles 5.4.1 | 1,875 | 1,875 | 1,593 | 0.5 | 20.1 |
| tileserver-gl 5.7.0 | 479 | 479 | 1,770 | 0.5 | 45.3 |
| bbox 0.6.2 | 4,500 | 4,500 | 565 | 0.5 | 16.0 |
| martin-2 build ff76524 (pre-release) | 13,000 | 13,000 | 249 | 0.5 | 10.4 |
| go-pmtiles 1.31.2 | 3,750 | 3,750 | 795 | 0.5 | 13.4 |
| martin-1 1.16.1 | 4,083 | 4,083 | 735 | 0.5 | 6.6 |

bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 12.6% of its answers at capacity, where the others' empty answers are 12.5–12.8%.

## Start with 1,000 more sources (Berlin, reported)

| format | arch | server | first tile (ms) | last source's tile (ms) | never served | passes |
| :-- | :-- | :-- | --: | --: | --: | --: |
| mbtiles | amd64 | bbox 0.6.2 | 8,045 | 8,054 | 0 | 1 |
| mbtiles | amd64 | martin-1 1.16.1 | 2,144 | 2,151 | 0 | 2 |
| mbtiles | amd64 | mbtileserver 0.11.0 | 3,510 | 3,519 | 0 | 3 |
| mbtiles | amd64 | tileserver-gl 5.7.0 | 2,257 | 2,267 | 0 | 2 |
| mbtiles | amd64 | versatiles 5.4.1 | 4,092 | 4,101 | 0 | 1 |
| mbtiles | arm64 | bbox 0.6.2 | 7,876 | 7,885 | 0 | 3 |
| mbtiles | arm64 | martin-1 1.16.1 | 2,054 | 2,062 | 0 | 3 |
| mbtiles | arm64 | martin-2 build ff76524 | 2,349 | 2,357 | 0 | 3 |
| mbtiles | arm64 | mbtileserver 0.11.0 | 3,142 | 3,153 | 0 | 3 |
| mbtiles | arm64 | tileserver-gl 5.7.0 | 2,457 | 2,467 | 0 | 3 |
| mbtiles | arm64 | versatiles 5.4.1 | 5,732 | 5,742 | 0 | 3 |
| pmtiles | amd64 | bbox 0.6.2 | – | – | 0 | 2 |
| pmtiles | amd64 | go-pmtiles 1.31.2 | 965 | 974 | 0 | 3 |
| pmtiles | amd64 | martin-1 1.16.1 | 1,079 | 1,086 | 0 | 1 |
| pmtiles | amd64 | tileserver-gl 5.7.0 | 2,206 | 2,215 | 0 | 1 |
| pmtiles | amd64 | versatiles 5.4.1 | 1,727 | 1,735 | 0 | 2 |
| pmtiles | arm64 | bbox 0.6.2 | – | – | 0 | 3 |
| pmtiles | arm64 | go-pmtiles 1.31.2 | 790 | 799 | 0 | 3 |
| pmtiles | arm64 | martin-1 1.16.1 | 1,192 | 1,201 | 0 | 3 |
| pmtiles | arm64 | martin-2 build ff76524 | 1,195 | 1,204 | 0 | 3 |
| pmtiles | arm64 | tileserver-gl 5.7.0 | 2,043 | 2,053 | 0 | 3 |
| pmtiles | arm64 | versatiles 5.4.1 | 1,661 | 1,669 | 0 | 3 |

## Not measured

| unit | not measured in | why |
| :-- | :-- | :-- |
| bbox-mbtiles-berlin-amd64 | pass 2, 3 | no zone had room for both of bbox-mbtiles-berlin-amd64's instances |
| bbox-mbtiles-planet-amd64 | every pass (skipped) | BBOX 0.6.2 cannot open Planetiler's deduplicated MBTiles schema (tiles_shallow and tiles_data under a tiles view): "Invalid data format for MBTile file" |
| bbox-mbtiles-planet-arm64 | every pass (skipped) | BBOX 0.6.2 cannot open Planetiler's deduplicated MBTiles schema (tiles_shallow and tiles_data under a tiles view): "Invalid data format for MBTile file" |
| bbox-pmtiles-berlin-amd64 | pass 3 | no zone had room for both of bbox-pmtiles-berlin-amd64's instances |
| go-pmtiles-pmtiles-planet-amd64 | pass 2, 3 | no zone had room for both of go-pmtiles-pmtiles-planet-amd64's instances |
| martin-1-mbtiles-berlin-amd64 | pass 3 | no zone had room for both of martin-1-mbtiles-berlin-amd64's instances |
| martin-1-pmtiles-berlin-amd64 | pass 2, 3 | no zone had room for both of martin-1-pmtiles-berlin-amd64's instances |
| martin-1-pmtiles-planet-amd64 | pass 3 | no zone had room for both of martin-1-pmtiles-planet-amd64's instances |
| martin-2-mbtiles-berlin-amd64 | every pass (skipped) | no amd64 image, and the run builds none |
| martin-2-mbtiles-planet-amd64 | every pass (skipped) | no amd64 image, and the run builds none |
| martin-2-pmtiles-berlin-amd64 | every pass (skipped) | no amd64 image, and the run builds none |
| martin-2-pmtiles-planet-amd64 | every pass (skipped) | no amd64 image, and the run builds none |
| mbtileserver-mbtiles-planet-amd64 | pass 2, 3 | no zone had room for both of mbtileserver-mbtiles-planet-amd64's instances |
| nginx-files-planet-amd64 | pass 2 | no zone had room for both of nginx-files-planet-amd64's instances |
| tileserver-gl-mbtiles-berlin-amd64 | pass 3 | no zone had room for both of tileserver-gl-mbtiles-berlin-amd64's instances |
| tileserver-gl-mbtiles-planet-amd64 | pass 2, 3 | no zone had room for both of tileserver-gl-mbtiles-planet-amd64's instances |
| tileserver-gl-pmtiles-berlin-amd64 | pass 2, 3 | no zone had room for both of tileserver-gl-pmtiles-berlin-amd64's instances |
| tileserver-gl-pmtiles-planet-amd64 | pass 3 | no zone had room for both of tileserver-gl-pmtiles-planet-amd64's instances |
| versatiles-mbtiles-berlin-amd64 | pass 2, 3 | no zone had room for both of versatiles-mbtiles-berlin-amd64's instances |
| versatiles-mbtiles-planet-amd64 | pass 3 | no zone had room for both of versatiles-mbtiles-planet-amd64's instances |
| versatiles-pmtiles-berlin-amd64 | pass 3 | no zone had room for both of versatiles-pmtiles-berlin-amd64's instances |
| versatiles-pmtiles-planet-amd64 | pass 3 | no zone had room for both of versatiles-pmtiles-planet-amd64's instances |
