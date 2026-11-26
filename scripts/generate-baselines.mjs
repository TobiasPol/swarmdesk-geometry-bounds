#!/usr/bin/env node
// Generates exact baseline JSON witnesses and targets.json for geometry-bounds.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function crossPolytope(dim) {
  const pts = [];
  for (let i = 0; i < dim; i += 1) {
    const pos = Array(dim).fill(0);
    const neg = Array(dim).fill(0);
    pos[i] = 1;
    neg[i] = -1;
    pts.push(pos, neg);
  }
  return pts;
}

function triangularStrip20() {
  // 20 vertices in a 4x5 hexagonal grid chunk over Q(sqrt(3))
  const coords = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const halfShift = r % 2 === 1 ? "1/2" : 0;
      const x = halfShift === 0 ? c : `${2 * c + 1}/2`;
      const y = r === 0 ? 0 : [0, r % 2 === 0 ? r / 2 : `${r}/2`, 0, 0];
      coords.push([x, y, r, c]);
    }
  }
  // Exact unit edges on the triangular lattice:
  // horizontal (r, c)-(r, c+1)
  // down-left / down-right along hex neighbors
  const idx = (r, c) => r * 5 + c;
  const edges = [];
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      if (c + 1 < 5) edges.push([idx(r, c), idx(r, c + 1)]);
      if (r + 1 < 4) {
        edges.push([idx(r, c), idx(r + 1, c)]);
        if (r % 2 === 0 && c - 1 >= 0) edges.push([idx(r, c), idx(r + 1, c - 1)]);
        if (r % 2 === 1 && c + 1 < 5) edges.push([idx(r, c), idx(r + 1, c + 1)]);
      }
    }
  }
  const cleanEdges = edges
    .map(([u, v]) => (u < v ? [u, v] : [v, u]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    vertices: coords.map(([x, y]) => [x, y]),
    edges: cleanEdges,
  };
}

export function generateAll() {
  mkdirSync(resolve(ROOT, "targets"), { recursive: true });

  const kissingDims = [
    { d: 5, sota: 40, summary: "Pack as many non-overlapping unit spheres tangent to a central unit sphere in R^5 as possible (SOTA lower bound: 40)." },
    { d: 6, sota: 72, summary: "Pack unit spheres kissing a central unit sphere in R^6 (E6 root system achieves 72)." },
    { d: 7, sota: 126, summary: "Pack unit spheres kissing a central unit sphere in R^7 (E7 root system achieves 126)." },
    { d: 9, sota: 306, summary: "Frontier kissing number search in R^9 (current world lower bound: 306)." },
    { d: 10, sota: 510, summary: "Frontier kissing number search in R^10 (current world lower bound: 510)." },
    { d: 11, sota: 604, summary: "Frontier kissing number search in R^11 (world record 604; AlphaEvolve reached 593)." },
  ];

  const manifestTargets = [];

  for (const spec of kissingDims) {
    const name = `kissing_${spec.d}d`;
    const points = crossPolytope(spec.d);
    const doc = {
      target: name,
      kind: "kissing",
      dim: spec.d,
      radius_sq: 1,
      points,
    };
    const filePath = `targets/${name}.json`;
    writeFileSync(resolve(ROOT, filePath), `${JSON.stringify(doc, null, 2)}\n`);
    manifestTargets.push({
      name,
      title: `Kissing Number in ${spec.d}D`,
      summary: spec.summary,
      file_path: filePath,
      kind: "bound",
      kind_detail: "kissing",
      dim: spec.d,
      direction: "maximize",
      baseline_value: points.length,
      sota_value: spec.sota,
      metric_unit: "spheres",
      domain: "Discrete geometry",
      source_url: "https://en.wikipedia.org/wiki/Kissing_number",
      approach: `Submit exact rational points on a sphere |v|^2 = radius_sq in R^${spec.d} with 2*dot(u,v) <= radius_sq to maximize sphere count.`,
    });
  }

  // Hadwiger-Nelson plane chromatic lower bound baseline: K3 equilateral triangle
  const hnBaseline = {
    target: "hadwiger_nelson_plane",
    kind: "unit_distance",
    mode: "chromatic",
    claimed_chromatic: 3,
    vertices: [
      [0, 0],
      [1, 0],
      ["1/2", [0, "1/2", 0, 0]],
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 2],
    ],
  };
  writeFileSync(resolve(ROOT, "targets/hadwiger_nelson_plane.json"), `${JSON.stringify(hnBaseline, null, 2)}\n`);
  manifestTargets.push({
    name: "hadwiger_nelson_plane",
    title: "Hadwiger-Nelson Chromatic Bound",
    summary: "Construct finite unit-distance graphs in Q(sqrt(3), sqrt(11)) with higher proven chromatic number (Moser=4, de Grey=5, open=6).",
    file_path: "targets/hadwiger_nelson_plane.json",
    kind: "bound",
    kind_detail: "unit_distance",
    mode: "chromatic",
    direction: "maximize",
    baseline_value: 3,
    sota_value: 5,
    metric_unit: "colors",
    domain: "Combinatorial geometry",
    source_url: "https://arxiv.org/abs/1804.02385",
    approach: "Construct an exact unit-distance graph over Q(sqrt(3), sqrt(11)) verified non-(k-1)-colorable by exact DSATUR.",
  });

  // Erdos 20-vertex unit-distance edge maximization baseline
  const strip = triangularStrip20();
  const edgeDoc = {
    target: "unit_dist_edges_20",
    kind: "unit_distance",
    mode: "edges",
    vertices: strip.vertices,
    edges: strip.edges,
  };
  writeFileSync(resolve(ROOT, "targets/unit_dist_edges_20.json"), `${JSON.stringify(edgeDoc, null, 2)}\n`);
  manifestTargets.push({
    name: "unit_dist_edges_20",
    title: "Unit-Distance Graph Edges (n <= 20)",
    summary: "Maximize exact unit-distance edges among at most 20 distinct planar points in Q(sqrt(3), sqrt(11)) (Erdos unit-distance problem; max=46).",
    file_path: "targets/unit_dist_edges_20.json",
    kind: "bound",
    kind_detail: "unit_distance",
    mode: "edges",
    max_vertices: 20,
    direction: "maximize",
    baseline_value: strip.edges.length,
    sota_value: 46,
    metric_unit: "edges",
    domain: "Extremal geometry",
    source_url: "https://erdosproblems.com/",
    approach: "Pack up to 20 planar points over Q(sqrt(3), sqrt(11)) maximizing exact unit-length pairs |u - v|^2 = 1.",
  });

  const manifest = {
    problem: "geometry-bounds",
    max_bytes: 1048576,
    targets: manifestTargets,
  };
  writeFileSync(resolve(ROOT, "targets.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestTargets;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = generateAll();
  console.log(`Generated ${list.length} exact geometry targets.`);
}
