// Headless: the vendored EUC controller riding New York's real street layout through js/euc-terrain.js.
// No browser, no three.js. Buildings here are synthetic boxes (the real colliders are built by three.js scene code);
// the curbs, parks and shore are the city's own (city-config.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EucController, createPose } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';
import { SIMULATION } from '../js/euc/data/tuning.js';
import { PlanTerrainSampler } from '../js/euc/simulation/planSampler.js';
import { NycTerrainSampler, boxesFromCityColliders } from '../js/euc-terrain.js';
import {
  blockAt, streetZ, ISLAND_BOUNDS, WATER_RIDE, getIslandBoundsAtZ, ESPLANADE_RAIL, BATTERY_RAIL, NORTH_BARRIER, CUT_Z,
  MANHATTAN_COASTLINE, SEAWALL_POLYGON, pointInPoly
} from '../js/city-config.js';

const DT = 1 / SIMULATION.hz;
const SPAWN_Z = streetZ(37); // controllers.js: 5th Ave at 37th St
const ROAD = { x: 5.2, z: SPAWN_Z - 8 }; // the cyclist's spawn, on the 5th Ave roadway

function ride(euc, seconds, actions) {
  for (let i = 0, n = Math.round(seconds * SIMULATION.hz); i < n; i++) euc.step(DT, actions);
  return euc.snapshot();
}

/** First x east of `x0` (on z) where the curb island begins. */
function curbEastOf(x0, z) {
  for (let x = x0; x < x0 + 60; x += 0.01) if (blockAt(x, z)) return x;
  throw new Error('no curb found');
}

test('the spawn is on the roadway, and the curb beside it is the city\'s sidewalk height', () => {
  const s = new NycTerrainSampler();
  const g = s.sampleGround(ROAD.x, ROAD.z, { height: NaN, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: true });
  assert.equal(g.height, 0);
  assert.equal(g.offCourse, false);
  const curb = curbEastOf(ROAD.x, ROAD.z);
  assert.equal(s.sampleGround(curb + 0.5, ROAD.z, g).height, ISLAND_BOUNDS.sidewalkHeight);
});

test('a drawn road cut replaces only the block base, retaining higher supports and bodies', () => {
  const x = -1455, z = 2250;
  const poly = [{ x: x - 2, z: z - 2 }, { x: x + 2, z: z - 2 }, { x: x + 2, z: z + 2 }, { x: x - 2, z: z + 2 }];
  const road = { poly, minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, top: 0, surface: 'pavement', replacesBlock: true };
  assert.equal(new NycTerrainSampler().sampleGround(x, z, probe()).height, .22);
  const s = new NycTerrainSampler({ tops: [road] });
  assert.equal(s.sampleGround(x, z, probe()).height, 0);
  assert.equal(s.sampleGround(x, z, probe()).surface, 'pavement');
  assert.equal(s.sampleGround(x + 3, z, probe()).height, .22, 'the rest of the kerb stays raised');
  const raised = { ...road, replacesBlock: false, top: .4, surface: 'brick' };
  assert.equal(new NycTerrainSampler({ tops: [road, raised] }).sampleGround(x, z, probe()).height, .4);
  const box = { centre: { x, y: .4, z }, halfExtents: { x: .5, y: .4, z: .5 }, rotationY: 0, surface: 'stone' };
  assert.equal(new NycTerrainSampler({ tops: [road], boxes: [box] }).sampleGround(x, z, probe()).height, .8);
});

test('throttle rides south down 5th Ave (+Z) on the road without crashing', () => {
  const euc = new EucController(new NycTerrainSampler(), { spawn: { position: { x: ROAD.x, y: 0, z: ROAD.z }, headingY: 0 } });
  const snap = ride(euc, 4, { ...NEUTRAL_ACTIONS, throttle: 1 });
  assert.ok(snap.speed > 5, `speed ${snap.speed}`);
  assert.ok(snap.position.z > ROAD.z + 10, `z ${snap.position.z}`);
  assert.ok(Math.abs(snap.position.x - ROAD.x) < 1e-6);
  assert.equal(euc.crashed, false);
  const pose = createPose();
  euc.writePose(pose);
  assert.ok(Math.abs(pose.y) < 0.05, `y ${pose.y}`);
});

// Manhattan's curbs are 0.22 m (city-config.js). The stock wheel climbs 1.35 x pedal height = 0.216 m: just short.
function curbApproach(tuning) {
  const z = ROAD.z;
  const curb = curbEastOf(ROAD.x, z);
  const euc = new EucController(new NycTerrainSampler(), {
    spawn: { position: { x: curb - 6, y: 0, z }, headingY: Math.PI / 2 }, // +X: straight at the east curb
    tuning,
  });
  const snap = ride(euc, 3, { ...NEUTRAL_ACTIONS, throttle: 0.5 });
  return { curb, snap, euc };
}

test('stock tuning: an unhopped 0.22 m Manhattan curb stops the wheel at its face', () => {
  const { curb, snap } = curbApproach(undefined);
  assert.ok(snap.position.x < curb + 0.05, `x ${snap.position.x} vs curb ${curb}`);
  assert.ok(snap.position.y < 0.05);
});

