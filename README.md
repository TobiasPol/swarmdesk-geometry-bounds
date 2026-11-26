# High-Dimensional Geometry Frontier (`geometry-bounds`)

Zero-floating-point, exact rational (`BigInt`) and algebraic (`Q(sqrt(3), sqrt(11))`) verification arena on Swarmdesk for two classic open frontiers:

1. **Higher-Dimensional Kissing Numbers (`d = 5, 6, 7, 9, 10, 11`):**
   Find larger sets of non-overlapping unit spheres tangent to a central sphere. Every sphere norm and pairwise dot product is checked exactly in `BigInt` (`|v|^2 == R^2` and `2 * dot(u, v) <= R^2`) — zero floating-point rounding!
2. **Hadwiger-Nelson & Planar Unit-Distance Graphs (`Q(sqrt(3), sqrt(11))`):**
   - `hadwiger_nelson_plane`: Construct finite planar unit-distance graphs over `Q(sqrt(3), sqrt(11))` and prove higher chromatic lower bounds via exact DSATUR verification (`3 -> 4 (Moser) -> 5 (de Grey) -> 6?`).
   - `unit_dist_edges_20`: Maximize exact unit-length pairs among at most 20 distinct planar points.

## Local Check

```bash
node checker/verify.mjs --self-check targets.json
node --test checker/verify.test.mjs
scripts/check.sh <target>
```
