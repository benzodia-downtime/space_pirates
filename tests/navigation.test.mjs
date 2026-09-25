import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitNavigation, ORBIT, HELM, lookAt, relativeHelm, pitchOffsetDegrees } from '../src/navigation.js';
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, a + ' ~= ' + b);
function setup() { const nav = new OrbitNavigation(); nav.begin({ x: 0.31, y: -0.04 }); return nav; }

test('An aligned bow or side view cannot reveal or harpoon the rear ramp through the hull', () => {
  const n = setup();
  for (const angle of [0, Math.PI / 2, -Math.PI / 2]) {
    n.angle = angle; n.updatePosition();
    const view = lookAt(n.position, n.door);
    for (let i = 0; i < 500; i++) n.update(0.02, view);
    assert.equal(n.discovered, false); assert.equal(n.solution.visible, false);
    assert.equal(n.attach(view), null);
  }
});
test('Orbit translates the cockpit at fixed radius without turning or moving the enemy', () => {
  const n = setup(); const center = { ...n.enemyPosition }, yaw = n.enemyYaw, start = { ...n.position };
  n.toggleOrbit();
  let view = lookAt(n.position, n.enemyPosition);
  for (let i = 0; i < 600; i++) {
    const shift = n.update(0.02, view); view.yaw += shift.yaw; view.pitch += shift.pitch;
    near(Math.hypot(n.position.x-center.x, n.position.y-center.y, n.position.z-center.z), ORBIT.radius);
  }
  assert.notDeepEqual(n.position, start); assert.deepEqual(n.enemyPosition, center); assert.equal(n.enemyYaw, yaw);
  const position = { ...n.position }; n.toggleOrbit(); n.update(0.05, view); assert.deepEqual(n.position, position);
  n.reverse(); n.toggleOrbit(); const angle = n.angle; n.update(0.05, view); assert.ok(n.angle < angle);
});
test('Pad up, down, left, right and diagonals steer actual 3D orbital travel without teleporting', () => {
  for (const input of [{x:0,y:-1}, {x:0,y:1}, {x:1,y:0}, {x:-1,y:0}, {x:1,y:-1}, {x:-1,y:1}]) {
    const n = new OrbitNavigation(); n.begin({x:0,y:0}); n.toggleOrbit();
    const start = {...n.position}, center = {...n.enemyPosition};
    const view = lookAt(n.position, n.enemyPosition);
    assert.equal(n.steerOrbit(input, view), true);
    assert.deepEqual(n.position, start, 'Input changes trajectory, not position');
    n.update(.05, view);
    if (input.x) assert.equal(Math.sign(n.position.x - start.x), Math.sign(input.x));
    if (input.y) assert.equal(Math.sign(n.position.y - start.y), -Math.sign(input.y));
    near(lengthFrom(n.position, center), ORBIT.radius);
    near(n.speed, ORBIT.radius * ORBIT.speed);
  }
});
const lengthFrom = (a,b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
test('A released diagonal input retains its plane, radius and target view over complete orbits', () => {
  const n = setup(); n.toggleOrbit();
  let view = lookAt(n.position, n.enemyPosition);
  n.steerOrbit({x:1,y:-1}, view);
  const normal = {...n.orbitNormal}, center = {...n.enemyPosition}, yaw = n.enemyYaw;
  n.steerOrbit({x:0,y:0}, view); // Center/dead zone is not a reset to horizontal.
  for (let i=0; i<3600; i++) {
    const shift = n.update(.02, view); view.yaw += shift.yaw; view.pitch += shift.pitch;
    const p = n.position;
    near(lengthFrom(p, center), ORBIT.radius);
    near((p.x-center.x)*normal.x+(p.y-center.y)*normal.y+(p.z-center.z)*normal.z, 0);
    assert.deepEqual(n.orbitNormal, normal);
    assert.ok(Math.abs(shift.yaw)<.03 && Math.abs(shift.pitch)<.03);
    const forward = {x:Math.sin(view.yaw)*Math.cos(view.pitch), y:-Math.sin(view.pitch), z:-Math.cos(view.yaw)*Math.cos(view.pitch)};
    near((center.x-p.x)*forward.x+(center.y-p.y)*forward.y+(center.z-p.z)*forward.z, ORBIT.radius);
  }
  assert.deepEqual(n.enemyPosition, center); assert.equal(n.enemyYaw, yaw);
});
test('A vertical orbit crosses both poles smoothly, reverses and resumes the selected plane', () => {
  const n = new OrbitNavigation(); n.begin({x:0,y:0}); n.toggleOrbit();
  let view = lookAt(n.position, n.enemyPosition);
  n.steerOrbit({x:0,y:-1}, view);
  const start = {...n.position}, normal = {...n.orbitNormal};
  let maxHeight = 0, minHeight = 0;
  for (let i=0; i<3600; i++) {
    const shift = n.update(.02, view); view.yaw += shift.yaw; view.pitch += shift.pitch;
    assert.ok(Math.abs(shift.yaw)<.01 && Math.abs(shift.pitch)<.01, 'No polar camera flip');
    maxHeight = Math.max(maxHeight, n.position.y-n.enemyPosition.y);
    minHeight = Math.min(minHeight, n.position.y-n.enemyPosition.y);
  }
  assert.ok(maxHeight > ORBIT.radius*.99 && minHeight < -ORBIT.radius*.99);
  n.toggleOrbit(); const parked = {...n.position}; n.update(.05, view);
  assert.deepEqual(n.position, parked);
  assert.equal(n.steerOrbit({x:1,y:0}, view), false);
  n.toggleOrbit(); assert.deepEqual(n.orbitNormal, normal);
  n.reverse();
  for (let i=0; i<3600; i++) {
    const shift = n.update(.02, view); view.yaw += shift.yaw; view.pitch += shift.pitch;
  }
  near(lengthFrom(n.position, start), 0, 1e-6);
  const overPole = {x:3,y:Math.PI/HELM.pitchScale};
  assert.deepEqual(relativeHelm(overPole,0,0), overPole);
  near(relativeHelm(overPole,10,0).y, overPole.y);
});
test('Orbital steering cannot move an inactive, paused or tethered ship', () => {
  const n = setup(), before = {...n.position};
  const view = lookAt(n.position, n.enemyPosition);
  assert.equal(n.steerOrbit({x:1,y:-1}, view), false);
  n.toggleOrbit(); n.steerOrbit({x:0,y:-1}, view); n.update(0,view);
  assert.deepEqual(n.position, before);
  n.forceRear(); const anchored = {...n.position};
  assert.equal(n.steerOrbit({x:0,y:-1}, view), false); n.update(.05,view);
  assert.deepEqual(n.position, anchored);
  n.reset(); assert.equal(n.orbitNormal,null);
});
test('Harpooning after an over-the-top orbit preserves the current camera orientation', () => {
  const n = new OrbitNavigation(); n.begin({x:0,y:0});
  n.angle=Math.PI; n.updatePosition();
  const view={yaw:0,pitch:Math.PI};
  n.inspect(view,.5);
  const attachment=n.attach(view);
  assert.ok(attachment);
  near(attachment.bearing.yaw,view.yaw); near(attachment.bearing.pitch,view.pitch);
});
test('Orbit runs at half the former angular speed', () => {
  const n = new OrbitNavigation(); n.begin({x:0,y:0}); n.toggleOrbit();
  for(let i=0;i<50;i++) n.update(.02,lookAt(n.position,n.enemyPosition));
  near(ORBIT.speed,.19/2); near(n.angle,.095); near(n.speed,ORBIT.radius*.095);
});
test('A shot can launch during orbit and only the impact locks its current position', () => {
  const n = setup(); let view=n.forceRear(true); n.toggleOrbit();
  const firedFrom={...n.position}, normal={...n.orbitNormal};
  assert.ok(n.launch(view));
  const hit={...n.harpoonTarget};
  assert.equal(n.orbiting,true); assert.equal(n.anchor,null);
  assert.equal(n.getState().canHarpoon,false); assert.equal(n.launch(view),null);
  for(let i=0;i<35;i++) {
    const shift=n.update(.02,view); view.yaw+=shift.yaw; view.pitch+=shift.pitch;
  }
  assert.notDeepEqual(n.position,firedFrom); assert.deepEqual(n.orbitNormal,normal);
  const impact={...n.position}, attachment=n.attach(view);
  assert.deepEqual(n.anchor,hit); assert.equal(n.harpoonTarget,null);
  assert.equal(n.orbiting,false); assert.equal(n.speed,0); assert.equal(n.toggleOrbit(),false);
  near(attachment.distance,lengthFrom(impact,hit)-14);
  n.update(.05,view); assert.deepEqual(n.position,impact);
  n.pull(attachment.distance); near(lengthFrom(n.position,impact),0);
  n.pull(attachment.distance-10); assert.equal(n.orbiting,false);
  n.reset(); assert.equal(n.harpoonTarget,null);
});
test('Discovery requires actually looking at the rear, and firing requires a ray hitting its door', () => {
  const n = setup(); n.angle = Math.PI; n.elevation = 0; n.updatePosition();
  const rear = lookAt(n.position, n.door);
  n.inspect({ yaw: rear.yaw + 1, pitch: 0 }, 1); assert.equal(n.discovered, false);
  n.inspect(rear, 0.31); assert.equal(n.discovered, true); assert.equal(n.solution.canFire, true);
  n.inspect({ yaw: rear.yaw + 0.1, pitch: 0 }, 0.3); assert.equal(n.solution.canFire, false);
  assert.equal(n.attach({ yaw: rear.yaw + 0.1, pitch: 0 }), null);
  const before = { ...n.position }; const attachment = n.attach(rear);
  assert.ok(attachment.distance > 50); assert.equal(n.orbiting, false);
  assert.equal(n.toggleOrbit(), false); assert.equal(n.attach(rear), null);
  n.pull(attachment.distance);
  near(n.position.x, before.x); near(n.position.y, before.y); near(n.position.z, before.z);
  n.pull(1.2); near(Math.hypot(n.position.x-n.anchor.x, n.position.y-n.anchor.y, n.position.z-n.anchor.z), 15.2);
});
test('Remembering the ramp does not make it visible or shootable through the hull', () => {
  const n = setup(); n.forceRear(true); assert.equal(n.discovered, true);
  n.angle = 0; n.updatePosition(); n.inspect(lookAt(n.position, n.door));
  assert.equal(n.solution.visible, false); assert.equal(n.solution.canFire, false);
});
test('A fresh pad press keeps any current heading; successive drags accumulate beyond the old clamp', () => {
  const first = { x: 8, y: 0.4 };
  assert.deepEqual(relativeHelm(first, 0, 0), first);
  const next = relativeHelm(first, 20, -10);
  near(next.x, first.x + 20 * HELM.dragRadians / HELM.yawScale);
  assert.deepEqual(relativeHelm(next, 0, 0), next);
  assert.ok(relativeHelm(next, 20, 0).x > next.x);
  assert.ok(Math.abs(relativeHelm(next, 0, 10000).y) <= 3.8);
});
test('Pause and reset stop orbit and clear discovered/tether state', () => {
  const n = setup(); n.toggleOrbit(); const p = { ...n.position };
  n.update(0, lookAt(n.position, n.enemyPosition)); assert.deepEqual(n.position, p);
  n.forceRear(); n.reset();
  assert.equal(n.active, false); assert.equal(n.orbiting, false); assert.equal(n.discovered, false); assert.equal(n.anchor, null);
});

test('Manual flight starts stopped, moves along the view, reverses and stops without drift', () => {
  const n = setup(); const initial = { ...n.position }, enemy = { ...n.enemyPosition };
  for (let i = 0; i < 100; i++) n.move(.02, { yaw: Math.PI / 2, pitch: 0 }, 0);
  assert.deepEqual(n.position, initial); assert.equal(n.speed, 0);
  n.move(.05, { yaw: Math.PI / 2, pitch: 0 }, 1);
  assert.ok(n.position.x > initial.x); near(n.position.z, initial.z);
  n.move(.05, { yaw: Math.PI / 2, pitch: 0 }, -1);
  near(n.position.x, initial.x); near(n.position.z, initial.z);
  assert.ok(n.speed < 0);
  const stopped = { ...n.position };
  for (let i = 0; i < 100; i++) n.move(.02, { yaw: 0, pitch: 1 }, 0);
  assert.deepEqual(n.position, stopped); assert.equal(n.speed, 0);
  assert.deepEqual(n.enemyPosition, enemy);
});
test('Manual thrust cancels orbit without a teleport; restarting orbit keeps the new distance', () => {
  const n = setup(); n.toggleOrbit(); n.update(.05, lookAt(n.position, n.enemyPosition));
  const before = { ...n.position };
  n.move(.05, lookAt(n.position, n.enemyPosition), -1);
  assert.equal(n.orbiting, false);
  assert.ok(Math.hypot(n.position.x-before.x, n.position.y-before.y, n.position.z-before.z) < 2);
  const manual = { ...n.position }, radius = n.radius;
  n.toggleOrbit(); n.update(0, lookAt(n.position, n.enemyPosition));
  near(n.position.x, manual.x); near(n.position.y, manual.y); near(n.position.z, manual.z);
  near(n.radius, radius);
});
test('Normal thrust cannot penetrate the hull or move an attached tether', () => {
  const n = setup();
  for (let i = 0; i < 1000; i++) n.move(.05, lookAt(n.position, n.enemyPosition), 1);
  assert.ok(n.radius >= 85); assert.equal(n.safetyStop, true); assert.equal(n.speed, 0);
  n.forceRear();
  const anchored = { ...n.position };
  n.move(.05, { yaw: 0, pitch: 0 }, -1);
  assert.deepEqual(n.position, anchored); assert.equal(n.speed, 0);
});
test('Far contacts have a fixed world pose before activation, even while reversing', () => {
  const n = new OrbitNavigation();
  n.begin({ x: 0, y: 0 }, { radius: 1100, active: false });
  const enemy = { ...n.enemyPosition };
  n.move(.05, { yaw: 0, pitch: 0 }, -1);
  assert.equal(n.active, false); assert.ok(n.radius > 1100);
  assert.deepEqual(n.enemyPosition, enemy);
});

test('Orbit minimum distance is enforced in navigation, including boundary and retreat', () => {
  const n = setup();
  n.radius = ORBIT.minRadius - .001; n.updatePosition();
  const position = { ...n.position }, angle = n.angle, direction = n.direction;
  assert.equal(n.getState().orbitTooClose, true);
  assert.equal(n.getState().canOrbit, false);
  assert.equal(n.toggleOrbit(), false);
  n.reverse(); n.update(.05, lookAt(n.position, n.enemyPosition));
  assert.deepEqual(n.position, position);
  assert.equal(n.angle, angle); assert.equal(n.direction, direction);
  n.move(.05, lookAt(n.position, n.enemyPosition), -1);
  assert.ok(n.radius > ORBIT.minRadius);
  assert.equal(n.canOrbit, true); assert.equal(n.toggleOrbit(), true);
  n.toggleOrbit();
  n.radius = ORBIT.minRadius; n.updatePosition();
  assert.equal(n.orbitTooClose, false); assert.equal(n.toggleOrbit(), true);
  // A stop command must never be rejected, even if clearance changed.
  n.radius = ORBIT.minRadius - 1;
  assert.equal(n.toggleOrbit(), true); assert.equal(n.orbiting, false);
  assert.equal(n.toggleOrbit(), false);
});

test('Clearance alone cannot enable orbit before contact or after harpoon attachment', () => {
  const n = new OrbitNavigation();
  n.begin({ x: 0, y: 0 }, { radius: 220, active: false });
  assert.equal(n.canOrbit, false); assert.equal(n.toggleOrbit(), false);
  n.active = true; n.forceRear();
  assert.ok(n.anchor); assert.equal(n.canOrbit, false);
  assert.equal(n.toggleOrbit(), false);
});

test('Radar pitch is relative to the current view: positive up, negative down, zero aligned', () => {
  const r = degrees => degrees * Math.PI / 180;
  near(pitchOffsetDegrees(0, r(-12)), 12);
  near(pitchOffsetDegrees(0, r(12)), -12);
  near(pitchOffsetDegrees(r(25), r(10)), 15);
  near(pitchOffsetDegrees(r(-35), r(10)), -45);
  near(pitchOffsetDegrees(r(60), r(60)), 0);
  near(pitchOffsetDegrees(r(-68), r(80)), -148);
  near(pitchOffsetDegrees(r(68), r(-80)), 148);
  const above = lookAt({x:0,y:0,z:0}, {x:0,y:10,z:-10});
  const below = lookAt({x:0,y:0,z:0}, {x:0,y:-10,z:-10});
  near(pitchOffsetDegrees(0, above.pitch), 45);
  near(pitchOffsetDegrees(0, below.pitch), -45);
});
test('Tether corrections persist into the ram, shift its physical landing ray, and release without teleport',()=>{
  const n=setup(),view=n.forceRear(),p={...n.position};
  n.pull(n.tetherDistance);near(lengthFrom(n.position,p),0);near(n.landingError(view),0,1e-7);
  n.correct(3,4);n.pull(n.tetherDistance);near(lengthFrom(n.position,p),5);near(n.landingError(view),5,1e-7);
  n.pull(4);near(n.landingError(view),5,1e-7);
  n.correct(0,0);n.pull(4);near(n.landingError(view),0,1e-7);
  n.correct(100,-100);assert.deepEqual(n.correction,{x:14,y:-14});
  n.pull(80);const released={...n.position};n.releaseTether();
  assert.equal(n.anchor,null);assert.equal(n.harpoonTarget,null);assert.equal(n.canOrbit,true);
  assert.deepEqual(n.position,released);n.update(0,view);assert.deepEqual(n.position,released);
  n.reset();assert.deepEqual(n.correction,{x:0,y:0});
});