// Not the game's tuning (the owner chose stock tuning: kerbs must be hopped). Kept to document the 0.22 m margin.
test('maxStepUp 0.24 (not used): the same curb would be mounted unhopped', () => {
  const { curb, snap, euc } = curbApproach({ maxStepUp: 0.24 });
  assert.ok(snap.position.x > curb + 0.5, `x ${snap.position.x} vs curb ${curb}`);
  assert.ok(Math.abs(snap.position.y - ISLAND_BOUNDS.sidewalkHeight) < 0.03, `y ${snap.position.y}`);
  assert.equal(euc.crashed, false);
});

test('stock tuning: a hop clears the curb', () => {
  const z = ROAD.z;
  const curb = curbEastOf(ROAD.x, z);
  const euc = new EucController(new NycTerrainSampler(), { spawn: { position: { x: curb - 12, y: 0, z }, headingY: Math.PI / 2 } });
  const go = { ...NEUTRAL_ACTIONS, throttle: 0.6 };
  let hopped = false;
  for (let i = 0; i < 4 * SIMULATION.hz; i++) {
    const s = euc.snapshot();
    const hop = !hopped && s.position.x > curb - 1.6 && euc.canAcceptHop;
    if (hop) hopped = true;
    euc.step(DT, hop ? { ...go, hop: true, hopHeld: true } : go);
  }
  const snap = euc.snapshot();
  assert.ok(hopped, 'the hop was accepted');
  assert.ok(snap.position.x > curb + 0.5, `x ${snap.position.x} vs curb ${curb}`);
  assert.ok(Math.abs(snap.position.y - ISLAND_BOUNDS.sidewalkHeight) < 0.03, `y ${snap.position.y}`);
});

test('a building collider (OBB) is a wall: the wheel does not pass through it', () => {
  const z = ROAD.z + 20;
  // A 10 m box across the roadway, rotated 20 degrees, in controllers.js collider format
  const cs = Math.cos(0.35), sn = Math.sin(0.35);
  const obb = { cx: ROAD.x, cz: z, hx: 6, hz: 3, cs, sn };
  const boxes = boxesFromCityColliders([{ minX: ROAD.x - 8, maxX: ROAD.x + 8, minZ: z - 8, maxZ: z + 8, maxY: 40, obb }]);
  const sampler = new NycTerrainSampler({ boxes });
  const euc = new EucController(sampler, { spawn: { position: { x: ROAD.x, y: 0, z: ROAD.z }, headingY: 0 } });
  const snap = ride(euc, 6, { ...NEUTRAL_ACTIONS, throttle: 1 });
  // Local frame of the box (same transform as controllers.js)
  const dx = snap.position.x - obb.cx, dz = snap.position.z - obb.cz;
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  assert.ok(!(Math.abs(lx) < obb.hx && Math.abs(lz) < obb.hz), `inside the box at local (${lx}, ${lz})`);
  assert.ok(snap.position.z < z, `z ${snap.position.z}`);
});

test('a drawn lamp post is solid to the wheel and does not occlude the camera ray', () => {
  const z = ROAD.z + 15;
  const post = { centre: { x: ROAD.x, y: 3.3, z }, halfExtents: { x: 0.14, y: 3.2, z: 0.14 }, rotationY: 0, surface: 'pavement', occludes: false };
  const sampler = new NycTerrainSampler({ boxes: [post] });
  const origin = { x: ROAD.x, y: 0.5, z: ROAD.z };
  assert.ok(sampler.raycastObstacle(origin, { x: 0, y: 0, z: 1 }, 30) !== null);
  assert.equal(sampler.raycast({ ...origin, y: 1.5 }, { x: 0, y: 0, z: 1 }, 30), null);
  const euc = new EucController(sampler, { spawn: { position: { x: ROAD.x, y: 0, z: ROAD.z }, headingY: 0 } });
  const snap = ride(euc, 5, { ...NEUTRAL_ACTIONS, throttle: 1 });
  assert.ok(snap.position.z < z - post.halfExtents.z, `z ${snap.position.z}`);
});

test('mesh facets select the highest actual height, carry their slope normal, and leave their bounding corners open', () => {
  const z = ROAD.z;
  const poly = [{ x: 0, z }, { x: 10, z }, { x: 0, z: z + 10 }];
  const ramp = { poly, top: 2, surface: 'stone', minX: 0, maxX: 10, minZ: z, maxZ: z + 10,
    plane: { x: 0, y: 0, z, dx: 0.2, dz: 0 } };
  const flat = { poly, top: 0.6, surface: 'brick', minX: 0, maxX: 10, minZ: z, maxZ: z + 10 };
  for (const tops of [[ramp, flat], [flat, ramp]]) {
    const s = new NycTerrainSampler({ tops });
    assert.equal(s.sampleGround(1, z + 1, probe()).height, 0.6, 'flat is above the low end, regardless of registration order');
    const g = s.sampleGround(6, z + 1, probe());
    assert.ok(Math.abs(g.height - 1.2) < 1e-9);
    assert.ok(Math.abs(g.normal.x / g.normal.y + 0.2) < 1e-9);
    assert.ok(Math.abs(Math.hypot(g.normal.x, g.normal.y, g.normal.z) - 1) < 1e-9);
    assert.equal(s.sampleGround(8, z + 8, probe()).height, 0, 'the triangle does not fill its rectangular bounds');
    const withBase = { ...probe(), base: { height: NaN, normal: { x: 0, y: 1, z: 0 } } };
    s.sampleGround(6, z + 1, withBase);
    assert.equal(withBase.base.height, g.height, 'ragdoll limbs get the same slope height');
    assert.deepEqual(withBase.base.normal, g.normal);
  }
});

