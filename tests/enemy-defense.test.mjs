import test from 'node:test';
import assert from 'node:assert/strict';
import {EnemyDefense,DEFENSE} from '../src/enemy-defense.js';
import {OrbitNavigation,ORBIT,lookAt} from '../src/navigation.js';
const setup=()=>{const nav=new OrbitNavigation();nav.begin({x:0,y:0});return {nav,enemy:new EnemyDefense()};};
const advance=(enemy,nav,seconds)=>{for(let t=0;t<seconds;t+=.02)enemy.update(.02,nav);};

test('Defensive yaw is slower than player orbit and alternates turns with a real opening',()=>{
  const {nav,enemy}=setup();nav.angle=.7;nav.updatePosition();
  const p={...nav.position},center={...nav.enemyPosition};
  advance(enemy,nav,3);
  assert.ok(nav.enemyYaw>0);assert.ok(nav.enemyYaw<3.1*DEFENSE.turnRate);
  assert.ok(DEFENSE.turnRate<ORBIT.speed);
  assert.deepEqual(nav.position,p);assert.deepEqual(nav.enemyPosition,center);
  advance(enemy,nav,1.1);assert.equal(enemy.phase,'hold');
  const yaw=nav.enemyYaw;advance(enemy,nav,4);assert.equal(nav.enemyYaw,yaw);
});
test('Continuous orbital movement gains the rear despite enemy defence',()=>{
  const {nav,enemy}=setup();nav.toggleOrbit();let view=lookAt(nav.position,nav.enemyPosition), rear=false;
  for(let i=0;i<4000;i++) {
    const shift=nav.update(.02,view);view.yaw+=shift.yaw;view.pitch+=shift.pitch;
    enemy.update(.02,nav);
    if(Math.abs(nav.angle)>3){rear=true;break;}
  }
  assert.ok(rear);assert.ok(enemy.hull>0);
});
test('Turret has no rear or overhead firing solution, and stays asleep at long range',()=>{
  for(const pose of [{angle:Math.PI,elevation:0},{angle:0,elevation:1},{angle:0,elevation:0,radius:800}]) {
    const {nav,enemy}=setup();Object.assign(nav,pose);nav.updatePosition();
    advance(enemy,nav,8);assert.equal(enemy.shots,0);assert.equal(enemy.hull,100);
  }
});
test('Charging tracks, then locks a point for a full dodge window; fired bolts do not home',()=>{
  const {nav,enemy}=setup();
  while(enemy.gunPhase!=='locked')enemy.update(.02,nav);
  const target={...enemy.aimPoint};
  assert.equal(enemy.shots,0);
  nav.elevation=.5;nav.updatePosition(); // Move out of the frozen line of fire.
  advance(enemy,nav,DEFENSE.lockSeconds-.1);
  assert.deepEqual(enemy.aimPoint,target);assert.equal(enemy.shots,0);
  advance(enemy,nav,.2);assert.equal(enemy.shots,1);
  const direction={...enemy.bolts[0].direction};advance(enemy,nav,.4);
  assert.deepEqual(enemy.bolts[0].direction,direction);
  advance(enemy,nav,2);assert.equal(enemy.hull,100);
});
test('Ignoring a telegraphed shot damages hull and four hits defeat the ship',()=>{
  const {nav,enemy}=setup();advance(enemy,nav,32);
  assert.equal(enemy.hits,4);assert.equal(enemy.hull,0);assert.equal(enemy.defeated,true);
  assert.equal(enemy.bolts.length,0);assert.equal(enemy.gunPhase,'idle');
});
test('Pause, reset and tether ceasefire cover both aiming and projectiles',()=>{
  const {nav,enemy}=setup();advance(enemy,nav,5.1);
  const snapshot=JSON.stringify(enemy);enemy.update(0,nav);assert.equal(JSON.stringify(enemy),snapshot);
  nav.forceRear();enemy.update(.02,nav);
  assert.equal(enemy.phase,'tethered');assert.equal(enemy.bolts.length,0);assert.equal(enemy.aimPoint,null);
  const yaw=nav.enemyYaw;advance(enemy,nav,20);assert.equal(nav.enemyYaw,yaw);
  enemy.reset();assert.equal(enemy.hull,100);assert.equal(enemy.shots,0);
});
test('Rotating rear ramp carries the in-flight harpoon target; tether arrests the hull',()=>{
  const {nav}=setup();const view=nav.forceRear(true);nav.launch(view);
  const hit={...nav.harpoonTarget},player={...nav.position};nav.setEnemyYaw(.025);
  assert.notDeepEqual(nav.harpoonTarget,hit);assert.deepEqual(nav.harpoonTarget,nav.world(nav.harpoonLocalTarget));
  assert.deepEqual(nav.position,player);
  nav.attach(view);const yaw=nav.enemyYaw;nav.setEnemyYaw(.2);assert.equal(nav.enemyYaw,yaw);
});
