// Original EUC-friendly interpretation of Thomas Jefferson Park's real street skatepark.
// Reference: Patch's 2017 opening photographs (see docs/SKATEPARK_SURVEY.md for site/QA evidence).
// The researched pin stays fixed; this contained court fits the existing clear paving inland of it.
// Drawing and support use the city's shared batched primitives, never traffic footprints or route changes.
export const JEFFERSON_SKATEPARK = {
  x: 1330, z: -5823, halfWidth: 16, north: -31, south: 15, ground: 0.22, top: 0.24,
  arrival: { x: 1330, z: -5811, y: 0.24, heading: -2.9 }
};

export function buildJeffersonSkatepark(F, { ground: GR, paint: PA }, profile, fence) {
  const { halfWidth: w, north, south, ground, top: y } = JEFFERSON_SKATEPARK;
  // Two-centimetre finish over existing flat paving; no raised curb or hidden planting beneath the court.
  F.top(GR, -w, w, ground, y, north, south, 9);
  // Inset concrete border, leaving broad openings on all four sides. Paint is visual-only on the same floor.
  for (const s of [north + 0.45, south - 0.45]) for (const [a, b] of [[-w + 0.45, -3], [3, w - 0.45]]) {
    F.box(PA, a, b, y, y + 0.003, s - 0.035, s + 0.035, 4);
  }
  for (const u of [-w + 0.45, w - 0.45]) F.box(PA, u - 0.035, u + 0.035, y, y + 0.003, north + 0.45, south - 0.45, 4);

  // New northern bay: a lower banked manual platform and two smooth rollers, with open run-ups and a flat spine.
  profile(F, -12, -4.5, [[-28, y], [-25.5, y + 0.4], [-23, y + 0.4], [-20.5, y]], y);
  for (const [start, height] of [[-28, 0.28], [-20, 0.4]]) {
    const points = [];
    for (let i = 0; i <= 20; i++) points.push([start + 6 * i / 20, y + height * (1 - Math.cos(i / 20 * Math.PI * 2)) / 2]);
    profile(F, 5, 12.5, points, y, true);
  }

  // West line: broad double bank / platform with a low return transition at the north end.
  profile(F, -12, -4.5, [[-4, y], [-1.5, y + 0.6], [1, y + 0.6], [3.5, y]], y);
  const curve = [], radius = 2.2;
  for (let i = 0; i <= 16; i++) {
    const angle = (1 - i / 16) * Math.PI / 3;
    curve.push([-9 - radius * Math.sin(angle), y + radius * (1 - Math.cos(angle))]);
  }
  const lip = curve[0];
  profile(F, -12, -4.5, curve, y, true);
  F.top(GR, -12, -4.5, y, lip[1], -13.2, lip[0], 10);
  F.body(-12, -4.5, y, lip[1], -13.2, lip[0]);
  F.top(GR, -12, -4.5, lip[1] - 0.02, lip[1] + 0.005, lip[0] - 0.10, lip[0] - 0.02, 8);

  // East line: bank up to a platform, four shallow steps down, with a separate smooth bypass beside them.
  profile(F, 5, 12.5, [[-8.5, y], [-5.5, y + 0.6], [-2, y + 0.6]], y);
  for (let i = 0; i < 4; i++) {
    const s = -2 + i * 0.65, h = 0.6 - i * 0.15;
    // One top surface: a complete painted box beneath a concrete cap caused coplanar depth fighting.
    profile(F, 5, 9, [[s, y + h], [s + 0.65, y + h]], y);
  }
  profile(F, 9, 12.5, [[-2, y + 0.6], [1, y]], y);
  // Platform handrail follows the bank; both top support and compact sloping side bodies follow its drawing.
  F.strut(PA, [12.25, y + 0.48, -8.5], [12.25, y + 1.08, -5.5], 0.08, 9, 0.08, 'pavement', true, false, true);
  F.strut(PA, [12.25, y + 1.08, -5.5], [12.25, y + 1.08, -2], 0.08, 9, 0.08, 'pavement', true, false, true);
  for (const [s, h] of [[-8.2, 0.54], [-5.5, 1.08], [-2.2, 1.08]]) {
    F.solid(PA, 12.21, 12.29, y, y + h, s - 0.04, s + 0.04, 9);
  }

  // Two skate benches and a flat rail, each with clear approach/landing space; centre u=-3..3 stays open.
  for (const [u0, u1, s0, s1, h] of [[-12.5, -6.5, 8, 9.4, 0.3], [5.5, 11.5, 10, 11.4, 0.4]]) {
    profile(F, u0, u1, [[s0, y + h], [s1, y + h]], y);
    for (const s of [s0, s1]) F.solid(PA, u0, u1, y + h - 0.025, y + h + 0.008, s - 0.025, s + 0.025, 9);
  }
  F.strut(PA, [6, y + 0.42, 4], [6, y + 0.42, 8], 0.09, 9, 0.09, 'pavement', true, false, true);
  for (const s of [4.3, 7.7]) F.solid(PA, 5.955, 6.045, y, y + 0.42, s - 0.045, s + 0.045, 9);
  // Low manual pad uses the former empty east-side pocket without closing the rail's approaches.
  profile(F, 10, 13.5, [[4.5, y + 0.16], [7.5, y + 0.16]], y);

  // The real park has a four-foot separating fence. A short west-side run frames this interpretation;
  // both ends remain open, away from the preserved walking and traffic corridors.
  fence(F, -10.5, 10.5, -15, y, 1.22, false);
  F.body(-15.02, -14.98, y, y + 1.22, -10.5, 10.5);
  for (const s of [-10.5, -7, -3.5, 0, 3.5, 7, 10.5]) F.solid(PA, -15.04, -14.96, y, y + 1.26, s - 0.04, s + 0.04, 9);
  F.solid(PA, -15.04, -14.96, y + 1.18, y + 1.26, -10.5, 10.5, 9);
}