test('the controller climbs a mesh-derived slope, rather than meeting its maximum height as a wall', () => {
  const z = ROAD.z;
  const slope = { poly: [{ x: 0, z: z - 3 }, { x: 20, z: z - 3 }, { x: 20, z: z + 3 }, { x: 0, z: z + 3 }],
    top: 2, surface: 'stone', minX: 0, maxX: 20, minZ: z - 3, maxZ: z + 3,
    plane: { x: 0, y: 0, z, dx: 0.1, dz: 0 } };
  const euc = new EucController(new NycTerrainSampler({ tops: [slope] }), {
    spawn: { position: { x: 0.1, y: 0.01, z }, headingY: Math.PI / 2 }
  });
  const snap = ride(euc, 2, { ...NEUTRAL_ACTIONS, throttle: 0.5 });
  assert.equal(euc.crashed, false);
  assert.ok(snap.position.x > 2, `climbed to x ${snap.position.x}`);
  assert.ok(Math.abs(snap.position.y - snap.position.x * 0.1) < 0.05);
});

test('a low fountain rim can protect water without an invisible high pond band', () => {
  const z = ROAD.z;
  const water = { poly: [{ x: 0, z }, { x: 10, z }, { x: 10, z: z + 10 }, { x: 0, z: z + 10 }],
    top: 0.56, surface: 'stone', minX: 0, maxX: 10, minZ: z, maxZ: z + 10,
    water: { level: 0.56, floor: 0.44, band: 0 } };
  const s = new NycTerrainSampler({ tops: [water] });
  assert.equal(s.sampleGround(0.05, z + 5, probe()).height, 0.44, 'floor even just inside the rim');
  assert.equal(s.isWater(0.05, z + 5), true, 'not a get-up site');
  assert.equal(s.sampleGround(5, z + 5, probe()).height, 0.44);
});

test('water cuts the underlying lawn but does not swallow exposed rock facets or allow get-up on submerged ones', () => {
  const z = ROAD.z;
  const poly = [{ x: 0, z }, { x: 10, z }, { x: 10, z: z + 10 }, { x: 0, z: z + 10 }];
  const bounds = { poly, minX: 0, maxX: 10, minZ: z, maxZ: z + 10 };
  const lawn = { ...bounds, top: 1.19, surface: 'grass' };
  const pond = { ...bounds, top: 2.24, surface: 'stone', water: { level: 1.24, floor: 1.12 } };
  const rock = { ...bounds, top: 2, surface: 'stone', plane: { x: 0, y: 1, z, dx: 0.1, dz: 0 } };
  for (const tops of [[lawn, pond, rock], [rock, pond, lawn]]) {
    const s = new NycTerrainSampler({ tops });
    assert.equal(s.sampleGround(2, z + 5, probe()).height, 1.12, 'submerged rock remains below water');
    assert.equal(s.isWater(2, z + 5), true);
    assert.equal(s.sampleGround(6, z + 5, probe()).height, 1.6, 'exposed rock remains above water');
    assert.equal(s.isWater(6, z + 5), false);
    assert.equal(s.sampleGround(0.1, z + 5, probe()).height, 2.24, 'the protective pond shore band remains');
  }
});

test('the finer city index preserves native casts, swept/inside hits and ragdoll records across cell boundaries', () => {
  const boxes = [
    { centre: { x: 8, y: 1, z: ROAD.z }, halfExtents: { x: 0.2, y: 1, z: 0.3 }, rotationY: 0.4, surface: 'wood', occludes: false },
    { centre: { x: 25, y: 4, z: ROAD.z + 1 }, halfExtents: { x: 10, y: 4, z: 2 }, rotationY: 0.2, surface: 'stone' },
    { centre: { x: 10000, y: 1, z: ROAD.z + 10000 }, halfExtents: { x: 1, y: 1, z: 1 }, rotationY: 0, surface: 'stone' }
  ];
  const s = new NycTerrainSampler({ boxes });
  const city = s.boxes, native = new PlanTerrainSampler(s.plan);
  assert.equal(city.gridCell, 8);
  assert.ok(native.gridCell > 30, 'fixture covers city-scale bounds');
  for (const x of [0, 7.7, 8, 8.3, 14, 20, 36, 10000]) {
    const z = x === 10000 ? ROAD.z + 10000 : ROAD.z;
    assert.deepEqual(city.sampleGround(x, z, probe()), native.sampleGround(x, z, probe()));
    for (const direction of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0.03, z: 0.01 }, { x: 0, y: -1, z: 0 }]) {
      const origin = { x, y: 0.5, z };
      const hit = () => ({ distance: 0, halfExtentX: 0, halfExtentZ: 0, inside: false, colliderIndex: -1, normal: { x: 0, y: 0, z: 0 } });
      const limb = () => ({ minX: x - 10, maxX: x + 10, minY: 0, maxY: 5, minZ: z - 5, maxZ: z + 5,
        records: new Float64Array(8 * 9), recordOffset: 0, capacity: 8, count: 0 });
      const ch = hit(), nh = hit(), cl = limb(), nl = limb();
      assert.equal(city.raycastObstacle(origin, direction, 50, 0.3, undefined, ch, undefined, cl), native.raycastObstacle(origin, direction, 50, 0.3, undefined, nh, undefined, nl));
      assert.deepEqual(ch, nh);
      const records = (l) => Array.from({ length: l.count }, (_, i) => Array.from(l.records.slice(i * 9, i * 9 + 9))).sort((a, b) => a[0] - b[0]);
      assert.deepEqual(records(cl), records(nl));
      assert.equal(cl.overflow, nl.overflow);
      assert.equal(city.raycast(origin, direction, 50), native.raycast(origin, direction, 50));
      if (ch.inside) {
        assert.equal(city.raycastObstacle(origin, direction, 50, 0.3, undefined, hit(), ch), native.raycastObstacle(origin, direction, 50, 0.3, undefined, hit(), nh));
      }
    }
  }
});

