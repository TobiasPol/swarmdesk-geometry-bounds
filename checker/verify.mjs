#!/usr/bin/env node
// Zero-dependency exact BigInt/quadratic-field verifier for high-dimensional kissing numbers
// and Hadwiger-Nelson unit-distance graphs over Q(sqrt(3), sqrt(11)).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const MAX_ABS = 10_000_000n;
const FRAC_RE = /^-?[1-9][0-9]*\/[1-9][0-9]*$/;
const MAX_BACKTRACK_NODES = 600_000;

function gcdBig(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function lcmBig(a, b) {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcdBig(a, b)) * b;
}

function rejected(reasonCode, reason, extra = {}) {
  return {
    verdict: "REJECTED",
    reason_code: reasonCode,
    reason,
    resolution: "",
    metric_value: extra.metric_value ?? null,
    holder_value: extra.holder_value ?? null,
    proof_lines: 0,
    wasm_bytes: 0,
    class_fuel: "{}",
  };
}

export function parseRational(val, label) {
  if (typeof val === "number") {
    if (!Number.isSafeInteger(val)) return { ok: false, error: `${label} must be an exact integer or p/q fraction` };
    const num = BigInt(val);
    if ((num < 0n ? -num : num) > MAX_ABS) return { ok: false, error: `${label} exceeds magnitude limit` };
    return { ok: true, value: { num, den: 1n } };
  }
  if (typeof val === "string") {
    if (/^-?(?:0|[1-9][0-9]*)$/.test(val)) {
      const num = BigInt(val);
      if ((num < 0n ? -num : num) > MAX_ABS) return { ok: false, error: `${label} exceeds magnitude limit` };
      return { ok: true, value: { num, den: 1n } };
    }
    if (FRAC_RE.test(val)) {
      const [nStr, dStr] = val.split("/");
      const num = BigInt(nStr);
      const den = BigInt(dStr);
      if (den <= 1n) return { ok: false, error: `${label} denominator must be > 1` };
      if (gcdBig(num, den) !== 1n) return { ok: false, error: `${label} fraction must be reduced` };
      if ((num < 0n ? -num : num) > MAX_ABS || den > MAX_ABS) {
        return { ok: false, error: `${label} exceeds magnitude limit` };
      }
      return { ok: true, value: { num, den } };
    }
  }
  return { ok: false, error: `${label} must be an exact integer or canonical p/q string` };
}

function rNorm(num, den) {
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcdBig(num, den);
  const s = den < 0n ? -1n : 1n;
  return { num: (num / g) * s, den: (den / g) * s };
}

const rAdd = (a, b) => rNorm(a.num * b.den + b.num * a.den, a.den * b.den);
const rSub = (a, b) => rNorm(a.num * b.den - b.num * a.den, a.den * b.den);
const rMul = (a, b) => rNorm(a.num * b.num, a.den * b.den);
const rEq = (a, b) => a.num === b.num && a.den === b.den;
const rZero = { num: 0n, den: 1n };

