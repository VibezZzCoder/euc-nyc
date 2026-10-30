const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');

async function harness() {
  const THREE = await import(pathToFileURL(join(__dirname, '../vendor/three/build/three.webgpu.js')).href);
  const source = readFileSync(join(__dirname, '../js/cameras.js'), 'utf8');
  const events = { addEventListener() {} };
  const { CameraSystem, CAMERA_PRESETS } = vm.runInNewContext(source.replace(/^import .*;$/gm, '').replace(/^export .*;$/gm, '') + '\n({CameraSystem, CAMERA_PRESETS});', {
    THREE, window: { ...events, innerWidth: 1280, innerHeight: 720 }, document: events
  });
  const entity = { position: new THREE.Vector3(0, 0, 0), heading: 0, speed: 0,
    chaseDistance: 6.9, chaseHeight: 2.12, cameraTargetOffset: new THREE.Vector3(0, -.3, 0) };
  const manager = { getActiveEntity: () => entity };
  const camera = new CameraSystem({ ...events, style: {} }, manager);
  return { camera, entity, manager, THREE, presets: CAMERA_PRESETS };
}

test('every preset translates with the rider in all three axes, everywhere in the city', async () => {
  const { presets, THREE } = await harness();
  for (const { id } of presets) {
    const a = await harness(), b = await harness();
    const translation = new THREE.Vector3(1500, 85, -5800);
    b.entity.position.add(translation);
    for (const h of [a,b]) { h.camera.setCameraPreset(id,true); h.camera.update(1/60,900); }
    assert.ok(b.camera.camera.position.clone().sub(a.camera.camera.position).distanceTo(translation)<1e-8, id);
    assert.ok(b.camera.currentLookAt.clone().sub(a.camera.currentLookAt).distanceTo(translation)<1e-8, id);
    // Constant-speed movement must not leave the camera lagging in world space.
    for(let i=0;i<60;i++) {
      for(const h of [a,b]) { h.entity.position.z+=.4; h.camera.update(1/60,901+i/60); }
    }
    assert.ok(b.camera.camera.position.clone().sub(a.camera.camera.position).distanceTo(translation)<1e-8,id);
  }
});

test('all third-person presets frame the whole upright rider in portrait and landscape', async () => {
  const h = await harness();
  for (const { id } of h.presets.filter(p=>p.id!=='pov')) {
    for (const [w, height] of [[1280,720],[390,844],[844,390],[320,568]]) {
      h.camera.onResize(w,height);
      h.camera.setCameraPreset(id,true);
      h.camera.update(1/60,20);
      h.camera.camera.updateMatrixWorld();
      for(const y of [.2,1.0,1.85]) {
        const ndc = new h.THREE.Vector3(0,y,0).project(h.camera.camera);
        assert.ok(Math.abs(ndc.x)<.9 && Math.abs(ndc.y)<.9,`${id} ${w}x${height} at ${y}: ${ndc.toArray()}`);
      }
      assert.ok(h.camera.camera.position.distanceTo(h.entity.position)<65,id);
    }
  }
});

test('switching and large relocations stay local, director does not depend on world elapsed time', async () => {
  const a=await harness(), b=await harness();
  for(const h of [a,b]) h.camera.setCameraPreset('drone',true);
  a.camera.update(1/60,0); b.camera.update(1/60,9000);
  assert.ok(a.camera.camera.position.distanceTo(b.camera.camera.position)<1e-8);
  for(const {id} of a.presets) {
    a.camera.setCameraPreset(id);
    a.entity.position.set(1000,30,-5000);
    a.camera.update(1/60,40);
    assert.ok(a.camera.camera.position.distanceTo(a.entity.position)<65,id);
  }
});