test('riding at the Hudson goes out on the esplanade and stops at its railing, short of the water', () => {
  const west = getIslandBoundsAtZ(ROAD.z).westX;
  // heading -pi/2 rides toward -x (x += sin(heading)), at the Hudson, on the road west of the last kerb
  const euc = new EucController(new NycTerrainSampler(), { spawn: { position: { x: west + 18, y: 0, z: ROAD.z }, headingY: -Math.PI / 2 } });
  let nearest = euc.x;
  for (let i = 0; i < 8 * SIMULATION.hz; i++) {
    euc.step(DT, { ...NEUTRAL_ACTIONS, throttle: 0.6 });
    nearest = Math.min(nearest, euc.x);
  }
  const rail = ESPLANADE_RAIL.d; // m inland of the bulkhead (out on the coping)
  assert.ok(nearest - west < rail + 1.2, `reached the railing before recovery, x ${(nearest - west).toFixed(2)} m inside the bulkhead`);
  assert.ok(nearest - west > rail + 0.2, `never crossed it, x ${(nearest - west).toFixed(2)} m inside the bulkhead`);
});

function pierTop(z, top = 0.12, offset = 0, length = 28, width = 8) {
  const west = getIslandBoundsAtZ(z).westX;
  const minX = west - offset - length, maxX = west - offset + 1;
  return { poly: [{ x: minX, z: z - width / 2 }, { x: maxX, z: z - width / 2 },
    { x: maxX, z: z + width / 2 }, { x: minX, z: z + width / 2 }],
  minX, maxX, minZ: z - width / 2, maxZ: z + width / 2, top, surface: 'wood', shore: true };
}

test('stacked decks select support by rider height, including ragdoll underlying terrain and reset', () => {
  const z = ROAD.z;
  const deck = {poly:[{x:-4,z:z-50},{x:8,z:z-50},{x:8,z:z+100},{x:-4,z:z+100}],
    minX:-4,maxX:8,minZ:z-50,maxZ:z+100,top:6,surface:'wood',layered:true};
  const s = new NycTerrainSampler({tops:[deck]});
  assert.equal(s.sampleGround(2,z,probe(),0).height,0);
  const g={...probe(),base:{height:NaN,normal:{x:0,y:1,z:0}}};
  assert.equal(s.sampleGround(2,z,g,6).height,6);
  assert.equal(g.base.height,6);
  for(const y of [0,6]) {
    const rider=new EucController(s,{spawn:{position:{x:2,y,z},headingY:0}});
    const snap=ride(rider,3,{...NEUTRAL_ACTIONS,throttle:.4});
    assert.ok(Math.abs(snap.position.y-y)<.04);
    assert.ok(snap.position.z>z+8);
    assert.equal(rider.crashed,false);
    assert.ok(Math.abs(rider.safeY-y)<.04,'safe point retains elevation');
    rider.reset({position:{x:2,y:6-y,z},headingY:0});
    assert.ok(Math.abs(rider.snapshot().position.y-(6-y))<.04,'reset chooses destination level');
  }
});

test('suspended rail and body-only slab stay solid to rays but do not lift the lower rider', () => {
  const z=ROAD.z;
  const rail={centre:{x:2,y:7,z},halfExtents:{x:2,y:.1,z:.1},rotationY:0,surface:'stone',layered:true};
  const slab={centre:{x:2,y:5.5,z},halfExtents:{x:3,y:.5,z:3},rotationY:0,surface:'stone',support:false};
  const s=new NycTerrainSampler({boxes:[rail,slab]});
  assert.equal(s.sampleGround(2,z,probe(),0).height,0);
  assert.equal(s.sampleGround(2,z,probe(),6.5).height,7.1);
  assert.equal(s.raycastObstacle({x:2,y:1,z:z-5},{x:0,y:0,z:1},10),null);
  assert.notEqual(s.raycastObstacle({x:2,y:7,z:z-5},{x:0,y:0,z:1},10),null);
  assert.notEqual(s.raycast({x:2,y:4,z},{x:0,y:1,z:0},4),null);
});

