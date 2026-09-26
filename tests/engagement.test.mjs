import test from 'node:test';
import assert from 'node:assert/strict';
import {EnemyDefense,DEFENSE} from '../src/enemy-defense.js';
import {PlayerCannon,traceCannon} from '../src/player-cannon.js';
import {OrbitNavigation,lookAt} from '../src/navigation.js';

function fixture() {
  const nav=new OrbitNavigation();nav.begin({x:0,y:0});nav.position={x:0,y:0,z:0};
  const enemy=new EnemyDefense();enemy.previousPlayer={...nav.position};
  return {nav,enemy};
}
const bolt=(x,volley=1,z=-8)=>({position:{x,y:0,z},direction:{x:0,y:0,z:1},age:0,volley,damage:25});
test('Near misses occur at a real closest pass, on the correct side, without damage',()=>{
  for(const side of [-1,1]) {
    const {nav,enemy}=fixture();enemy.bolts=[bolt(side*10,1,-20)];
    assert.deepEqual(enemy.update(.05,nav,{breached:true}),[],'Approaching is not yet a pass');
    assert.deepEqual(enemy.update(.05,nav,{breached:true}),['enemy-near-miss']);
    assert.equal(enemy.nearMiss.distance,10);assert.equal(enemy.nearMiss.offset.x,side*10);
    assert.equal(enemy.hull,100);assert.equal(enemy.nearMisses,1);assert.equal(enemy.nearMissAge,0);
    for(let i=0;i<10;i++)assert.deepEqual(enemy.update(.05,nav,{breached:true}),[]);
    assert.equal(enemy.bolts.length,1,'Feedback never deletes or redirects the projectile');
    assert.deepEqual(enemy.bolts[0].direction,{x:0,y:0,z:1});
    const snapshot=JSON.stringify(enemy);enemy.update(0,nav);assert.equal(JSON.stringify(enemy),snapshot);
    enemy.reset();assert.equal(enemy.nearMiss,null);assert.equal(enemy.nearMisses,0);
  }
});
test('A fan produces one near-miss cue; a damaging salvo never celebrates a dodge',()=>{
  const {nav,enemy}=fixture();enemy.bolts=Array.from({length:9},(_,i)=>bolt(8+i));
  assert.deepEqual(enemy.update(.05,nav,{breached:true}),['enemy-near-miss']);
  assert.equal(enemy.nearMiss.distance,8);assert.equal(enemy.nearMisses,1);
  enemy.bolts.push(bolt(10));assert.deepEqual(enemy.update(.05,nav,{breached:true}),[]);
  enemy.reset();enemy.bolts=[bolt(10),bolt(0)];
  assert.deepEqual(enemy.update(.05,nav,{breached:true}),['enemy-hit']);
  assert.equal(enemy.nearMisses,0);assert.equal(enemy.hull,75);
});
test('Distant/receding projectiles cannot create near-miss cues; player movement is swept',()=>{
  const {nav,enemy}=fixture();enemy.bolts=[bolt(DEFENSE.nearMissRadius+1),bolt(10,2,3)];
  assert.deepEqual(enemy.update(.05,nav,{breached:true}),[]);
  enemy.reset();enemy.previousPlayer={x:0,y:0,z:0};nav.position={x:20,y:0,z:0};
  enemy.bolts=[bolt(10,1,-5.5)];
  assert.deepEqual(enemy.update(.05,nav,{breached:true}),['enemy-hit'],'Crossing a round is not a dodge');
});
test('Scar surface normals remain ship-local on rotated hulls and survive transient effects',()=>{
  for(const yaw of [0,1.2,-2]) {
    const nav=new OrbitNavigation();nav.begin({x:0,y:0});nav.setEnemyYaw(yaw);
    const hit=traceCannon(nav,nav.world({x:0,y:0,z:155}),nav.world({x:0,y:0,z:0}));
    assert.deepEqual(hit.normal,{x:0,y:0,z:1});
    nav.position=nav.world({x:0,y:0,z:155});
    const gun=new PlayerCannon();gun.fire(nav,lookAt(nav.position,nav.enemyPosition));
    for(let i=0;i<70;i++)gun.update(.02,nav);
    assert.equal(gun.impacts.length,0);assert.equal(gun.scars.length,1);assert.equal(nav.armorHealth,120);
    assert.equal(gun.scars[0].kind,'hull');
    const snapshot=JSON.stringify(gun);gun.update(0,nav);assert.equal(JSON.stringify(gun),snapshot);
    gun.reset();assert.equal(gun.scars.length,0);
  }
});
test('Persistent impact storage is bounded',()=>{
  const nav=new OrbitNavigation();nav.begin({x:0,y:0});const gun=new PlayerCannon();
  nav.position=nav.world({x:0,y:0,z:80});
  for(let i=0;i<30;i++) {
    gun.rounds=3;gun.cooldown=gun.reloadTime=0;gun.fire(nav,lookAt(nav.position,nav.enemyPosition));
    for(let j=0;j<20;j++)gun.update(.02,nav);
  }
  assert.equal(gun.scars.length,24);
});
