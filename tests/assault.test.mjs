import test from 'node:test';
import assert from 'node:assert/strict';
import { AssaultSequence, ASSAULT_CONFIG as C } from '../src/assault.js';

function advance(sequence, seconds, error = 0) {
  for (let t = 0; t < seconds; t += 0.02) sequence.update(0.02, error);
}
function armed() { const a = new AssaultSequence(); a.begin(); advance(a, 20); return a; }

test('Approach never becomes an automatic attack, even when held perfectly aligned', () => {
  const a = armed();
  assert.equal(a.stage, 'armed');
  advance(a, 90);
  assert.equal(a.distance, C.stagingDistance);
  assert.equal(a.ram, 0);
  assert.equal(a.committed, false);
});

test('Misalignment prevents approach and invalidates the attack window', () => {
  const a = new AssaultSequence(); a.begin(); advance(a, 25, 0.8);
  assert.equal(a.stage, 'intercept');
  assert.ok(a.distance >= C.startDistance);
  const b = armed();
  assert.equal(b.commit(0.3, { x: 0.2, y: 0 }), false);
  b.update(0.02, 0.3);
  assert.equal(b.canCommit(0), false);
  advance(b, C.aimHoldSeconds + 0.04);
  assert.equal(b.canCommit(0), true);
});

test('One confirmation locks a heading and runs all stages in order', () => {
  const a = armed(); const bearing = { x: 0.3, y: -0.1 };
  assert.equal(a.commit(0, bearing), true);
  bearing.x = 99;
  assert.equal(a.attackBearing.x, 0.3);
  assert.equal(a.commit(0, bearing), false);
  const stages = [a.stage];
  for (let i = 0; i < 900; i++) {
    a.update(0.02, 5); // Inputs no longer alter the committed attack.
    if (stages.at(-1) !== a.stage) stages.push(a.stage);
    assert.ok(a.distance >= C.seatedDistance);
    assert.ok(a.progress >= 0 && a.progress <= 1);
  }
  assert.deepEqual(stages, ['ram-deploy','charge','impact','clamp','seal','pressurize','ready']);
  assert.equal(a.breach, 1); assert.equal(a.clamps, 1); assert.equal(a.pressure, 1);
});

test('Impact holds on contact before penetration and pressure follows sealing', () => {
  const a = armed(); a.commit(0, { x: 0, y: 0 });
  while (a.stage !== 'impact') a.update(0.02, 0);
  assert.equal(a.distance, C.contactDistance);
  a.update(0.05, 0); a.update(0.05, 0);
  assert.equal(a.distance, C.contactDistance);
  assert.equal(a.breach, 0);
  while (a.stage !== 'pressurize') a.update(0.02, 0);
  assert.equal(a.seal, 1); assert.equal(a.clamps, 1); assert.equal(a.pressure, 0);
});

test('Zero simulation time cannot advance a cutscene; a large delta cannot skip it', () => {
  const a = armed(); a.commit(0, { x: 0, y: 0 });
  const snapshot = JSON.stringify(a);
  a.update(0, 0); assert.equal(JSON.stringify(a), snapshot);
  a.update(300, 0); assert.equal(a.stage, 'ram-deploy'); assert.ok(a.elapsed <= 0.05);
});

test('New searches reset all damage, effects, progress and helm lock', () => {
  const a = new AssaultSequence(); a.forceReady({ x: -0.3, y: 0 });
  assert.equal(a.stage, 'ready'); a.reset();
  assert.equal(a.stage, 'inactive'); assert.equal(a.breach, 0); assert.equal(a.ram, 0);
  assert.equal(a.clamps, 0); assert.equal(a.seal, 0); assert.equal(a.pressure, 0);
  assert.equal(a.committed, false); assert.equal(a.impactAge, -1);
});