test('a crash and automatic recovery preserve the upper deck instead of selecting the street below', () => {
  const z=ROAD.z,deck={poly:[{x:-8,z:z-100},{x:8,z:z-100},{x:8,z:z+100},{x:-8,z:z+100}],
    minX:-8,maxX:8,minZ:z-100,maxZ:z+100,top:6,surface:'pavement',layered:true};
  const s=new NycTerrainSampler({tops:[deck]});
  const rider=new EucController(s,{spawn:{position:{x:2,y:6,z},headingY:0}});
  ride(rider,2,{...NEUTRAL_ACTIONS,throttle:.2});
  rider.hardKnock(0,1);
  assert.equal(rider.crashed,true);
  const pose=createPose();
  for(let i=0;i<120*9;i++){
    rider.step(DT,NEUTRAL_ACTIONS);rider.writePose(pose);
    assert.ok(pose.y>5.8,`wheel stayed on upper floor (${pose.y})`);
    if(pose.ragdollBlend>0)for(let j=1;j<33;j+=3)assert.ok(pose.ragdoll[j]>5.3,`ragdoll particle ${j} below upper deck`);
  }
  assert.equal(rider.crashed,false,'automatic recovery finished');
  assert.ok(Math.abs(rider.snapshot().position.y-6)<.05);
});

test('drawn river rail mode removes the phantom wall over coping but preserves the unrailed drop', () => {
  const z=ROAD.z,west=getIslandBoundsAtZ(z).westX;
  const s=new NycTerrainSampler({shoreRails:true});
  assert.ok(s.sampleGround(west-5.5,z,probe()).height<.3,'no continuous 3m wall over the drawn coping');
  assert.ok(s.sampleGround(west-10,z,probe()).height<ISLAND_BOUNDS.waterLevel,'river remains river');
  assert.equal(s.isOffLimits(west-10,z),true);
  assert.equal(s.sampleGround(NORTH_BARRIER.x0+10,NORTH_BARRIER.z,probe()).height,3,'north barricade still closed');
});

test('shore classification is exact between cached rows at steep cove vertices', () => {
  const s=new NycTerrainSampler({shoreRails:true});let checked=0;
  for(const p of SEAWALL_POLYGON){
    if(p.z<NORTH_BARRIER.band[1]+2||p.z>5900)continue;
    for(const dx of [-.2,.2])for(const dz of [-.21,.21]){
      const x=p.x+dx,z=p.z+dz;
      if(!pointInPoly(SEAWALL_POLYGON,x,z)&&!pointInPoly(MANHATTAN_COASTLINE,x,z))continue;
      assert.ok(s.cityGround(x,z,{}).height<3,`drawn land was walled at ${x},${z}`);checked++;
    }
  }
  assert.ok(checked>100);
});

test('stock riding climbs a layered ramp from street level and descends back to the street', () => {
  const z=ROAD.z;
  const ramp={poly:[{x:-4,z},{x:8,z},{x:8,z:z+50},{x:-4,z:z+50}],minX:-4,maxX:8,minZ:z,maxZ:z+50,
    top:5,surface:'pavement',layered:true,plane:{x:2,y:0,z,dx:0,dz:.1}};
  const s=new NycTerrainSampler({tops:[ramp]});
  for(const descending of [false,true]) {
    const start=descending?{x:2,y:4.5,z:z+45}:{x:2,y:0,z:z-1};
    const rider=new EucController(s,{spawn:{position:start,headingY:descending?Math.PI:0}});
    const snap=ride(rider,4,{...NEUTRAL_ACTIONS,throttle:.5});
    assert.equal(rider.crashed,false);
    assert.ok(descending?snap.position.y<3.5:snap.position.y>1);
    assert.ok(Math.abs(snap.position.y-(snap.position.z-z)*.1)<.08);
  }
});

test('a drawn pier opens only its footprint through the shore wall and permits safe get-up on the deck', () => {
  const z = ROAD.z, west = getIslandBoundsAtZ(z).westX;
  const s = new NycTerrainSampler({ tops: [pierTop(z)] });
  for (const d of [3, 5.5, 7, 15, 25]) {
    assert.equal(s.sampleGround(west - d, z, probe()).height, 0.12, `pier ${d}m out`);
    assert.equal(s.isOffLimits(west - d, z), false, `safe deck ${d}m out`);
  }
  assert.equal(s.sampleGround(west - 5.5, z + 6, probe()).height, 3, 'the railing beside the mouth remains a wall');
  assert.equal(s.isOffLimits(west - 15, z + 6), true, 'water beside the deck remains off limits');
  assert.ok(s.sampleGround(west - 32, z, probe()).height < ISLAND_BOUNDS.waterLevel, 'past the deck is river');
  assert.equal(s.isOffLimits(west - 27.5, z), true, 'no get-up against the deck edge');
  const overlay = { ...pierTop(z, 0.3), shore: false, surface: 'brick' };
  const raised = new NycTerrainSampler({ tops: [pierTop(z), overlay] });
  assert.equal(raised.sampleGround(west - 5.5, z, probe()).height, 0.3, 'a higher overlay does not close the deck mouth');
  assert.equal(raised.isOffLimits(west - 15, z), false, 'higher overlay remains a safe pier surface');
});

test('the stock controller crosses a pier mouth without hitting the former invisible shore band', () => {
  const z = ROAD.z, west = getIslandBoundsAtZ(z).westX;
  const s = new NycTerrainSampler({ tops: [pierTop(z)] });
  const euc = new EucController(s, { spawn: { position: { x: west - 2, y: 0.12, z }, headingY: -Math.PI / 2 } });
  const snap = ride(euc, 3, { ...NEUTRAL_ACTIONS, throttle: 0.3 });
  assert.equal(euc.crashed, false);
  assert.ok(snap.position.x < west - 9, `crossed the old wall to ${snap.position.x - west}m`);
  assert.ok(Math.abs(snap.position.y - 0.12) < 0.03);
});