test('cinematic framing and shortest-angle turns are refresh-rate independent', async () => {
  const results=[];
  for(const fps of [30,60,120]) {
    const h=await harness();
    h.entity.heading=Math.PI-.05;
    h.camera.setCameraPreset('bryantPark',true); h.camera.update(0,0);
    const start=h.camera.camera.position.clone();
    h.entity.heading=-Math.PI+.05;
    for(let i=0;i<fps;i++) h.camera.update(1/fps,i/fps);
    assert.ok(start.distanceTo(h.camera.camera.position)<1,'wrap must not spin around rider');
    results.push(h.camera.camera.position);
  }
  assert.ok(results[0].distanceTo(results[2])<.05);
});

test('cinematic cameras retract before a wall or ceiling and ease out after clearance', async () => {
  const h=await harness();
  let blocked=true;
  // Rear/side walls plus ceiling; ray API returns metric distance even for nonunit directions.
  h.manager.eucSampler={ raycast(o,d,max) {
    if(!blocked)return null;
    const length=Math.hypot(d.x,d.y,d.z);
    const hits=[d.z<0 ? (-3-o.z)/d.z*length : Infinity, d.y>0 ? (3-o.y)/d.y*length : Infinity,
      d.x ? ((d.x>0 ? 3 : -3)-o.x)/d.x*length : Infinity];
    const hit=Math.min(...hits.filter(v=>v>=0)); return hit<=max?hit:null;
  }};
  for(const id of ['centralPark','fifthAve','timesSquare','chryslerGCT','observatory','bryantPark','waterfront','drone']) {
    blocked=true; h.camera.setCameraPreset(id,true); h.camera.update(1/60,0);
    assert.ok(h.camera.camera.position.z> -3, id+' wall');
    assert.ok(h.camera.camera.position.y<3, id+' ceiling');
    assert.ok(Math.abs(h.camera.camera.position.x)<3,id+' side walls');
    const before=h.camera.camera.position.distanceTo(h.entity.position);
    blocked=false; h.camera.update(1/60,0);
    const first=h.camera.camera.position.distanceTo(h.entity.position);
    for(let i=0;i<180;i++)h.camera.update(1/60,0);
    const last=h.camera.camera.position.distanceTo(h.entity.position);
    assert.ok(first<last && first<before+2, id+' smooth release');
  }
});

test('side cameras choose a clearer side without rapid alternating cuts; panorama prefers nearby water', async () => {
  const h=await harness();
  h.manager.eucSampler={ raycast(o,d) { return d.x>0 ? 1 : null; }, isWater:()=>false };
  h.camera.setCameraPreset('bryantPark',true); h.camera.update(1/60,0);
  assert.ok(h.camera.camera.position.x<0,'choose open left side');
  h.manager.eucSampler.raycast=()=>null;
  for(let i=0;i<180;i++)h.camera.update(1/60,0);
  assert.ok(h.camera.camera.position.x<0,'stay on equally clear side');
  h.manager.eucSampler.isWater=(x)=>x<0;
  h.camera.setCameraPreset('waterfront',true); h.camera.update(1/60,0);
  assert.ok(h.camera.camera.position.x<0,'film from water side');
});

test('Panorama distinguishes real river water from city land and floating pier surfaces', async () => {
  const { NycTerrainSampler } = await import(pathToFileURL(join(__dirname,'../js/euc-terrain.js')).href);
  const h=await harness();
  h.manager.eucSampler=new NycTerrainSampler({shoreRails:true});
  assert.equal(h.manager.eucSampler.isWater(-3000,0),false,'pond query alone does not identify the Hudson');
  assert.equal(h.camera.waterSide(-3000,0,0),true,'Hudson water');
  assert.equal(h.camera.waterSide(0,-20,0),false,'street');
  h.manager.eucSampler=new NycTerrainSampler({shoreRails:true,tops:[{
    minX:-3005,maxX:-2995,minZ:-5,maxZ:5,top:-.1,surface:'wood',shore:true,
    poly:[{x:-3005,z:-5},{x:-2995,z:-5},{x:-2995,z:5},{x:-3005,z:5}]
  }]});
  assert.equal(h.camera.waterSide(-3000,0,0),false,'negative-height floating deck is land');
  assert.equal(h.camera.waterSide(-2995.5,0,0),false,'deck edge is land even where recovery disallows the footprint');
});
