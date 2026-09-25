import test from 'node:test';
import assert from 'node:assert/strict';
import { AssaultSequence, ASSAULT_CONFIG as C } from '../src/assault.js';

function advance(sequence, seconds) { for (let t = 0; t < seconds; t += 0.02) sequence.update(0.02); }
function tethered(distance = 112) {
  const a = new AssaultSequence(); a.begin();
  a.fireHarpoon({ distance, bearing: { yaw: 1.2, pitch: 0.02 } });
  advance(a, 1); return a;
}

test('Straight flight / waiting never finds an entry or triggers an assault', () => {
  const a = new AssaultSequence(); a.begin(); advance(a, 90);
  assert.equal(a.stage, 'survey'); assert.equal(a.ram, 0);
  assert.equal(a.canCommit(), false); assert.equal(a.commit(), false);
  assert.equal(a.fireHarpoon(null), false);
});
test('Harpoon needs a valid solution, flies first, and waits indefinitely for another input', () => {
  const a = new AssaultSequence(); a.begin();
  assert.equal(a.fireHarpoon({ distance: NaN }), false);
  assert.equal(a.fireHarpoon({ distance: 1 }), false);
  a.fireHarpoon({ distance: 100, bearing: { yaw: 2, pitch: 0 } });
  assert.equal(a.commit(), false);
  advance(a, 0.4); assert.equal(a.stage, 'harpoon');
  advance(a, 90); assert.equal(a.stage, 'tethered');
  assert.equal(a.distance, 100); assert.equal(a.harpoon, 1);
  assert.equal(a.committed, false); assert.equal(a.fireHarpoon({ distance: 100 }), false);
});
test('Separate confirmation pulls from the actual tether length and preserves the locked bearing', () => {
  const a = tethered(138);
  assert.equal(a.commit(), true); assert.deepEqual(a.attackBearing, { yaw: 1.2, pitch: 0.02 });
  assert.equal(a.commit(), false);
  const stages = [a.stage]; let previous = a.distance;
  for (let i = 0; i < 900; i++) {
    a.update(0.02);
    if (stages.at(-1) !== a.stage) stages.push(a.stage);
    assert.ok(a.distance <= previous && a.distance >= C.seatedDistance); previous = a.distance;
    assert.ok(a.progress >= 0 && a.progress <= 1);
  }
  assert.deepEqual(stages, ['ram-deploy','charge','impact','clamp','seal','pressurize','ready']);
  assert.equal(a.breach, 1); assert.equal(a.clamps, 1); assert.equal(a.pressure, 1);
});
test('Contact holds before tearing, then claws and sealing precede pressure', () => {
  const a = tethered(); a.commit();
  while (a.stage !== 'impact') a.update(0.02);
  assert.equal(a.distance, C.contactDistance);
  a.update(0.05); a.update(0.05);
  assert.equal(a.distance, C.contactDistance); assert.equal(a.breach, 0);
  while (a.stage !== 'pressurize') a.update(0.02);
  assert.equal(a.seal, 1); assert.equal(a.clamps, 1); assert.equal(a.pressure, 0);
});
test('Paused time cannot advance a cutscene; large deltas cannot skip beats', () => {
  const a = tethered(); a.commit(); const snapshot = JSON.stringify(a);
  a.update(0); assert.equal(JSON.stringify(a), snapshot);
  a.update(300); assert.equal(a.stage, 'ram-deploy'); assert.ok(a.elapsed <= 0.05);
});
test('Reset clears tether, damage, effects, and helm lock', () => {
  const a = tethered(); a.commit(); advance(a, 20); a.reset();
  assert.equal(a.stage, 'inactive'); assert.equal(a.harpoon, 0); assert.equal(a.tetherBearing, null);
  assert.equal(a.breach, 0); assert.equal(a.ram, 0); assert.equal(a.clamps, 0);
  assert.equal(a.seal, 0); assert.equal(a.pressure, 0); assert.equal(a.committed, false); assert.equal(a.impactAge, -1);
});