test('floating decks and sloping gangways retain negative support heights, normals and ragdoll terrain', () => {
  const z = ROAD.z, west = getIslandBoundsAtZ(z).westX;
  const dock = pierTop(z, -1.5, 12);
  const ramp = pierTop(z, 0.12, 0, 13);
  ramp.plane = { x: west - 2, y: 0.12, z, dx: 1.62 / 10, dz: 0 };
  const s = new NycTerrainSampler({ tops: [dock, ramp] });
  const out = { ...probe(), base: { height: NaN, normal: { x: 0, y: 1, z: 0 } } };
  assert.equal(s.sampleGround(west - 18, z, out).height, -1.5);
  assert.equal(out.base.height, -1.5);
  assert.equal(s.isOffLimits(west - 18, z), false);
  assert.ok(Math.abs(s.sampleGround(west - 10, z, out).height + 1.176) < 1e-9);
  assert.ok(Math.abs(out.normal.x / out.normal.y + 1.62 / 10) < 1e-9);
  assert.deepEqual(out.base.normal, out.normal);
  const euc = new EucController(s, { spawn: { position: { x: west - 6, y: -0.528, z }, headingY: -Math.PI / 2 } });
  const snap = ride(euc, 3, { ...NEUTRAL_ACTIONS, throttle: 0.3 });
  assert.equal(euc.crashed, false);
  assert.ok(snap.position.x < west - 14, 'rode down the gangway onto the floating deck');
  assert.ok(Math.abs(snap.position.y + 1.5) < 0.03);
});

test('an ordinary raised top cannot open the shoreline, and a pier cannot open the north barricades', () => {
  const z = ROAD.z, west = getIslandBoundsAtZ(z).westX;
  const top = pierTop(z); delete top.shore;
  assert.equal(new NycTerrainSampler({ tops: [top] }).sampleGround(west - 5.5, z, probe()).height, 3);
  const barrierZ = NORTH_BARRIER.z;
  const northTop = pierTop(barrierZ, 0.12, -200, 400, 12);
  const s = new NycTerrainSampler({ tops: [northTop] });
  assert.equal(s.sampleGround(northTop.maxX - 10, barrierZ, probe()).height, 3);
  assert.equal(s.isOffLimits(northTop.maxX - 10, barrierZ), true);
});

// ---- Central Park: raised behind its real wall, ridden in by the gates (city-config.js CENTRAL_PARK_GATES) ----------
import { CENTRAL_PARK_GATES, CENTRAL_PARK_ENTRANCES, CENTRAL_PARK_GATE_SIZE, CENTRAL_PARK_TOP, inCentralPark } from '../js/city-config.js';

const probe = () => ({ height: NaN, normal: { x: 0, y: 1, z: 0 }, surface: 'pavement', offCourse: true });

test('Central Park follows its wall, not its bounding box: Grand Army Plaza\'s corner is outside', () => {
  const s = new NycTerrainSampler();
  assert.equal(inCentralPark(-400, -2000), true);
  assert.equal(s.sampleGround(-400, -2000, probe()).height, CENTRAL_PARK_TOP);
  assert.equal(inCentralPark(-40, -1420), false, 'the plaza at 5th Ave & 59th St');
  assert.ok(s.sampleGround(-40, -1420, probe()).height < 1, 'not the park lawn');
});

test('every gate is a ramp from the sidewalk or road outside to the lawn, gentle enough to ride up', () => {
  const s = new NycTerrainSampler();
  const { width, length } = CENTRAL_PARK_GATE_SIZE;
  assert.ok(CENTRAL_PARK_GATES.length >= 10);
  for (const g of CENTRAL_PARK_GATES) {
    const at = (d, u = 0) => s.sampleGround(g.x + g.nx * d + g.tx * u, g.z + g.nz * d + g.tz * u, probe()).height;
    assert.ok(g.base === 0 || g.base === 0.22, `${g.name}: base ${g.base}`);
    assert.ok(Math.abs(at(0.05) - g.base) < 0.02, `${g.name}: starts level with what is outside (${at(0.05)})`);
    assert.ok(Math.abs(at(-0.3) - g.base) < 1e-9, `${g.name}: outside the wall is ${g.base}`);
    assert.ok(Math.abs(at(length - 0.05) - CENTRAL_PARK_TOP) < 0.02, `${g.name}: ends at the lawn`);
    let prev = at(0.05);
    for (let d = 0.5; d < length; d += 0.5) {
      const h = at(d);
      assert.ok(h - prev < 0.06 && h >= prev - 1e-9, `${g.name}: smooth climb at d=${d}`);
      prev = h;
    }
    const opening = CENTRAL_PARK_ENTRANCES.find(e => e.sources.some(s => s.named && s.name === g.name));
    const side = { x: opening.x + opening.nx * length / 2 + opening.tx * (opening.width / 2 + .6),
      z: opening.z + opening.nz * length / 2 + opening.tz * (opening.width / 2 + .6) };
    assert.equal(s.sampleGround(side.x, side.z, probe()).height, CENTRAL_PARK_TOP, `${g.name}: the wall beside the shared opening stays raised`);
  }
});

