import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardingCombat,CREW,cameraPose,trace} from '../src/boarding-combat.js';
import {INTERIOR,deckHeight,zoneAt} from '../src/boarding-layout.js';
const advance=(s,seconds,input={})=>{for(let i=0;i<Math.round(seconds/.02);i++)s.update(.02,input);};
const room=()=>{const s=new BoardingCombat();s.player.z=11;s.player.y=0;s.enteredEnemy=true;return s;};
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
  const s=room();s.view.yaw=Math.PI/2;advance(s,.4,{z:1});assert.ok(s.player.x>1.3);assert.equal(s.player.z,11);assert.equal(s.player.state,'walk');
  const p={...s.player};advance(s,.2);assert.equal(s.player.x,p.x);assert.equal(s.player.state,'idle');
  const diagonal=room();advance(diagonal,.4,{x:1,z:1});assert.ok(Math.hypot(diagonal.player.x,diagonal.player.z-11)<=CREW.walk*.4+1e-8);
  const run=room();advance(run,.4,{z:1,run:true});assert.equal(run.player.state,'run');assert.ok(11-run.player.z>2);
  const crouch=room();advance(crouch,.4,{z:1,crouch:true});assert.equal(crouch.player.state,'crouch-walk');assert.ok(11-crouch.player.z<.7);
});
test('Walls and solid cargo block movement without teleporting through them',()=>{
  const s=room();s.player.x=-2.1;advance(s,1.8,{z:1,run:true});assert.ok(s.player.z>=6.15+CREW.radius);
  s.player.x=8.5;s.player.z=11;advance(s,.5,{x:1,run:true});assert.ok(s.player.x<=8.66);
});
test('Actual crosshair aim hits, looking away misses and range is enforced',()=>{
  const s=room();aimAt(s);assert.ok(s.fire());assert.equal(s.enemy.health,40);assert.equal(s.hits,1);
  s.cooldown=0;s.view.yaw+=.5;s.fire();assert.equal(s.enemy.health,40);
  const far=room();far.enemy.z=-12;aimAt(far);far.fire();assert.equal(far.enemy.health,50);
});
test('Cover stops rays; crouching behind a low crate protects the whole hit volume',()=>{
  const s=room();s.player.x=-2.1;s.player.z=7;s.player.crouch=true;
  const from={x:-2.1,y:1.4,z:0},target={x:-2.1,y:.65,z:7},dy=target.y-from.y,dz=7,n=Math.hypot(dy,dz);
  assert.equal(trace(from,{x:0,y:dy/n,z:dz/n},20,s.player).kind,'cover');
  s.player.crouch=false;assert.equal(trace({x:-2.1,y:1.4,z:0},{x:0,y:0,z:1},20,s.player).kind,'crew');
});
test('Shoulder camera retracts at a wall, while a blocked muzzle cannot shoot through cover',()=>{
  const s=room();s.player.x=8.6;s.view.yaw=-Math.PI/2;const camera=cameraPose(s.player,s.view);assert.ok(camera.position.x<9);
  s.player.x=-2.1;s.player.z=7;s.player.crouch=true;s.enemy.x=-2.1;s.enemy.z=0;aimAt(s);s.fire();assert.equal(s.enemy.health,50);
});
test('Cadence, finite magazines, reload and paused time cannot create extra bullets',()=>{
  const s=new BoardingCombat();s.view.yaw=1;assert.ok(s.fire());assert.equal(s.fire(),false);
  advance(s,1.8,{fire:true});assert.equal(s.shots,8);assert.equal(s.rounds,0);assert.ok(s.reloadTime>0);
  const frozen=JSON.stringify(s);s.update(0,{fire:true});assert.equal(JSON.stringify(s),frozen);
  advance(s,1.7);assert.equal(s.rounds,8);assert.equal(s.shots,8);assert.equal(s.reload(),false);
});
test('Enemy telegraphs, freezes a target, can miss a moving player and cannot hit through cargo',()=>{
  const s=room();for(let i=0;i<300&&s.enemyPhase!=='lock';i++)s.update(.02);
  assert.equal(s.enemyPhase,'lock');const point={...s.enemyAim};advance(s,.5,{x:1,run:true});
  assert.deepEqual(s.enemyAim,point);assert.equal(s.enemyShots,1);assert.equal(s.player.health,100);
  const still=room();advance(still,4);assert.ok(still.player.health<100);
});
test('Five aimed hits leave a lootable corpse, never auto-win or automatically award loot',()=>{
  const s=room();for(let i=0;i<5;i++){aimAt(s);s.fire();advance(s,.26);}
  assert.equal(s.enemy.health,0);assert.equal(s.phase,'active');assert.equal(s.enemy.state,'down');assert.ok(s.enemy.deathAge>0);
  const shots=s.enemyShots;advance(s,2);assert.equal(s.enemyShots,shots);assert.equal(s.bag.fuelCells,0);assert.equal(s.interact(),false);
  s.reset();assert.equal(s.phase,'active');assert.equal(s.enemy.health,50);assert.equal(s.player.health,100);assert.equal(s.shots,0);
});
test('Ignored enemy fire causes defeat with correct down state',()=>{
  const s=room();advance(s,40);assert.equal(s.phase,'defeat');assert.equal(s.player.health,0);assert.equal(s.player.state,'down');
});

