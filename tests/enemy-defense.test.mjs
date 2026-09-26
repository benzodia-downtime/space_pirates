import test from 'node:test';
import assert from 'node:assert/strict';
import {EnemyDefense,DEFENSE,GUN_MOUNTS} from '../src/enemy-defense.js';
import {OrbitNavigation,ORBIT,FLIGHT,lookAt} from '../src/navigation.js';
const setup=()=>{const nav=new OrbitNavigation();nav.begin({x:0,y:0});return {nav,enemy:new EnemyDefense()};};
const advance=(enemy,nav,seconds)=>{for(let t=0;t<seconds;t+=.02)enemy.update(.02,nav);};

test('Defensive yaw is slower than player orbit and alternates turns with a real opening',()=>{
  const {nav,enemy}=setup();nav.angle=1.2;nav.radius=1500;nav.updatePosition();
  const p={...nav.position},center={...nav.enemyPosition};
  advance(enemy,nav,3);
  assert.ok(nav.enemyYaw>0);assert.ok(nav.enemyYaw<3.1*DEFENSE.turnRate);
  assert.ok(DEFENSE.turnRate<ORBIT.speed);
  assert.deepEqual(nav.position,p);assert.notDeepEqual(nav.enemyPosition,center);
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
test('Dorsal turret covers 360 degrees and overhead, including a rotated enemy hull',()=>{
  for(const yaw of [0,1.3]) for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI,-Math.PI/2]) {
    const {nav,enemy}=setup();nav.setEnemyYaw(yaw);nav.angle=angle;nav.updatePosition();
    assert.equal(enemy.inArc(nav,'dorsal'),true);
    while(!enemy.shots)enemy.update(.02,nav);assert.equal(enemy.shots,1);
    assert.equal(enemy.mount,enemy.inArc(nav,'bow')?'bow':enemy.inArc(nav,'stern')?'stern':'dorsal');
    const bolt=enemy.bolts[0],pivot=nav.world(GUN_MOUNTS[enemy.mount]);
    const d={x:enemy.aimPoint.x-pivot.x,y:enemy.aimPoint.y-pivot.y,z:enemy.aimPoint.z-pivot.z};
    const length=Math.hypot(d.x,d.y,d.z),muzzle=enemy.muzzle(nav);
    for(const axis of ['x','y','z']) {
      assert.ok(Math.abs(bolt.direction[axis]-d[axis]/length)<1e-8);
      assert.ok(Math.abs(muzzle[axis]-pivot[axis]-d[axis]/length*6)<1e-8);
    }
  }
  const {nav,enemy}=setup();nav.elevation=Math.PI/2;nav.updatePosition();
  advance(enemy,nav,5.2);assert.equal(enemy.mount,'dorsal');assert.equal(enemy.shots,1);
});
test('Turrets do not shoot through their own hull or beyond range',()=>{
  for(const pose of [{angle:0,elevation:-Math.PI/2},{angle:Math.PI,elevation:-.6},{angle:0,elevation:0,radius:1500}]) {
    const {nav,enemy}=setup();Object.assign(nav,pose);nav.updatePosition();
    advance(enemy,nav,8);assert.equal(enemy.shots,0);assert.equal(enemy.hull,100);
  }
});
test('Side-to-rear tracking retains its charge and locked turret cannot home or switch mounts',()=>{
  const {nav,enemy}=setup();nav.angle=Math.PI/2;nav.updatePosition();enemy.cooldown=0;
  advance(enemy,nav,.8);assert.equal(enemy.mount,'dorsal');const time=enemy.gunTime;
  nav.angle=Math.PI;nav.updatePosition();enemy.update(.02,nav);assert.ok(enemy.gunTime>time);
  while(enemy.gunPhase!=='locked')enemy.update(.02,nav);
  const target={...enemy.aimPoint},muzzle=enemy.muzzle(nav);
  nav.angle=0;nav.updatePosition();advance(enemy,nav,1.3);
  assert.equal(enemy.mount,'stern');assert.deepEqual(enemy.aimPoint,target);assert.notDeepEqual(enemy.muzzle(nav),muzzle);
  assert.equal(enemy.shots,1);
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
test('Pause freezes AI; idle attachment arrests the hull and starts no attacks',()=>{
  const {nav,enemy}=setup();advance(enemy,nav,1);
  const snapshot=JSON.stringify(enemy);enemy.update(0,nav);assert.equal(JSON.stringify(enemy),snapshot);
  nav.forceRear();enemy.update(.02,nav);
  assert.equal(enemy.phase,'tethered');assert.equal(enemy.aimPoint,null);assert.equal(enemy.bolts.length,0);
  const yaw=nav.enemyYaw,shots=enemy.shots,hull=enemy.hull;advance(enemy,nav,20);assert.equal(nav.enemyYaw,yaw);
  assert.equal(enemy.shots,shots);assert.equal(enemy.hull,hull);
  enemy.update(.02,nav,{breached:true});
  assert.equal(enemy.phase,'breached');assert.equal(enemy.bolts.length,0);assert.equal(enemy.aimPoint,null);
  enemy.reset();assert.equal(enemy.hull,100);assert.equal(enemy.shots,0);
});
test('Attachment finishes exactly one queued focused/fan salvo and preserves flying rounds',()=>{
  for(const pattern of ['focused','fan']) for(const phase of ['aim','locked','fired']) {
    const {nav,enemy}=setup();
    nav.forceRear(true);enemy.shots=pattern==='fan'?1:0;enemy.cooldown=0;
    for(let i=0;i<400 && !(phase==='fired'?enemy.bolts.length:enemy.gunPhase===phase);i++) enemy.update(.02,nav);
    assert.ok(phase==='fired'?enemy.bolts.length:enemy.gunPhase===phase);
    const shots=enemy.shots,hull=enemy.hull,target={...enemy.aimPoint},gun=enemy.mount,time=enemy.gunTime;
    assert.ok(nav.attach(lookAt(nav.position,nav.door)));enemy.update(.02,nav);
    assert.deepEqual(enemy.aimPoint,target);assert.equal(enemy.mount,gun);
    if(phase==='fired')assert.ok(enemy.bolts.length>0);
    else {assert.equal(enemy.getState().finishingAttack,true);assert.ok(enemy.gunTime>=time);}
    const center={...nav.enemyPosition},yaw=nav.enemyYaw;
    advance(enemy,nav,12);
    assert.equal(enemy.shots,shots+(phase==='fired'?0:1));assert.equal(enemy.hull,hull-25);
    assert.deepEqual(nav.enemyPosition,center);assert.equal(nav.enemyYaw,yaw);assert.equal(enemy.getState().finishingAttack,false);
    nav.releaseTether();nav.angle=0;nav.elevation=0;nav.updatePosition();
    advance(enemy,nav,8);assert.ok(enemy.shots>shots);assert.notEqual(enemy.phase,'tethered');
  }
});
test('Fan telegraph becomes nine horizontal non-homing rounds, one damage event per volley',()=>{
  const {nav,enemy}=setup();enemy.shots=1;enemy.cooldown=0;
  while(enemy.gunPhase!=='locked')enemy.update(.02,nav);
  assert.equal(enemy.pattern,'fan');
  const directions=enemy.directions(nav);
  assert.equal(directions.length,9);
  for(const d of directions) {assert.ok(Math.abs(Math.hypot(d.x,d.y,d.z)-1)<1e-9);assert.equal(d.y,directions[4].y);}
  assert.ok(directions[0].x*directions[8].x<0);
  advance(enemy,nav,1.3);assert.equal(enemy.bolts.length,9);
  // Even overlapping rounds from a close volley can only apply one hit.
  enemy.bolts.forEach(b=>{b.position={...nav.position};});enemy.previousPlayer={...nav.position};
  enemy.update(.02,nav);assert.equal(enemy.hull,75);assert.equal(enemy.hits,1);
});
test('Locked salvo and reload freeze enemy heading and defensive turn clock',()=>{
  const {nav,enemy}=setup();nav.angle=.5;nav.updatePosition();
  while(enemy.gunPhase!=='locked')enemy.update(.02,nav);
  const yaw=nav.enemyYaw,time=enemy.turnTime;
  advance(enemy,nav,DEFENSE.lockSeconds+DEFENSE.reloadSeconds-.2);
  assert.equal(nav.enemyYaw,yaw);assert.equal(enemy.turnTime,time);assert.equal(enemy.turning,0);
});
test('An upward dodge clears the entire horizontal fan',()=>{
  const {nav,enemy}=setup();enemy.shots=1;enemy.cooldown=0;
  while(enemy.gunPhase!=='locked')enemy.update(.02,nav);
  nav.elevation=.3;nav.updatePosition();advance(enemy,nav,4);
  assert.equal(enemy.hull,100);
});
test('Moving and rotating rear ramp carries the in-flight harpoon target; tether arrests the hull',()=>{
  const {nav}=setup();const view=nav.forceRear(true);nav.launch(view);
  const hit={...nav.harpoonTarget},player={...nav.position};nav.setEnemyYaw(.025);
  nav.setEnemyPosition({x:10,y:2,z:-150});
  assert.notDeepEqual(nav.harpoonTarget,hit);assert.deepEqual(nav.harpoonTarget,nav.world(nav.harpoonLocalTarget));
  assert.deepEqual(nav.position,player);
  nav.attach(view);const yaw=nav.enemyYaw;nav.setEnemyYaw(.2);assert.equal(nav.enemyYaw,yaw);
  const center={...nav.enemyPosition};nav.setEnemyPosition({x:0,y:0,z:0});assert.deepEqual(nav.enemyPosition,center);
});

test('Rear turret is a distinct rear-facing mount and prioritised behind rotated ships',()=>{
  assert.ok(GUN_MOUNTS.stern.z<-35);assert.ok(GUN_MOUNTS.stern.y>10.5);
  for(const yaw of [0,1.3,-2.4]) {
    const {nav,enemy}=setup();nav.setEnemyYaw(yaw);
    for(const [angle,mount] of [[0,'bow'],[Math.PI,'stern'],[Math.PI-.4,'stern'],[Math.PI/2,'dorsal']]) {
      nav.angle=angle;nav.updatePosition();assert.equal(enemy.selectMount(nav),mount);
    }
    nav.angle=Math.PI;nav.updatePosition();advance(enemy,nav,6);
    assert.equal(enemy.mount,'stern');assert.equal(enemy.hits,1);assert.equal(enemy.hull,75);
  }
});

test('Weapon range doubles again; actual rounds reach 1200m from all three mounts',()=>{
  assert.equal(FLIGHT.surveyDistance,440);assert.equal(DEFENSE.range,600*2);
  for(const [angle,mount] of [[0,'bow'],[Math.PI,'stern'],[Math.PI/2,'dorsal']]) {
    const {nav,enemy}=setup();nav.radius=1200;nav.angle=angle;nav.updatePosition();
    assert.equal(enemy.selectMount(nav),mount);advance(enemy,nav,11);
    assert.equal(enemy.mount,mount);assert.equal(enemy.shots,1);assert.equal(enemy.hits,1,'Round must arrive before its lifetime expires');
    assert.equal(enemy.hull,75);
    enemy.reset();nav.radius=1200.01;nav.updatePosition();
    assert.equal(enemy.selectMount(nav),null);advance(enemy,nav,8);assert.equal(enemy.shots,0);
  }
});

test('Enemy orbit preserves range and player position, caps speed, and follows a moving centre',()=>{
  for(const radius of [155,440,1200]) {
    const {nav,enemy}=setup();nav.radius=radius;nav.elevation=.3;nav.updatePosition();
    const player={...nav.position},start={...nav.enemyPosition};
    for(let i=0;i<100;i++) {
      const before={...nav.enemyPosition};enemy.update(.02,nav);
      assert.ok(Math.hypot(...['x','y','z'].map(a=>nav.enemyPosition[a]-before[a]))<=DEFENSE.orbitSpeed*.02+1e-8);
    }
    assert.notDeepEqual(nav.enemyPosition,start);assert.equal(nav.enemyPosition.y,start.y);
    assert.deepEqual(nav.position,player);assert.ok(Math.abs(nav.radius-radius)<1e-8);
    const view=lookAt(nav.position,nav.enemyPosition);nav.move(.02,view,1);
    const closer=nav.radius,moved={...nav.position};assert.ok(closer<radius);
    enemy.update(.02,nav);assert.ok(Math.abs(nav.radius-closer)<1e-8);assert.deepEqual(nav.position,moved);
    const centre={...nav.enemyPosition};enemy.update(0,nav);assert.deepEqual(nav.enemyPosition,centre);
  }
});

test('Queued aim keeps its target through pulling and a breach; new shots remain suppressed',()=>{
  const {nav,enemy}=setup();nav.forceRear(true);enemy.cooldown=0;enemy.update(.02,nav);
  const aim={...enemy.aimPoint};assert.ok(nav.attach(lookAt(nav.position,nav.door)));
  nav.pull(20);
  for(let i=0;i<170;i++)enemy.update(.02,nav,{breached:true});
  assert.deepEqual(enemy.aimPoint,aim);assert.equal(enemy.shots,1);assert.equal(enemy.phase,'breached');
  advance(enemy,nav,8);assert.equal(enemy.shots,1);
});

test('Inclined player orbit stays smooth while its enemy centre moves',()=>{
  const {nav,enemy}=setup();nav.radius=1500;nav.updatePosition();nav.toggleOrbit();
  let view=lookAt(nav.position,nav.enemyPosition);nav.steerOrbit({x:.4,y:-1},view);
  for(let i=0;i<1000;i++) {
    const before={...nav.position},shift=nav.update(.02,view);view.yaw+=shift.yaw;view.pitch+=shift.pitch;
    enemy.update(.02,nav);
    assert.ok(Math.abs(nav.radius-1500)<1e-7);
    assert.ok(Math.hypot(...['x','y','z'].map(a=>nav.position[a]-before[a]))<1500*ORBIT.speed*.02+1e-8);
    const n=nav.orbitNormal,r={x:nav.position.x-nav.enemyPosition.x,y:nav.position.y-nav.enemyPosition.y,z:nav.position.z-nav.enemyPosition.z};
    assert.ok(Math.abs(n.x*r.x+n.y*r.y+n.z*r.z)<1e-7);
  }
});
