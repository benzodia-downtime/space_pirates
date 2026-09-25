import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitNavigation, ORBIT, HELM, lookAt, relativeHelm } from '../src/navigation.js';
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
