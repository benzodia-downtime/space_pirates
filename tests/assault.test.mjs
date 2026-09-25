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
test('Tether impact updates the pull distance and bearing after the firing ship has moved', () => {
  const a=new AssaultSequence(); a.begin();
  const impact={distance:121,bearing:{yaw:2.3,pitch:.1}};
  assert.equal(a.lockTether(impact),false);
  a.fireHarpoon({distance:100,bearing:{yaw:2,pitch:0}});
  advance(a,.3); assert.equal(a.lockTether(impact),false);
  advance(a,.5); assert.equal(a.lockTether(impact),true);
  assert.equal(a.distance,121); assert.equal(a.chargeStartDistance,121);
  assert.equal(a.commit(),true); assert.deepEqual(a.attackBearing,impact.bearing);
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
test('A glancing ram jams until the player holds a corrected line; time alone never breaches',()=>{
  const a=tethered();assert.equal(a.canCorrect,true);a.commit();a.landingError=3;
  advance(a,4);assert.equal(a.stage,'jammed');assert.equal(a.collision,'graze');
  advance(a,30);assert.equal(a.breach,0);assert.equal(a.canCorrect,true);
  a.landingError=0;advance(a,.2);assert.equal(a.stage,'jammed');
  a.landingError=3;a.update(.02);assert.equal(a.alignedTime,0);
  a.landingError=0;advance(a,.4);assert.equal(a.stage,'impact');assert.equal(a.canCorrect,false);
  advance(a,10);assert.equal(a.stage,'ready');
});
test('A fully missed ram rebounds for retry without opening the door',()=>{
  const a=tethered();a.commit();a.landingError=C.grazeRadius+.01;
  advance(a,4);assert.equal(a.stage,'rebound');assert.equal(a.collision,'miss');assert.equal(a.canCorrect,false);
  advance(a,1);assert.equal(a.stage,'retry');assert.equal(a.breach,0);assert.equal(a.distance,80);
  a.begin();assert.equal(a.committed,false);assert.equal(a.collision,null);assert.equal(a.landingError,0);
});
test('Landing classification includes the exact clean and glancing boundaries',()=>{
  for(const [error,stage] of [[C.cleanRadius,'impact'],[C.cleanRadius+.01,'jammed'],[C.grazeRadius,'jammed'],[Infinity,'rebound']]) {
    const a=tethered();a.commit();a.landingError=error;advance(a,3.9);assert.equal(a.stage,stage);
  }
});