test('An enemy can flank a low crate instead of oscillating forever at its centre',()=>{
  const s=room();s.player.x=-2.1;s.player.z=7;s.enemy.x=0;s.enemy.z=0;
  advance(s,12,{crouch:true});assert.ok(s.enemyShots>0);assert.ok(s.player.health<100);
});

test('Walk continuously from the upper helm down the stairs and across both ends of the breach',()=>{
  const s=new BoardingCombat();s.enemy.health=0;
  assert.equal(s.player.y,4);assert.equal(zoneAt(s.player.x,s.player.z),'cockpit');
  const seen=new Set();let lastY=s.player.y;
  for(let i=0;i<450;i++){s.update(.02,{z:1});seen.add(zoneAt(s.player.x,s.player.z));assert.ok(Math.abs(s.player.y-lastY)<.04);lastY=s.player.y;}
  assert.deepEqual([...seen],['cockpit','stairs','airlock','bridge','enemy']);assert.equal(s.player.y,0);assert.equal(s.enteredEnemy,true);
  advance(s,9,{z:-1});assert.equal(zoneAt(s.player.x,s.player.z),'cockpit');assert.equal(s.player.y,4);assert.equal(s.returned,true);
});

test('Corridor walls are solid and own ship is not a teleportable exit',()=>{
  const s=new BoardingCombat();s.player.z=19;s.player.y=0;advance(s,2,{x:1});assert.ok(s.player.x<1.87);
  assert.equal(s.interact(),false);s.player.health=0;assert.equal(s.interaction(),null);
});

test('Corpse loot requires proximity, can be collected once, and remains carried until extraction',()=>{
  const s=room();s.enemy.health=0;advance(s,1);assert.equal(s.interact(),false);
  s.player.x=s.enemy.x;s.player.z=s.enemy.z+1;assert.equal(s.interact(),'loot');
  assert.deepEqual(s.bag,{fuelCells:2,ammoCrates:1,medicalSupplies:1});assert.equal(s.interact(),false);assert.equal(s.phase,'active');
});

test('Living players can extract with a living enemy and empty bag by pulling the physical home lever',()=>{
  const s=new BoardingCombat();s.enteredEnemy=true;s.player.x=INTERIOR.lever.x;s.player.z=INTERIOR.lever.z;s.player.y=0;
  assert.equal(s.interact(),'extract');assert.equal(s.interact(),false);assert.equal(s.fire(),false);
  advance(s,1.8);assert.equal(s.phase,'home');assert.equal(s.enemy.health,50);assert.equal(s.extraction,1);assert.equal(s.bag.fuelCells,0);
  assert.equal(s.player.z,INTERIOR.lever.z);assert.equal(s.interact(),false,'Lever cannot teleport or be pulled twice');
  advance(s,20);assert.equal(s.phase,'home','Waiting never returns to the cockpit view');
});

test('After disconnect the closed hatch blocks walking, shots and camera, while stairs and helm remain usable',()=>{
  const s=new BoardingCombat();Object.assign(s.player,{x:2.3,y:0,z:25.8});s.interact();advance(s,1.8);
  advance(s,.68,{x:-1});advance(s,2,{z:1});assert.ok(s.player.z>=23.44);
  assert.equal(trace({x:0,y:1.4,z:25},{x:0,y:0,z:-1},20,null,s.solids).kind,'cover');
  s.view.yaw=Math.PI;assert.ok(cameraPose(s.player,s.view,false,s.solids).position.z>23.1);
  s.view.yaw=0;advance(s,4.8,{z:-1});assert.equal(zoneAt(s.player.x,s.player.z),'cockpit');assert.equal(s.player.y,4);
  assert.equal(s.interact(),false,'Standing upstairs is not enough: approach the pilot seat');
  s.player.x=INTERIOR.helm.x;s.player.z=INTERIOR.helm.z;
  assert.equal(s.interaction().type,'helm');assert.equal(s.interact(),'helm');assert.equal(s.phase,'victory');assert.equal(s.player.state,'seated');
  assert.equal(s.interact(),false,'Seating is a one-shot action');
});

test('Death drops carried loot; respawn is at our upper helm without recreating the corpse or its loot',()=>{
  const s=room();s.enemy.health=0;s.enemy.deathAge=1;s.player.x=s.enemy.x;s.player.z=s.enemy.z+1;s.interact();
  s.player.health=0;advance(s,.02);assert.equal(s.phase,'defeat');assert.equal(s.bag.fuelCells,0);
  s.respawn();assert.equal(s.player.health,100);assert.equal(s.player.z,INTERIOR.spawn.z);assert.equal(s.player.y,4);
  assert.equal(s.enemy.health,0);assert.equal(s.enemy.looted,true);assert.equal(s.bag.fuelCells,0);
});

test('Camera and weapon height follow the deck rather than floating below the upstairs floor',()=>{
  const s=new BoardingCombat();assert.ok(cameraPose(s.player,s.view).position.y>5);
  s.player.z=32;s.player.y=deckHeight(32);assert.equal(s.player.y,2);assert.ok(cameraPose(s.player,s.view).position.y>3);
});
