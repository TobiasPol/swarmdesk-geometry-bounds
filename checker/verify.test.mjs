import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCandidate, verifySelfCheck } from "./verify.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("all 8 geometry baseline files verify cleanly", () => {
  const res = verifySelfCheck(resolve(ROOT, "targets.json"));
  assert.equal(res.ok, true);
  assert.equal(res.checked, 8);
});

test("D5 kissing lattice (40 spheres in 5D) beats baseline 10", () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "targets.json"), "utf8"));
  const spec = manifest.targets.find((t) => t.name === "kissing_5d");
  const pts = [];
  for (let i = 0; i < 5; i += 1) {
    for (let j = i + 1; j < 5; j += 1) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const v = [0, 0, 0, 0, 0];
          v[i] = si;
          v[j] = sj;
          pts.push(v);
        }
      }
    }
  }
  assert.equal(pts.length, 40);
  const doc = { target: "kissing_5d", kind: "kissing", dim: 5, radius_sq: 2, points: pts };
  const verdict = verifyCandidate(JSON.stringify(doc), spec, spec.baseline_value);
  assert.equal(verdict.verdict, "ACCEPTED");
  assert.equal(verdict.metric_value, 40);
});

test("overlapping kissing spheres are rejected with wrong_answer", () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "targets.json"), "utf8"));
  const spec = manifest.targets.find((t) => t.name === "kissing_5d");
  const badPts = [
    [3, 4, 0, 0, 0],
    [4, 3, 0, 0, 0], // dot=24, 2*dot=48 > R^2=25
  ];
  const doc = { target: "kissing_5d", kind: "kissing", dim: 5, radius_sq: 25, points: badPts };
  const verdict = verifyCandidate(JSON.stringify(doc), spec, 1);
  assert.equal(verdict.verdict, "REJECTED");
  assert.equal(verdict.reason_code, "wrong_answer");
});

test("exact Moser spindle over Q(sqrt(3), sqrt(11)) verifies chromatic bound 4 > 3", () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "targets.json"), "utf8"));
  const spec = manifest.targets.find((t) => t.name === "hadwiger_nelson_plane");
  // Rhombus 1 rotated around origin so top vertex hits dist=1 from rotated top:
  // v0 = (0,0)
  // Rhombus A edges angle alpha = 0 and pi/3: u1=(1,0), u2=(1/2, sqrt(3)/2), u3=(3/2, sqrt(3)/2)
  // Wait: Moser spindle rotates whole rhombus by cos(theta)=5/6, sin(theta)=sqrt(11)/6 so u3 -> dist 1!
  // Check: |u3|^2 = (sqrt(3))^2 = 3; rotation by theta where |R(theta) u3 - u3|^2 = 1 => 2*3*(1 - cos theta)=1 => cos theta = 5/6!
  // Let's compute exact R(theta)(a, b) = (a*5/6 - b*sqrt(11)/6, a*sqrt(11)/6 + b*5/6):
  const rot = (x0, x1, y0, y1) => [
    [`${x0 * 5}/6`.replace(/^-?0\/6$/, "0"), `${x1 * 5}/6`, `-${y0}/6`, `-${y1}/6`], // wait scalar*frac cleanly in BigInt!
  ];
  // Easier: exact rational helper in test!
  const mulQ = (a, b) => {
    const num = a[0] * b[0];
    const den = a[1] * b[1];
    const g = (x, y) => (y === 0n ? x : g(y, x % y));
    const d = g(num < 0n ? -num : num, den);
    const n = num / d;
    const dd = den / d;
    return dd === 1n ? Number(n) : `${n}/${dd}`;
  };
  // Rhombus A: (0,0), A=(1,0), B=(1/2, sqrt(3)/2), C=(3/2, sqrt(3)/2)
  // Rotated Rhombus A': R(theta) where cos(theta)=5/6, sin(theta)=sqrt(11)/6:
  // R([x0, x1*sqrt3], [y0, y1*sqrt3]) =
  //   rx = [5/6*x0, 5/6*x1, -1/6*y0, -1/6*y1]
  //   ry = [5/6*y0, 5/6*y1,  1/6*x0,  1/6*x1]
  const qRot = (x0, x1, y0, y1) => [
    [mulQ(x0, [5n, 6n]), mulQ(x1, [5n, 6n]), mulQ([-y0[0], y0[1]], [1n, 6n]), mulQ([-y1[0], y1[1]], [1n, 6n])],
    [mulQ(y0, [5n, 6n]), mulQ(y1, [5n, 6n]), mulQ(x0, [1n, 6n]), mulQ(x1, [1n, 6n])],
  ];
  const moser = {
    target: "hadwiger_nelson_plane",
    kind: "unit_distance",
    mode: "chromatic",
    claimed_chromatic: 4,
    vertices: [
      [0, 0], // 0: shared apex
      [1, 0], // 1: A
      ["1/2", [0, "1/2", 0, 0]], // 2: B
      ["3/2", [0, "1/2", 0, 0]], // 3: C (|C|^2 = 9/4 + 3/4 = 3)
      qRot([1n, 1n], [0n, 1n], [0n, 1n], [0n, 1n]), // 4: A'
      qRot([1n, 2n], [0n, 1n], [0n, 1n], [1n, 2n]), // 5: B'
      qRot([3n, 2n], [0n, 1n], [0n, 1n], [1n, 2n]), // 6: C'
    ],
    edges: [
      [0, 1], [0, 2], [1, 2], [1, 3], [2, 3], // rhombus 1
      [0, 4], [0, 5], [4, 5], [4, 6], [5, 6], // rhombus 2
      [3, 6], // apex bridge C-C' of exact length 1!
    ],
  };
  const verdict = verifyCandidate(JSON.stringify(moser), spec, spec.baseline_value);
  assert.equal(verdict.verdict, "ACCEPTED", verdict.reason);
  assert.equal(verdict.metric_value, 4);
});

test("false chromatic claim on K3 (claiming 4) is rejected", () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "targets.json"), "utf8"));
  const spec = manifest.targets.find((t) => t.name === "hadwiger_nelson_plane");
  const fake = {
    target: "hadwiger_nelson_plane",
    kind: "unit_distance",
    mode: "chromatic",
    claimed_chromatic: 4,
    vertices: [
      [0, 0],
      [1, 0],
      ["1/2", [0, "1/2", 0, 0]],
    ],
    edges: [[0, 1], [0, 2], [1, 2]],
  };
  const verdict = verifyCandidate(JSON.stringify(fake), spec, 2);
  assert.equal(verdict.verdict, "REJECTED");
  assert.equal(verdict.reason_code, "wrong_answer");
});
