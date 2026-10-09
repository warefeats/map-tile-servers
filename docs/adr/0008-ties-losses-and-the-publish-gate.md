# 0008 — Ties, losses, and when the page is published

Date: 2026-10-08. Status: accepted before the measured pass. Amends ADR 0001.

## Context

ADR 0001 publishes only if Martin 2.0 handily wins all 22 categories. By 2026-10-08, five full runs had shown that four of them cannot be won under that rule by any build of Martin, and that the rule itself counted three kinds of result as losses that are not:

| Kind of result | Categories (int16) | Why ADR 0001 scores it as a loss |
|----------------|--------------------|-----------------------------------|
| A tie with 1.16.1 | five PostGIS categories | Condition 1 asks for the best of every candidate, 1.16.1 included, so 2.0 has to beat its own predecessor by noise alone |
| Database-bound | PostGIS 10 clients, 100 clients, capacity, burst, session | The database does nearly all the work per tile (6,682 of Martin 2.0's 6,853 µs of CPU in int16's walk, 97.5%), so no server can lead by 10% |
| At the harness floor | archive time to first tile, burst, 10-user session | Fixed by ADR 0007 |
| Below Martin's runtime | archive memory | VersaTiles held 1.3 MiB of anonymous memory after load in int14; Martin holds more than that before it serves a tile (its relocated binary pages alone are about 1.1 MB) |

Re-scored with condition 1 read against rivals only, int16 wins 13 of 22. On 2026-09-28 John agreed to what he called a fine and fair path: report database-bound ties as ties, fix floor-bound measurements with an ADR written before re-running and applied to every server (ADR 0007), and report VersaTiles' memory lead. He confirmed it on 2026-10-08, keeping the right to change the rule before and after publication. Any such change is written down as its own ADR with its date, and the page says which rule judged it.

## Decision

1. **Rivals.** A rival is any candidate that is not Martin; the floor control (ADR 0007) is not a candidate. ADR 0001's conditions compare Martin 2.0 with rivals only. Martin 1.16.1 is judged by ADR 0001's "Faster than 1.16.1" section alone: "no change" is a tie with 1.16.1, and only "slower" counts against 2.0.
2. **Three outcomes.** Every category ends in one of three outcomes, under one standard for both sides:

| Outcome | Rule |
|---------|------|
| Won | Martin 2.0's statistic beats the best rival's by at least 10% (memory: 20%), and the 95% intervals do not overlap (capacity: at least one ladder step higher) |
| Lost | The best rival beats Martin 2.0's statistic by the same standard |
| Tie | Anything else |

"Won" is ADR 0001's "handily wins", with condition 1 read against rivals. In the archive family, margins are computed on time above the floor where ADR 0007 says so.

3. **Database-bound.** A PostGIS category that serves tiles is database-bound when the database spends at least 90% of the CPU per tile in Martin 2.0's random walk in the same run. Those categories are single tile, burst, 10 clients, 100 clients, random walk, cost per tile, capacity and map session. Time to first tile, a thousand sources and memory are never database-bound.
4. **Archive memory** is measured, ranked and shown with its outcome, and does not decide publication.
5. **Publishing.** The page is published when all of these hold:
   - No category is slower than 1.16.1.
   - Every category is Won, except that a database-bound category may be a Tie.
   - Archive memory is reported, whatever its outcome.

   Every category that is not Won still gets a recommendation for a martin session, as ADR 0001 says.

With two passes (ADR 0005), samples are pooled. Capacity is the highest step a candidate held in both passes, and memory pools its four readings (after load and after the sessions, in each pass). A database-bound share is computed from both passes' walks together.

## Consequences

- The page can say "tie" where the database or the noise decides a category, and "lost" only where a rival is ahead by a margin the rule would have called a win for Martin.
- A Tie outside the database-bound categories still blocks publication, as does any Lost.