test('the wheel rides up Artists\' Gate (6th Ave) into the park without crashing', () => {
  const g = CENTRAL_PARK_GATES.find((t) => t.name === "Artists' Gate");
  const s = new NycTerrainSampler();
  // on the perimeter sidewalk, 3 m short of the gate, facing in
  const euc = new EucController(s, {
    spawn: { position: { x: g.x - g.nx * 3, y: 0.22, z: g.z - g.nz * 3 }, headingY: Math.atan2(g.nx, g.nz) }
  });
  const snap = ride(euc, 5, { ...NEUTRAL_ACTIONS, throttle: 0.6 });
  assert.equal(euc.crashed, false);
  assert.ok(inCentralPark(snap.position.x, snap.position.z), 'inside the wall');
  assert.ok(Math.abs(snap.position.y - CENTRAL_PARK_TOP) < 0.1, `on the lawn (y ${snap.position.y})`);
});

test('without a gate the wall stops the wheel at the sidewalk', () => {
  const g = CENTRAL_PARK_GATES.find((t) => t.name === "Artists' Gate");
  const s = new NycTerrainSampler();
  const x = g.x + g.tx * 40; // 40 m along the wall from the gate
  const z = g.z + g.tz * 40;
  const euc = new EucController(s, {
    spawn: { position: { x: x - g.nx * 3, y: 0.22, z: z - g.nz * 3 }, headingY: Math.atan2(g.nx, g.nz) }
  });
  const snap = ride(euc, 3, { ...NEUTRAL_ACTIONS, throttle: 0.4 });
  assert.equal(inCentralPark(snap.position.x, snap.position.z), false);
});

test('raised tops from city-grid.js lift the ground (the highest wins) and a pond is a wall', () => {
  const sq = (x0, z0, w, top, surface) => ({
    poly: [{ x: x0, z: z0 }, { x: x0 + w, z: z0 }, { x: x0 + w, z: z0 + w }, { x: x0, z: z0 + w }],
    top, surface, minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + w
  });
  // a park walk with a lawn bed on it, on the 5th Ave roadway near the spawn (synthetic)
  const s = new NycTerrainSampler({ tops: [sq(0, SPAWN_Z - 40, 20, 0.26, 'brick'), sq(5, SPAWN_Z - 35, 10, 0.41, 'grass')] });
  const walk = s.sampleGround(2, SPAWN_Z - 38, probe());
  assert.equal(walk.height, 0.26);
  assert.equal(walk.surface, 'brick');
  const bed = s.sampleGround(10, SPAWN_Z - 30, probe());
  assert.equal(bed.height, 0.41);
  assert.equal(bed.surface, 'grass');
  assert.equal(s.sampleGround(30, SPAWN_Z - 30, probe()).height < 0.3, true, 'outside: the city as before');
});

test('a pond is a wall along its shore only: inside, its floor sits under the surface, and it counts as water', () => {
  const level = 1.24;
  const x0 = 0, z0 = SPAWN_Z - 40, w = 20;
  const pond = {
    poly: [{ x: x0, z: z0 }, { x: x0 + w, z: z0 }, { x: x0 + w, z: z0 + w }, { x: x0, z: z0 + w }],
    top: level + WATER_RIDE.wall, surface: 'stone', minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + w,
    water: { level, floor: level - WATER_RIDE.floorDepth },
  };
  const s = new NycTerrainSampler({ tops: [pond] });
  const shore = s.sampleGround(x0 + WATER_RIDE.band / 2, z0 + w / 2, probe());
  assert.equal(shore.height, level + WATER_RIDE.wall, 'the shore band is a wall');
  assert.ok(WATER_RIDE.wall > 0.64, 'higher than a charged hop (3 m/s launch: 0.46 m, +40%)');
  const middle = s.sampleGround(x0 + w / 2, z0 + w / 2, probe());
  assert.equal(middle.height, level - WATER_RIDE.floorDepth, 'inside: the floor, under the surface');
  assert.equal(s.isWater(x0 + w / 2, z0 + w / 2), true);
  assert.equal(s.isWater(x0 + 0.2, z0 + w / 2), true, 'the band counts as water too');
  assert.equal(s.isWater(x0 - 1, z0 + w / 2), false);

  // The wheel rolling at the pond stops at the band (it never reaches the floor)
  const euc = new EucController(s, { spawn: { position: { x: x0 - 6, y: 0, z: z0 + w / 2 }, headingY: Math.PI / 2 } });
  ride(euc, 4, { ...NEUTRAL_ACTIONS, throttle: 0.5 });
  assert.ok(euc.x > x0 - 3, `reached the shore, x ${euc.x.toFixed(2)}`);
  assert.ok(euc.x < x0 + WATER_RIDE.band, `stopped at the shore, x ${euc.x.toFixed(2)}`);
});

test('Bryant Park: the terrace is ridden at its drawn top, a ramp climbs to it from the sidewalk, the lawn above', () => {
  const z0 = SPAWN_Z - 60;
  const lawn = {
    minX: 10, maxX: 30, minZ: z0 + 5, maxZ: z0 + 25, top: 1.32,
    terrace: { minX: 0, maxX: 40, minZ: z0, maxZ: z0 + 30, top: 1.06, ramps: [{ fromX: 0, toX: 8, minZ: z0 + 2, maxZ: z0 + 4 }] },
  };
  const s = new NycTerrainSampler({ lawn });
  assert.equal(s.sampleGround(35, z0 + 15, probe()).height, 1.06, 'terrace');
  assert.equal(s.sampleGround(20, z0 + 15, probe()).height, 1.32, 'lawn');
  assert.equal(s.sampleGround(0.5, z0 + 3, probe()).height, s.sidewalkHeight, 'ramp foot: the sidewalk slab');
  assert.ok(Math.abs(s.sampleGround(6, z0 + 3, probe()).height - 1.06 * 0.75) < 1e-9, 'ramp: three quarters up');
  assert.equal(s.sampleGround(0.5, z0 + 10, probe()).height, 1.06, 'beside the ramp: the terrace face');
});

