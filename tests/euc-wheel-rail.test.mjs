import test from 'node:test';
import assert from 'node:assert/strict';
import { NycTerrainSampler } from '../js/euc-terrain.js';
import { EucController } from '../js/euc/simulation/EucController.js';
import { NEUTRAL_ACTIONS } from '../js/euc/input/actions.js';

const x=1336,z=-5817,floor=.24;
const bar={centre:{x,y:floor+.42,z},halfExtents:{x:.045,y:.045,z:2},rotationY:0,surface:'stone',support:false,wheelSweep:true};
const top=(minX,maxX,minZ,maxZ,h)=>({minX,maxX,minZ,maxZ,poly:[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}],top:h,surface:'pavement'});
const sampler=(tag=true)=>new NycTerrainSampler({boxes:[{...bar,wheelSweep:tag}],tops:[top(x-10,x+10,z-10,z+10,floor),top(x-.045,x+.045,z-2,z+2,floor+.465)]});

test('tagged rail meets the shell clearance query without becoming a solid wall below the actual bar',()=>{
 const S=sampler(),origin={x:x-1,y:floor+.216001,z},dir={x:1,y:0,z:0};
 assert.equal(S.raycastObstacle(origin,dir,2),null,'ordinary geometric ray still goes under the bar');
 assert.ok(Math.abs(S.raycastWheelObstacle(origin,dir,2)-.955)<1e-6);
 assert.equal(S.raycastWheelObstacle({...origin,y:floor+1},dir,2),null,'an elevated wheel clears it');
 assert.equal(sampler(false).raycastWheelObstacle(origin,dir,2),null,'unmarked city geometry keeps native semantics');
 assert.equal(S.colliderCount,1,'derived wheel envelope is not a new world/ragdoll collider');
});

for(const direction of [-1,1]) test(`stock controller stops with its wheel outside the elevated rail from side ${direction}`,()=>{
 const S=sampler(),R=new EucController(S,{spawn:{position:{x:x-direction*2,y:floor,z},headingY:direction*Math.PI/2}});
 for(let i=0;i<720&&!R.crashed;i++)R.step(1/120,{...NEUTRAL_ACTIONS,throttle:.2});
 const p=R.snapshot().position;
 assert.ok(direction*(p.x-x)<=-.27,`wheel edge must remain outside beam: offset ${p.x-x}`);
});

test('the nearer ordinary wall retains its hit details ahead of a tagged rail',()=>{
 const S=sampler();const wall={centre:{x:x-1,y:1,z},halfExtents:{x:.1,y:1,z:1},rotationY:0,surface:'stone'};
 const T=new NycTerrainSampler({boxes:[wall,bar]});
 const out={distance:0,halfExtentX:0,halfExtentZ:0,normal:{x:0,y:0,z:0}};
 const hit=T.raycastWheelObstacle({x:x-2,y:.456,z},{x:1,y:0,z:0},3,0,undefined,out);
 assert.ok(Math.abs(hit-.9)<1e-6);assert.equal(out.halfExtentX,.1);assert.equal(out.normal.x,-1);
 const far=S.raycastWheelObstacle({x:0,y:.456,z:0},{x:1,y:0,z:0},3);
 assert.equal(far,null,'remote rail has no city-wide effect');
});

test('parallel low-speed standoff keeps pedals and boots clear of the tagged beam',()=>{
 const R=new EucController(sampler(),{spawn:{position:{x:x-.2,y:floor,z},headingY:0}});
 for(let i=0;i<120;i++)R.step(1/120,NEUTRAL_ACTIONS);
 assert.ok(x-R.snapshot().position.x>=.28);
});

test('a timed charged hop still clears the tagged bar rather than meeting an infinite rail wall',()=>{
 const R=new EucController(sampler(),{spawn:{position:{x:x-8,y:floor,z},headingY:Math.PI/2}});
 let hopped=false,high=floor;
 for(let i=0;i<600&&!R.crashed;i++){
  const hop=!hopped&&R.snapshot().position.x>x-1.8&&R.canAcceptHop;
  if(hop)hopped=true;
  R.step(1/120,{...NEUTRAL_ACTIONS,throttle:.35,crouch:!hopped,hop,hopHeld:hop});
  high=Math.max(high,R.snapshot().position.y);
  if(R.snapshot().position.x>x+1)break;
 }
 assert.ok(hopped);assert.ok(!R.crashed);assert.ok(R.snapshot().position.x>x+1,JSON.stringify({high,p:R.snapshot().position}));
});