function parseQuadScalar(val, label) {
  if (typeof val === "number" || typeof val === "string") {
    const r = parseRational(val, label);
    if (!r.ok) return r;
    return { ok: true, value: [r.value, rZero, rZero, rZero] };
  }
  if (!Array.isArray(val) || val.length !== 4) {
    return { ok: false, error: `${label} must be a rational or [a0, a1, a2, a3] in Q(sqrt(3), sqrt(11))` };
  }
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    const r = parseRational(val[i], `${label}[${i}]`);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

const qSub = (a, b) => [rSub(a[0], b[0]), rSub(a[1], b[1]), rSub(a[2], b[2]), rSub(a[3], b[3])];
const qAdd = (a, b) => [rAdd(a[0], b[0]), rAdd(a[1], b[1]), rAdd(a[2], b[2]), rAdd(a[3], b[3])];
const qIsZero = (a) => a.every((c) => c.num === 0n);

function qSquare(a) {
  const [a0, a1, a2, a3] = a;
  const k2 = { num: 2n, den: 1n };
  const k3 = { num: 3n, den: 1n };
  const k6 = { num: 6n, den: 1n };
  const k11 = { num: 11n, den: 1n };
  const k22 = { num: 22n, den: 1n };
  const k33 = { num: 33n, den: 1n };
  const c0 = rAdd(
    rAdd(rMul(a0, a0), rMul(k3, rMul(a1, a1))),
    rAdd(rMul(k11, rMul(a2, a2)), rMul(k33, rMul(a3, a3))),
  );
  const c1 = rAdd(rMul(k2, rMul(a0, a1)), rMul(k22, rMul(a2, a3)));
  const c2 = rAdd(rMul(k2, rMul(a0, a2)), rMul(k6, rMul(a1, a3)));
  const c3 = rAdd(rMul(k2, rMul(a0, a3)), rMul(k2, rMul(a1, a2)));
  return [c0, c1, c2, c3];
}

function verifyKissing(doc, targetSpec, holderValue) {
  const allowed = new Set(["target", "kind", "dim", "radius_sq", "points"]);
  for (const k of Object.keys(doc)) {
    if (!allowed.has(k)) return rejected("schema_error", `unexpected field ${k}`, { holder_value: holderValue });
  }
  if (doc.kind !== "kissing" || doc.dim !== targetSpec.dim) {
    return rejected("schema_error", `kind must be kissing with dim=${targetSpec.dim}`, { holder_value: holderValue });
  }
  const rSq = parseRational(doc.radius_sq, "radius_sq");
  if (!rSq.ok || rSq.value.num <= 0n) {
    return rejected("schema_error", "radius_sq must be a positive exact rational", { holder_value: holderValue });
  }
  if (!Array.isArray(doc.points) || doc.points.length < 1 || doc.points.length > 2000) {
    return rejected("schema_error", "points must contain 1..2000 vectors", { holder_value: holderValue });
  }
  const dim = targetSpec.dim;
  const parsedPts = [];
  let lcmDen = rSq.value.den;
  for (let i = 0; i < doc.points.length; i += 1) {
    const pt = doc.points[i];
    if (!Array.isArray(pt) || pt.length !== dim) {
      return rejected("schema_error", `points[${i}] must have length ${dim}`, { holder_value: holderValue });
    }
    const coords = [];
    for (let k = 0; k < dim; k += 1) {
      const c = parseRational(pt[k], `points[${i}][${k}]`);
      if (!c.ok) return rejected("schema_error", c.error, { holder_value: holderValue });
      lcmDen = lcmBig(lcmDen, c.value.den);
      coords.push(c.value);
    }
    parsedPts.push(coords);
  }

  const rScaled = (rSq.value.num * lcmDen * lcmDen) / rSq.value.den;
  const intPts = parsedPts.map((pt) => pt.map((c) => c.num * (lcmDen / c.den)));

  for (let i = 0; i < intPts.length; i += 1) {
    let normSq = 0n;
    for (let k = 0; k < dim; k += 1) normSq += intPts[i][k] * intPts[i][k];
    if (normSq !== rScaled) {
      return rejected("wrong_answer", `point ${i} is not on sphere (|v|^2 mismatch)`, {
        metric_value: intPts.length,
        holder_value: holderValue,
      });
    }
  }
  for (let i = 0; i < intPts.length; i += 1) {
    for (let j = i + 1; j < intPts.length; j += 1) {
      let dot = 0n;
      for (let k = 0; k < dim; k += 1) dot += intPts[i][k] * intPts[j][k];
      if (2n * dot > rScaled) {
        return rejected("wrong_answer", `spheres ${i} and ${j} overlap (2*dot > R^2)`, {
          metric_value: intPts.length,
          holder_value: holderValue,
        });
      }
    }
  }
  const n = intPts.length;
  if (n <= holderValue) {
    return rejected("bound_not_improved", `sphere count ${n} does not beat holder ${holderValue}`, {
      metric_value: n,
      holder_value: holderValue,
    });
  }
  return {
    verdict: "ACCEPTED",
    reason_code: "",
    reason: `exact ${dim}D kissing configuration verified: ${n} > ${holderValue} spheres`,
    resolution: "improved",
    metric_value: n,
    holder_value: holderValue,
    proof_lines: n,
    wasm_bytes: 0,
    class_fuel: "{}",
  };
}

function greedyClique(adj, n) {
  let best = [];
  for (let start = 0; start < n; start += 1) {
    const clique = [start];
    for (const v of adj[start]) {
      if (clique.every((u) => adj[v].includes(u))) clique.push(v);
    }
    if (clique.length > best.length) best = clique;
  }
  return best;
}

/** Proves graph is NOT k-colorable using deterministic DSATUR backtracking with clique seeding. */
function proveNotKColorable(n, edges, k) {
  if (k <= 0) return { proven: n > 0 };
  if (k === 1) return { proven: edges.length > 0 };
  const adjSet = Array.from({ length: n }, () => new Set());
  for (const [u, v] of edges) {
    adjSet[u].add(v);
    adjSet[v].add(u);
  }
  const adj = adjSet.map((s) => [...s]);
  const clique = greedyClique(adj, n);
  if (clique.length > k) return { proven: true };

  const color = new Int8Array(n).fill(-1);
  for (let i = 0; i < clique.length; i += 1) {
    color[clique[i]] = i;
  }

  let nodes = 0;
  let aborted = false;

  function canColor(v, c) {
    for (const u of adj[v]) {
      if (color[u] === c) return false;
    }
    return true;
  }

  function pickNext() {
    let best = -1;
    let bestSat = -1;
    let bestDeg = -1;
    for (let v = 0; v < n; v += 1) {
      if (color[v] !== -1) continue;
      let mask = 0;
      for (const u of adj[v]) {
        if (color[u] !== -1) mask |= 1 << color[u];
      }
      // popcount of mask
      let sat = 0;
      let m = mask;
      while (m) {
        sat += m & 1;
        m >>= 1;
      }
      if (sat >= k) return v; // dead end immediately
      if (sat > bestSat || (sat === bestSat && adj[v].length > bestDeg)) {
        best = v;
        bestSat = sat;
        bestDeg = adj[v].length;
      }
    }
    return best;
  }

  function search(assigned) {
    if (aborted) return true;
    nodes += 1;
    if (nodes > MAX_BACKTRACK_NODES) {
      aborted = true;
      return true;
    }
    if (assigned === n) return true; // found valid k-coloring -> NOT proven
    const v = pickNext();
    if (v === -1) return true;
    for (let c = 0; c < k; c += 1) {
      if (!canColor(v, c)) continue;
      color[v] = c;
      if (search(assigned + 1)) return true;
      color[v] = -1;
    }
    return false;
  }

  const colorableOrAborted = search(clique.length);
  if (aborted) return { proven: false, error: "chromatic search exceeded node limit" };
  return { proven: !colorableOrAborted };
}

function verifyUnitDistance(doc, targetSpec, holderValue) {
  const allowed = new Set(["target", "kind", "mode", "claimed_chromatic", "vertices", "edges"]);
  for (const k of Object.keys(doc)) {
    if (!allowed.has(k)) return rejected("schema_error", `unexpected field ${k}`, { holder_value: holderValue });
  }
  if (doc.kind !== "unit_distance" || doc.mode !== targetSpec.mode) {
    return rejected("schema_error", `kind must be unit_distance with mode=${targetSpec.mode}`, { holder_value: holderValue });
  }
  const maxV = targetSpec.mode === "edges" ? (targetSpec.max_vertices ?? 20) : 400;
  if (!Array.isArray(doc.vertices) || doc.vertices.length < 2 || doc.vertices.length > maxV) {
    return rejected("schema_error", `vertices must contain 2..${maxV} points`, { holder_value: holderValue });
  }
  if (!Array.isArray(doc.edges) || doc.edges.length < 1 || doc.edges.length > 4000) {
    return rejected("schema_error", "edges must contain 1..4000 pairs", { holder_value: holderValue });
  }

  const pts = [];
  for (let i = 0; i < doc.vertices.length; i += 1) {
    const v = doc.vertices[i];
    if (!Array.isArray(v) || v.length !== 2) {
      return rejected("schema_error", `vertices[${i}] must be [x, y]`, { holder_value: holderValue });
    }
    const px = parseQuadScalar(v[0], `vertices[${i}][0]`);
    if (!px.ok) return rejected("schema_error", px.error, { holder_value: holderValue });
    const py = parseQuadScalar(v[1], `vertices[${i}][1]`);
    if (!py.ok) return rejected("schema_error", py.error, { holder_value: holderValue });
    pts.push([px.value, py.value]);
  }

  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      if (qIsZero(qSub(pts[i][0], pts[j][0])) && qIsZero(qSub(pts[i][1], pts[j][1]))) {
        return rejected("wrong_answer", `duplicate vertex at indices ${i} and ${j}`, { holder_value: holderValue });
      }
    }
  }

  const seenEdges = new Set();
  const parsedEdges = [];
  for (let eIdx = 0; eIdx < doc.edges.length; eIdx += 1) {
    const e = doc.edges[eIdx];
    if (!Array.isArray(e) || e.length !== 2 || !Number.isInteger(e[0]) || !Number.isInteger(e[1])) {
      return rejected("schema_error", `edges[${eIdx}] must be [u, v] integers`, { holder_value: holderValue });
    }
    const [u, v] = e;
    if (u < 0 || v < 0 || u >= pts.length || v >= pts.length || u >= v) {
      return rejected("schema_error", `edges[${eIdx}] must satisfy 0 <= u < v < vertices.length`, { holder_value: holderValue });
    }
    const key = `${u}:${v}`;
    if (seenEdges.has(key)) {
      return rejected("schema_error", `duplicate edge (${u}, ${v})`, { holder_value: holderValue });
    }
    seenEdges.add(key);
    const dx = qSub(pts[u][0], pts[v][0]);
    const dy = qSub(pts[u][1], pts[v][1]);
    const distSq = qAdd(qSquare(dx), qSquare(dy));
    const isUnit =
      rEq(distSq[0], { num: 1n, den: 1n }) &&
      distSq[1].num === 0n &&
      distSq[2].num === 0n &&
      distSq[3].num === 0n;
    if (!isUnit) {
      return rejected("wrong_answer", `edge (${u}, ${v}) does not have exact unit length 1`, {
        holder_value: holderValue,
      });
    }
    parsedEdges.push([u, v]);
  }

  if (doc.mode === "edges") {
    const metric = parsedEdges.length;
    if (metric <= holderValue) {
      return rejected("bound_not_improved", `unit edge count ${metric} does not beat holder ${holderValue}`, {
        metric_value: metric,
        holder_value: holderValue,
      });
    }
    return {
      verdict: "ACCEPTED",
      reason_code: "",
      reason: `exact ${pts.length}-vertex unit-distance graph verified: ${metric} > ${holderValue} edges`,
      resolution: "improved",
      metric_value: metric,
      holder_value: holderValue,
      proof_lines: parsedEdges.length,
      wasm_bytes: 0,
      class_fuel: "{}",
    };
  }

  const claimed = doc.claimed_chromatic;
  if (!Number.isInteger(claimed) || claimed < 2 || claimed > 7) {
    return rejected("schema_error", "claimed_chromatic must be an integer in 2..7", { holder_value: holderValue });
  }
  const res = proveNotKColorable(pts.length, parsedEdges, claimed - 1);
  if (!res.proven) {
    return rejected(
      "wrong_answer",
      res.error ?? `graph is ${claimed - 1}-colorable; chromatic number < ${claimed}`,
      { metric_value: claimed, holder_value: holderValue },
    );
  }
  if (claimed <= holderValue) {
    return rejected("bound_not_improved", `chromatic number ${claimed} does not beat holder ${holderValue}`, {
      metric_value: claimed,
      holder_value: holderValue,
    });
  }
  return {
    verdict: "ACCEPTED",
    reason_code: "",
    reason: `exact unit-distance graph (${pts.length}V, ${parsedEdges.length}E) proven >= ${claimed}-chromatic`,
    resolution: "improved",
    metric_value: claimed,
    holder_value: holderValue,
    proof_lines: pts.length,
    wasm_bytes: 0,
    class_fuel: "{}",
  };
}

