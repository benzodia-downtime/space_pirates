import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerCannon,SIEGE,traceCannon} from '../src/player-cannon.js';
import {OrbitNavigation,lookAt} from '../src/navigation.js';
import {EnemyDefense} from '../src/enemy-defense.js';
function fixture(yaw=0) {
  const nav=new OrbitNavigation();nav.begin({x:0,y:0});nav.setEnemyYaw(yaw);
  const view=nav.forceRear(true,false),gun=new PlayerCannon();return {nav,view,gun};
}
const advance=(gun,nav,seconds,options={})=>{const events=[];for(let i=0;i<Math.round(seconds/.02);i++)events.push(...gun.update(.02,nav,options));return events;};
test('A discovered sealed rear ramp refuses launch until six physical hits expose it',()=>{
  const {nav,view,gun}=fixture();
  assert.equal(nav.discovered,true);assert.equal(nav.inspect(view).canFire,false);assert.equal(nav.launch(view),null);
  gun.fire(nav,view);assert.equal(nav.armorHealth,120,'Firing is not an instant hit');
  advance(gun,nav,.2);assert.equal(nav.armorHealth,120);
  advance(gun,nav,1.2,{view,trigger:true});assert.equal(gun.shots,3);assert.equal(nav.armorHealth,60);
  assert.equal(nav.launch(view),null);assert.equal(gun.rounds,0);
  advance(gun,nav,2);assert.equal(gun.rounds,0,'Cannot skip the reload');
  const events=advance(gun,nav,2.5,{view,trigger:true});
  assert.equal(gun.shots,6);assert.equal(gun.armorHits,6);assert.equal(nav.armorHealth,0);
  assert.equal(events.filter(e=>e==='armor-break').length,1);assert.equal(nav.armorScars.length,6);
  assert.ok(nav.launch(view));assert.ok(nav.attach(view));assert.equal(gun.fire(nav,view),false);
});
test('Nearest swept collision only damages the exposed rear face, including rotated ships',()=>{
  for(const yaw of [0,.8,-2.2]) {
    const {nav}=fixture(yaw);
    const trace=(a,b)=>traceCannon(nav,nav.world(a),nav.world(b));
    assert.equal(trace({x:0,y:0,z:-200},{x:0,y:0,z:50}).kind,'armor');
    for(const [a,b] of [
      [{x:0,y:0,z:200},{x:0,y:0,z:-100}],
      [{x:200,y:0,z:0},{x:0,y:0,z:-54}],
      [{x:0,y:100,z:-54},{x:0,y:0,z:-54}],
      [{x:6,y:0,z:-200},{x:6,y:0,z:0}],
    ])assert.equal(trace(a,b).kind,'hull');
    assert.equal(trace({x:70,y:0,z:-200},{x:70,y:0,z:100}),null);
    nav.damageArmor(120,{x:0,y:0,z:-55});
    const ramp=trace({x:0,y:0,z:-200},{x:0,y:0,z:0});
    assert.equal(ramp.kind,'hull');assert.ok(ramp.point.z>-52,'Inner ramp is still solid for the ram');
  }
});
test('Wrong facing, empty space and out-of-range shots cannot damage the rear',()=>{
  for(const position of [{x:0,y:0,z:155},{x:155,y:0,z:0},{x:0,y:0,z:-400}]) {
    const {nav,gun}=fixture();nav.position=nav.world(position);
    const view=lookAt(nav.position,nav.door);gun.fire(nav,view);advance(gun,nav,1);
    assert.equal(nav.armorHealth,120);assert.equal(gun.bolts.length,0);
  }
  const {nav,view,gun}=fixture();gun.fire(nav,{yaw:view.yaw+.5,pitch:0});advance(gun,nav,1);
  assert.equal(nav.armorHealth,120);
});
test('Projectile flight is unguided and damage follows actual intersections, not stored aim',()=>{
  const {nav,view,gun}=fixture();gun.fire(nav,view);const direction={...gun.bolts[0].direction};
  nav.setEnemyYaw(1.5);advance(gun,nav,.1);
  assert.deepEqual(gun.bolts[0].direction,direction);advance(gun,nav,1);assert.equal(nav.armorHealth,120);
});
test('Cadence, automatic reload, release, pause and disable cannot create extra shots',()=>{
  const {nav,view,gun}=fixture();
  assert.ok(gun.fire(nav,view));assert.equal(gun.fire(nav,view),false);
  advance(gun,nav,1,{view,trigger:true});assert.equal(gun.shots,3);
  const reload=gun.reloadTime,snapshot=JSON.stringify(gun);gun.update(0,nav,{view,trigger:true});assert.equal(JSON.stringify(gun),snapshot);
  advance(gun,nav,3);assert.equal(gun.shots,3);assert.ok(gun.reloadTime<reload);assert.equal(gun.rounds,0);
  advance(gun,nav,.6);assert.equal(gun.rounds,3);assert.equal(gun.shots,3);
  gun.fire(nav,view);assert.equal(gun.shots,4);gun.update(.02,nav,{view,trigger:true,enabled:false});assert.equal(gun.bolts.length,0);assert.equal(gun.shots,4);
  gun.reset();assert.equal(gun.rounds,SIEGE.magazine);assert.equal(gun.shots,0);assert.equal(gun.impacts.length,0);
});
test('Damage persists through retreat, orbit, yaw and a failed tether; a new enemy resets it',()=>{
  const {nav,view,gun}=fixture();gun.fire(nav,view);advance(gun,nav,.6);assert.equal(nav.armorHealth,100);
  for(let i=0;i<50;i++)nav.move(.02,view,-1);
  nav.toggleOrbit();nav.update(.02,view);nav.setEnemyYaw(.3);nav.releaseTether();
  assert.equal(nav.armorHealth,100);assert.equal(nav.armorScars.length,1);
  nav.begin({x:0,y:0});assert.equal(nav.armorHealth,120);assert.deepEqual(nav.armorScars,[]);assert.equal(nav.armorBreakAge,-1);
});
test('Surrounding deck blocks oblique harpoons even after armor is gone',()=>{
  const {nav}=fixture();nav.damageArmor(120,{x:0,y:0,z:-55});
  nav.position=nav.world({x:44,y:0,z:-155});
  let view=lookAt(nav.position,nav.world({x:3.6,y:0,z:-51}));
  const blocked=nav.inspect(view,.5);assert.ok(blocked.incidence>=.9);assert.equal(blocked.canFire,false);
  view=lookAt(nav.position,nav.door);assert.equal(nav.inspect(view,.5).canFire,true);
});
test('Breaking armor does not stop fire or yaw; only a lodged harpoon cancels counterfire',()=>{
  const {nav,gun}=fixture(),enemy=new EnemyDefense();
  nav.damageArmor(120,{x:0,y:0,z:-55});
  for(let i=0;i<270;i++)enemy.update(.02,nav);
  assert.equal(enemy.shots,1);assert.ok(enemy.bolts.length>0);assert.notEqual(nav.enemyYaw,0);assert.equal(nav.anchor,null);
  const view=lookAt(nav.position,nav.door);assert.ok(nav.attach(view));enemy.update(.02,nav);
  assert.equal(enemy.phase,'tethered');assert.equal(enemy.bolts.length,0);assert.equal(enemy.aimPoint,null);
  const yaw=nav.enemyYaw;for(let i=0;i<500;i++)enemy.update(.02,nav);
  assert.equal(enemy.shots,1);assert.equal(nav.enemyYaw,yaw);assert.equal(gun.fire(nav,view),false);
});
