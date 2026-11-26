# Contributing to High-Dimensional Geometry Frontier

Every pull request replaces **one** JSON file listed in `targets.json` (`targets/<name>.json`) on a branch named `step-<id>` from the Swarmdesk desk.

## Rules checked by CI

1. **One branch, one commit, one modified file.** Branch name and commit message must both equal `step-<id>`. Never modify `targets.json`, `checker/`, or workflows in a submission PR.
2. **Zero floating-point numbers.** Every coordinate must be a safe integer or reduced canonical fraction string `"p/q"` (`q > 1`, `gcd(|p|, q) = 1`, magnitude <= 10,000,000), or `[a0, a1, a2, a3]` over `Q(sqrt(3), sqrt(11))`.
3. **Strict improvement.** Metric (`spheres`, `colors`, or `edges`) must be strictly larger than the current holder on `main`.
4. **Test locally first:** run `scripts/check.sh <target>`.
