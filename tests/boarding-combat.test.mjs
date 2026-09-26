import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardingCombat,CREW,cameraPose,trace} from '../src/boarding-combat.js';
const advance=(s,seconds,input={})=>{for(let i=0;i<Math.round(seconds/.02);i++)s.update(.02,input);};
function aimAt(s,target=s.enemy) {
  // Shoulder offset requires a camera-to-target bearing, not a centre-of-player ray.
  for(let i=0;i<8;i++) {const cam=cameraPose(s.player,s.view,s.aiming).position,dx=target.x-cam.x,dz=target.z-cam.z;
    s.view.yaw=Math.atan2(dx,-dz);s.view.pitch=Math.atan2(cam.y-1.25,Math.hypot(dx,dz));}
}
test('TPS keeps original crew health, damage and 20m range, starts with manual movement',()=>{
  const s=new BoardingCombat(),p={x:s.player.x,z:s.player.z};advance(s,.5);
  assert.equal(s.player.health,100);assert.equal(s.enemy.health,50);assert.equal(CREW.damage,10);assert.equal(CREW.range,20);
  assert.deepEqual({x:s.player.x,z:s.player.z},p);assert.equal(s.shots,0);assert.equal(s.player.state,'idle');
});
test('Camera-relative movement, diagonals, release, crouch and run use physical speeds',()=>{
  const s=new BoardingCombat();s.view.yaw=Math.PI/2;advance(s,.4,{z:1});assert.ok(s.player.x>1.3);assert.equal(s.player.z,11);assert.equal(s.player.state,'walk');
  const p={...s.player};advance(s,.2);assert.equal(s.player.x,p.x);assert.equal(s.player.state,'idle');
  const diagonal=new BoardingCombat();advance(diagonal,.4,{x:1,z:1});assert.ok(Math.hypot(diagonal.player.x,diagonal.player.z-11)<=CREW.walk*.4+1e-8);
  const run=new BoardingCombat();advance(run,.4,{z:1,run:true});assert.equal(run.player.state,'run');assert.ok(11-run.player.z>2);
  const crouch=new BoardingCombat();advance(crouch,.4,{z:1,crouch:true});assert.equal(crouch.player.state,'crouch-walk');assert.ok(11-crouch.player.z<.7);
});
test('Walls and solid cargo block movement without teleporting through them',()=>{
  const s=new BoardingCombat();s.player.x=-2.1;advance(s,1.8,{z:1,run:true});assert.ok(s.player.z>=6.15+CREW.radius);
  s.player.x=8.5;s.player.z=11;advance(s,.5,{x:1,run:true});assert.ok(s.player.x<=8.66);
});
test('Actual crosshair aim hits, looking away misses and range is enforced',()=>{
  const s=new BoardingCombat();aimAt(s);assert.ok(s.fire());assert.equal(s.enemy.health,40);assert.equal(s.hits,1);
  s.cooldown=0;s.view.yaw+=.5;s.fire();assert.equal(s.enemy.health,40);
  const far=new BoardingCombat();far.enemy.z=-12;aimAt(far);far.fire();assert.equal(far.enemy.health,50);
});
test('Cover stops rays; crouching behind a low crate protects the whole hit volume',()=>{
  const s=new BoardingCombat();s.player.x=-2.1;s.player.z=7;s.player.crouch=true;
  const from={x:-2.1,y:1.4,z:0},target={x:-2.1,y:.65,z:7},dy=target.y-from.y,dz=7,n=Math.hypot(dy,dz);
  assert.equal(trace(from,{x:0,y:dy/n,z:dz/n},20,s.player).kind,'cover');
  s.player.crouch=false;assert.equal(trace({x:-2.1,y:1.4,z:0},{x:0,y:0,z:1},20,s.player).kind,'crew');
});
test('Shoulder camera retracts at a wall, while a blocked muzzle cannot shoot through cover',()=>{
  const s=new BoardingCombat();s.player.z=14.6;const camera=cameraPose(s.player,s.view);assert.ok(camera.position.z<14.9);
  s.player.x=-2.1;s.player.z=7;s.player.crouch=true;s.enemy.x=-2.1;s.enemy.z=0;aimAt(s);s.fire();assert.equal(s.enemy.health,50);
});
test('Cadence, finite magazines, reload and paused time cannot create extra bullets',()=>{
  const s=new BoardingCombat();s.view.yaw=1;assert.ok(s.fire());assert.equal(s.fire(),false);
  advance(s,1.8,{fire:true});assert.equal(s.shots,8);assert.equal(s.rounds,0);assert.ok(s.reloadTime>0);
  const frozen=JSON.stringify(s);s.update(0,{fire:true});assert.equal(JSON.stringify(s),frozen);
  advance(s,1.7);assert.equal(s.rounds,8);assert.equal(s.shots,8);assert.equal(s.reload(),false);
});
test('Enemy telegraphs, freezes a target, can miss a moving player and cannot hit through cargo',()=>{
  const s=new BoardingCombat();for(let i=0;i<300&&s.enemyPhase!=='lock';i++)s.update(.02);
  assert.equal(s.enemyPhase,'lock');const point={...s.enemyAim};advance(s,.5,{x:1,run:true});
  assert.deepEqual(s.enemyAim,point);assert.equal(s.enemyShots,1);assert.equal(s.player.health,100);
  const still=new BoardingCombat();advance(still,4);assert.ok(still.player.health<100);
});
test('Five real aimed hits win, death animates, no post-result firing and reset is clean',()=>{
  const s=new BoardingCombat();for(let i=0;i<5;i++){aimAt(s);s.fire();advance(s,.26);}
  assert.equal(s.enemy.health,0);assert.equal(s.phase,'victory');assert.equal(s.enemy.state,'down');assert.ok(s.enemy.deathAge>0);
  const shots=s.shots;advance(s,2,{fire:true});assert.equal(s.shots,shots);assert.equal(s.fire(),false);
  s.reset();assert.equal(s.phase,'active');assert.equal(s.enemy.health,50);assert.equal(s.player.health,100);assert.equal(s.shots,0);
});
test('Ignored enemy fire causes defeat with correct down state',()=>{
  const s=new BoardingCombat();advance(s,40);assert.equal(s.phase,'defeat');assert.equal(s.player.health,0);assert.equal(s.player.state,'down');
});

test('An enemy can flank a low crate instead of oscillating forever at its centre',()=>{
  const s=new BoardingCombat();s.player.x=-2.1;s.player.z=7;s.enemy.x=0;s.enemy.z=0;
  advance(s,12,{crouch:true});assert.ok(s.enemyShots>0);assert.ok(s.player.health<100);
});