export function extractMetric(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (doc.kind === "kissing" && Array.isArray(doc.points)) return doc.points.length;
  if (doc.kind === "unit_distance") {
    if (doc.mode === "edges" && Array.isArray(doc.edges)) return doc.edges.length;
    if (doc.mode === "chromatic" && Number.isInteger(doc.claimed_chromatic)) return doc.claimed_chromatic;
  }
  return null;
}

export function verifyCandidate(rawText, targetSpec, holderValue, maxBytes = DEFAULT_MAX_BYTES) {
  if (typeof rawText !== "string" || rawText.length === 0) {
    return rejected("schema_error", "submission file is empty", { holder_value: holderValue });
  }
  if (Buffer.byteLength(rawText, "utf8") > maxBytes) {
    return rejected("size_limit", `submission exceeds ${maxBytes} bytes`, { holder_value: holderValue });
  }
  let doc;
  try {
    doc = JSON.parse(rawText);
  } catch {
    return rejected("schema_error", "submission is not valid strict JSON", { holder_value: holderValue });
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || doc.target !== targetSpec.name) {
    return rejected("schema_error", "submission root or target does not match spec", { holder_value: holderValue });
  }
  if (targetSpec.kind_detail === "kissing") return verifyKissing(doc, targetSpec, holderValue);
  return verifyUnitDistance(doc, targetSpec, holderValue);
}