test('the shore: the esplanade is ridden out to its railing, the coping past it is a wall, then the river', () => {
  const s = new NycTerrainSampler();
  const z = ROAD.z;
  const west = getIslandBoundsAtZ(z).westX;
  const at = (inland) => s.sampleGround(west + inland, z, probe()).height;
  const rail = ESPLANADE_RAIL.d;
  for (const inland of [4, 0, -3]) assert.ok(at(inland) <= ISLAND_BOUNDS.sidewalkHeight, `${inland}: the ground as drawn (${at(inland)})`);
  assert.equal(at(rail + 0.2), 3.0, 'just inside the railing: the wall the wheel stops at');
  assert.equal(at(rail - 0.1), 3.0, 'the coping past the railing');
  assert.ok(at(-10) < ISLAND_BOUNDS.waterLevel, 'the river: just under its surface');
  for (const inland of [rail + 0.6, -10]) assert.equal(s.isOffLimits(west + inland, z), true, `${inland}: no getting up here`);
  for (const inland of [-3, 4, 20]) assert.equal(s.isOffLimits(west + inland, z), false, `${inland}: a place to get up`);
});

test('round the Battery the wall follows its railing, inset from the bulkhead line, not a west or east shore x', () => {
  const s = new NycTerrainSampler();
  const tip = BATTERY_RAIL.tip;
  const C = MANHATTAN_COASTLINE;
  let area = 0;
  for (let i = 0, j = C.length - 1; i < C.length; j = i++) area += C[j].x * C[i].z - C[i].x * C[j].z;
  const s0 = area > 0 ? 1 : -1;
  let checked = 0;
  for (let i = 0; i + 1 < tip.length; i++) {
    const a = tip[i], b = tip[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 12) continue;
    const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (Math.hypot(m.x - BATTERY_RAIL.terminal.x, m.z - BATTERY_RAIL.terminal.z) < BATTERY_RAIL.terminalR + 15) continue;
    const n = { x: (-s0 * (b.z - a.z)) / len, z: (s0 * (b.x - a.x)) / len }; // inward
    const at = (d) => s.sampleGround(m.x + n.x * d, m.z + n.z * d, probe()).height;
    assert.ok(at(3) < 1, `segment ${i}: ground 3 m inside the bulkhead (${at(3)})`);
    assert.equal(at(BATTERY_RAIL.inset + 0.2), 3.0, `segment ${i}: the wall at the railing`);
    assert.ok(at(-12) < ISLAND_BOUNDS.waterLevel, `segment ${i}: the harbor past it`);
    checked++;
  }
  assert.ok(checked >= 5, `checked ${checked} stretches of the tip`);
});

test('the north end: a wall at the barricades along the cut, Upper Manhattan past them off limits', () => {
  const s = new NycTerrainSampler();
  const x = ROAD.x; // the 5th Ave roadway
  assert.ok(s.sampleGround(x, CUT_Z + 3, probe()).height < 0.3, 'the avenue runs up to the cut');
  assert.equal(s.sampleGround(x, NORTH_BARRIER.z, probe()).height, 3.0, 'the barricade line is a wall');
  assert.equal(s.sampleGround(x, CUT_Z - 10, probe()).height, 0, 'past it, the ground as drawn');
  assert.equal(s.isOffLimits(x, CUT_Z - 10), true);
  assert.equal(s.isOffLimits(x, CUT_Z + 6), false);
  // heading pi rides north (-z)
  const euc = new EucController(s, { spawn: { position: { x, y: 0, z: CUT_Z + 25 }, headingY: Math.PI } });
  let nearest = euc.z;
  for (let i = 0; i < 8 * SIMULATION.hz; i++) {
    euc.step(DT, { ...NEUTRAL_ACTIONS, throttle: 0.6 });
    nearest = Math.min(nearest, euc.z);
  }
  assert.ok(nearest < CUT_Z + 1.5, `reached the barricades before recovery, ${(nearest - CUT_Z).toFixed(2)} m short of the cut`);
  assert.ok(nearest > NORTH_BARRIER.band[1], `never crossed them, ${(nearest - CUT_Z).toFixed(2)} m short of the cut`);
});

test('an inlet in the bulkhead line is water, not the island\'s ground', () => {
  // On z = 3950 the coastline crosses at the outer Hudson shore and twice more round an inlet (a slip) inside it
  const s = new NycTerrainSampler();
  const z = 3950;
  const xs = [];
  const C = MANHATTAN_COASTLINE;
  for (let i = 0, j = C.length - 1; i < C.length; j = i++) {
    const a = C[j], b = C[i];
    if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
  }
  xs.sort((p, q) => p - q);
  assert.ok(xs.length >= 4, `crossings ${xs.map(Math.round)}`);
  const mid = (xs[1] + xs[2]) / 2;
  assert.ok(s.sampleGround(mid, z, probe()).height < ISLAND_BOUNDS.waterLevel, 'the middle of the inlet is water');
});