export function verifySelfCheck(manifestPath) {
  const absManifest = resolve(manifestPath);
  const rootDir = dirname(absManifest);
  const manifest = JSON.parse(readFileSync(absManifest, "utf8"));
  const maxBytes = manifest.max_bytes ?? DEFAULT_MAX_BYTES;
  const results = [];
  let allOk = true;
  for (const target of manifest.targets ?? []) {
    const raw = readFileSync(resolve(rootDir, target.file_path), "utf8");
    const res = verifyCandidate(raw, target, target.baseline_value - 1, maxBytes);
    if (res.verdict !== "ACCEPTED" || res.metric_value !== target.baseline_value) {
      allOk = false;
      results.push({ target: target.name, ok: false, reason_code: res.reason_code, reason: res.reason });
      continue;
    }
    results.push({ target: target.name, ok: true, metric_value: res.metric_value });
  }
  return { ok: allOk, checked: results.length, results };
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function main(argv) {
  if (argv[0] === "--self-check") {
    const res = verifySelfCheck(argv[1] ?? "targets.json");
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
  if (argv[0] === "--score") {
    const doc = JSON.parse(readFileSync(argv[1], "utf8"));
    const m = extractMetric(doc);
    if (m === null) process.exit(1);
    console.log(m);
    process.exit(0);
  }
  if (argv[0] === "verify") {
    const flags = parseFlags(argv.slice(1));
    const manifest = JSON.parse(readFileSync(flags.targets ?? "targets.json", "utf8"));
    const targetSpec = (manifest.targets ?? []).find((t) => t.name === flags.target);
    if (!targetSpec) {
      const err = rejected("schema_error", "unknown target");
      if (flags.out) writeFileSync(flags.out, `${JSON.stringify(err)}\n`);
      console.log(JSON.stringify(err));
      process.exit(0);
    }
    let holderVal = targetSpec.baseline_value;
    if (flags.holder) {
      try {
        const m = extractMetric(JSON.parse(readFileSync(flags.holder, "utf8")));
        if (m !== null) holderVal = m;
      } catch {
        // fallback to baseline_value
      }
    }
    const rawCandidate = readFileSync(flags.candidate, "utf8");
    const verdict = verifyCandidate(rawCandidate, targetSpec, holderVal, manifest.max_bytes ?? DEFAULT_MAX_BYTES);
    if (flags.out) writeFileSync(flags.out, `${JSON.stringify(verdict)}\n`);
    console.log(JSON.stringify(verdict));
    process.exit(0);
  }
  console.error("usage: verify.mjs --self-check [targets.json] | --score <file> | verify --targets <targets.json> --target <name> --candidate <file>");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
