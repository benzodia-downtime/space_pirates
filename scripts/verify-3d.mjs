import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('qa-output', { recursive: true });
const browser = await chromium.launch({ channel: process.env.QA_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true });
const errors = [];
const url = process.argv.slice(2).find(arg => !arg.startsWith('--')) || process.env.QA_URL || 'http://localhost:4173';
const mobile = process.argv.includes('--mobile');
const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(url);
  await page.waitForFunction(() => window.SpacePiratesAmbient);
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().rendering.type), 'webgl2');
  await page.screenshot({ path: 'qa-output/01-cruise.png' });
  const read = () => page.evaluate(() => SpacePiratesAmbient.getState());
  const tap = async selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
  const touch = mobile ? await page.context().newCDPSession(page) : null;
  async function drag(dx, dy, offset = 0) {
    const box = await page.locator('#steering-pad').boundingBox();
    const x = box.x + box.width / 2 + offset, y = box.y + box.height / 2;
    if (mobile) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      if (dx || dy) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      if (dx || dy) await page.mouse.move(x + dx, y + dy, { steps: 3 });
      await page.mouse.up();
    }
    await page.waitForTimeout(80);
  }
  async function aim(view) {
    for (let i = 0; i < 30; i++) {
      const state = await read();
      const angle = view.yaw - state.steering.x * .442;
      const dx = Math.atan2(Math.sin(angle), Math.cos(angle)) / .006;
      const dy = (view.pitch - state.steering.y * .312) / .006;
      if (Math.hypot(dx, dy) < 0.15) break;
      await drag(Math.max(-35, Math.min(35, dx)), Math.max(-25, Math.min(25, dy)));
    }
  }
  async function checkSettings() {
    assert.equal(await page.locator('#scan-button, #scan-button-state').count(), 0);
    assert.equal(await page.locator('#sound-button').isVisible(), false);
    await page.keyboard.down('w');
    await tap('#settings-button');
    assert.equal(await page.evaluate(() => SpacePiratesAmbient.paused), true);
    const frozen = await read();
    await page.keyboard.up('w');
    for (const key of ['w','a','o','q','f']) await page.keyboard.press(key);
    await page.waitForTimeout(200);
    assert.deepEqual((await read()).navigation.position, frozen.navigation.position, 'Settings freeze navigation');
    assert.deepEqual((await read()).steering, frozen.steering, 'Settings reject flight controls');
    assert.equal((await read()).searchProgress, frozen.searchProgress);
    assert.equal((await read()).thrust, 0);
    await tap('#sound-button');
    assert.equal((await read()).sfxEnabled, false);
    await page.keyboard.press('Space');
    assert.equal((await read()).sfxEnabled, true, 'Native keyboard sound toggle works inside modal');
    await page.keyboard.press('Space');
    assert.equal((await read()).sfxEnabled, false);
    for (let i=0;i<4;i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.getElementById('settings-dialog').contains(document.activeElement)), true, 'Focus stays in modal');
    }
    const viewport = page.viewportSize();
    for (const [width,height] of [[1440,900],[390,844],[320,568],[568,320]]) {
      await page.setViewportSize({width,height});
      const b=await page.locator('#settings-dialog').boundingBox();
      assert.ok(b.x>=0 && b.y>=0 && b.x+b.width<=width && b.y+b.height<=height, 'Settings fits '+width+'x'+height);
      for(const id of ['sound-button','settings-close']) {
        const r=await page.locator('#'+id).boundingBox();
        assert.ok(r.width>=44 && r.height>=44 && r.y+r.height<=height, id+' touch target');
      }
      await page.screenshot({path:`qa-output/settings-${width}x${height}.png`});
    }
    await page.setViewportSize(viewport);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !SpacePiratesAmbient.paused);
    assert.equal(await page.locator('#settings-dialog').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-button');
    assert.equal((await read()).speed, 0, 'Closing settings never restores held thrust');
    await page.reload(); await page.waitForFunction(() => window.SpacePiratesAmbient);
    assert.equal((await read()).sfxEnabled, false, 'Sound preference survives reload');
    await tap('#settings-button'); await tap('#sound-button'); await tap('#settings-close');
    await page.waitForFunction(() => !SpacePiratesAmbient.paused);
    assert.equal((await read()).sfxEnabled, true);
    await page.evaluate(() => SpacePiratesAmbient.pause());
    await tap('#settings-button'); await tap('#settings-close');
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => SpacePiratesAmbient.paused), true, 'Existing pause is preserved');
    await page.evaluate(() => SpacePiratesAmbient.resume());
  }
  await checkSettings();
  async function checkRadar() {
    assert.equal(await page.locator('#radar-blip').isVisible(), false, 'No contact: no pitch callout');
    await page.keyboard.down('w');
    await page.waitForFunction(() => SpacePiratesAmbient.getState().searchProgress > .3, null, {timeout:15000});
    await page.keyboard.up('w'); await page.waitForTimeout(100);
    const contact = await read();
    const target = {yaw:contact.guidanceBearing.x*.65,pitch:contact.guidanceBearing.y*.65};
    const original = page.viewportSize();
    for (const [offset,yawOffset] of [[15,0],[-15,0],[0,0],[50,1.5],[-50,-1.5]]) {
      await aim({yaw:target.yaw+yawOffset,pitch:target.pitch+offset*Math.PI/180});
      const expected = offset>0 ? `↑ ${offset}°` : offset<0 ? `↓ ${-offset}°` : '0°';
      assert.equal(await page.locator('#radar-pitch').innerText(), expected);
      assert.ok(Math.abs((await read()).radarPitchDegrees-offset)<.15);
      const heldLabel=await page.locator('#radar-pitch').innerText();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#radar-pitch').innerText(),heldLabel,'Released steering preserves relative pitch');
      for (const [width,height] of [[1440,900],[390,844],[320,568],[568,320]]) {
        await page.setViewportSize({width,height}); await page.evaluate(() => SpacePiratesAmbient.redraw());
        const radar=await page.locator('#voyage-radar').boundingBox();
        const label=await page.locator('#radar-pitch').boundingBox();
        const blip=await page.locator('#radar-blip').boundingBox();
        assert.ok(Math.hypot(blip.x+blip.width/2-radar.x-radar.width/2,blip.y+blip.height/2-radar.y-radar.height/2)<radar.width*.43,'Contact stays inside circular radar');
        assert.ok(label && label.x>=radar.x && label.y>=radar.y && label.x+label.width<=radar.x+radar.width && label.y+label.height<=radar.y+radar.height,'Pitch callout fits radar at '+width+'x'+height);
        if(width===390) await page.screenshot({path:`qa-output/radar-pitch-${offset}.png`});
      }
      await page.setViewportSize(original);
    }
    await aim(target);
    await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w');
    const moved = await read(), p=moved.navigation.position, t=moved.navigation.enemyPosition;
    const expected = (moved.steering.y*.312 - Math.atan2(-(t.y-p.y), Math.hypot(t.x-p.x,t.z-p.z)))*180/Math.PI;
    assert.ok(Math.abs(moved.radarPitchDegrees-expected)<.01,'Pitch uses the current world position and heading');
    await page.reload(); await page.waitForFunction(() => window.SpacePiratesAmbient);
    assert.equal(await page.locator('#radar-blip').isVisible(),false,'New search clears the old radar callout');
  }
  await checkRadar();

  async function checkLayout(label, matrix = true) {
    const original = page.viewportSize();
    const viewports = matrix ? [['desktop',1440,900], ['tablet',1024,768], ['portrait',390,844], ['small',320,568], ['landscape',844,390], ['short',667,375], ['compact-landscape',568,320]] : [[label,original.width,original.height]];
    for (const [name,width,height] of viewports) {
      await page.setViewportSize({width,height});
      await page.evaluate(() => SpacePiratesAmbient.redraw());
      const problems = await page.evaluate(() => {
        const issues = [];
        if (document.querySelector('.voyage-readout, #voyage-state, #voyage-distance, #voyage-speed, #voyage-coordinate, #voyage-progress-bar')) issues.push('Removed navigation readout still exists');
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        const selectors = ['.hud-brand','#voyage-radar','#boarding-panel','#orbit-controls','#assault-cue','.assault-actions','.flight-controls','#help-overlay','.thrust-controls'];
        const panels = selectors.map(s=>document.querySelector(s)).filter(visible);
        const overlap = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top) > 1;
        const aim = document.querySelector('.cockpit-reticle').getBoundingClientRect();
        const centre = {left:aim.x+aim.width/2-8,right:aim.x+aim.width/2+8,top:aim.y+aim.height/2-8,bottom:aim.y+aim.height/2+8};
        for (let i=0;i<panels.length;i++) {
          const a=panels[i], r=a.getBoundingClientRect(), name=a.id||a.className;
          if (r.left < -.5 || r.top < -.5 || r.right > innerWidth+.5 || r.bottom > innerHeight+.5) issues.push(name+' outside viewport');
          if (overlap(r,centre)) issues.push(name+' covers aim centre');
          for (let j=i+1;j<panels.length;j++) if(overlap(r,panels[j].getBoundingClientRect())) issues.push(name+' overlaps '+(panels[j].id||panels[j].className));
        }
        for (const button of [...document.querySelectorAll('.voyage-ui button, #steering-pad')].filter(visible)) {
          const r=button.getBoundingClientRect();
          if(r.height<44 || r.width<44) issues.push(button.id+' touch target too small');
          if(r.left<0 || r.top<0 || r.right>innerWidth+.5 || r.bottom>innerHeight+.5) issues.push(button.id+' outside viewport');
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          if(!button.contains(hit)) issues.push(button.id+' is obscured');
        }
        for (const cell of [...document.querySelectorAll('.boarding-panel__metrics p')].filter(visible)) {
          for (const text of cell.children) {
            const range = document.createRange(); range.selectNodeContents(text);
            if(range.getBoundingClientRect().width > cell.getBoundingClientRect().width + .5) issues.push(text.id+' metric overflows its cell');
          }
        }
        if(document.documentElement.scrollWidth>innerWidth) issues.push('horizontal overflow');
        if(document.querySelector('#contact-marker, #intercept-marker')) issues.push('world target overlay still exists');
        return issues;
      });
      assert.deepEqual(problems, [], label+' / '+name);
      await page.screenshot({path:`qa-output/hud-${label}-${name}.png`});
    }
    await page.setViewportSize(original);
    await page.evaluate(() => SpacePiratesAmbient.redraw());
  }
  await checkLayout('cruise');
  if (process.argv.includes('--layout-only')) {
    await page.evaluate(() => SpacePiratesAmbient.forceContact());
    await checkLayout('survey');
    const contact = await read();
    await aim({yaw:contact.guidanceBearing.x*.65,pitch:contact.guidanceBearing.y*.65});
    await page.keyboard.down('w');
    await page.waitForFunction(() => SpacePiratesAmbient.getState().navigation.radius < 115);
    await page.keyboard.up('w'); await page.waitForTimeout(100);
    assert.equal(await page.locator('#orbit-button').isEnabled(), false);
    await checkLayout('blocked');
    await page.evaluate(() => SpacePiratesAmbient.forceEncounter());
    await checkLayout('docked');
    assert.equal(errors.length, 0, errors.join('\\n'));
    console.log('LAYOUT QA PASSED: cruise, survey, blocked, docked across seven viewports');
  } else {
  // Stationary startup: neither simulation position nor cosmetic star travel advances.
  const idle = await read(); await page.waitForTimeout(700);
  assert.deepEqual((await read()).navigation.position, idle.navigation.position);
  assert.deepEqual((await read()).rendering.cameraPosition, idle.rendering.cameraPosition);
  assert.equal((await read()).journeyDistance, idle.journeyDistance);
  assert.equal((await read()).starTravel, idle.starTravel);
  assert.equal((await read()).speed, 0);

  async function holdThrust(id, ms, cancel = false) {
    const b = await page.locator('#'+id).boundingBox(), x = b.x+b.width/2, y = b.y+b.height/2;
    if (mobile) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    else { await page.mouse.move(x,y); await page.mouse.down(); }
    await page.waitForTimeout(ms);
    const moving = await read();
    if (mobile) await touch.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await page.waitForTimeout(70);
    const stopped = await read();
    await page.waitForTimeout(200);
    assert.equal((await read()).speed, 0, 'Released/cancelled thrust stops');
    assert.deepEqual((await read()).navigation.position, stopped.navigation.position, 'No coast after release');
    return moving;
  }
  const forward = await holdThrust('thrust-forward', 500);
  assert.ok(forward.speed > 0); assert.ok(forward.navigation.position.z < idle.navigation.position.z);
  const reverse = await holdThrust('thrust-reverse', 500, true);
  assert.ok(reverse.speed < 0); assert.ok(reverse.navigation.position.z > forward.navigation.position.z);
  const noScan = await read();
  await page.locator('#steering-pad').focus();
  await page.keyboard.press('Space'); await page.waitForTimeout(350);
  assert.equal((await read()).searchProgress, noScan.searchProgress, 'Space has no sensor pulse action');
  assert.deepEqual((await read()).navigation.position, noScan.navigation.position);
  assert.deepEqual((await read()).rendering.enemyPosition, noScan.rendering.enemyPosition);
  await page.keyboard.down('w'); await page.keyboard.down('s');
  await page.waitForTimeout(80); const opposed = await read(); await page.waitForTimeout(200);
  assert.equal((await read()).speed, 0); assert.deepEqual((await read()).navigation.position, opposed.navigation.position);
  await page.keyboard.up('w'); await page.keyboard.up('s');
  await page.keyboard.down('w'); await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('w');
  const blurred = await read(); await page.waitForTimeout(180);
  assert.equal((await read()).thrust, 0); assert.deepEqual((await read()).navigation.position, blurred.navigation.position);

  if (mobile) {
    const p = await page.locator('#steering-pad').boundingBox(), b = await page.locator('#thrust-forward').boundingBox();
    const pad = { x: p.x+p.width/2, y: p.y+p.height/2, id: 1 };
    const forwardPoint = { x: b.x+b.width/2, y: b.y+b.height/2, id: 2 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pad] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pad, forwardPoint] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{...pad, x:pad.x+12}, forwardPoint] });
    await page.waitForTimeout(200);
    assert.equal((await read()).thrust, 1, 'Two-finger steering and forward thrust coexist');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(80);
    assert.equal((await read()).thrust, 0); assert.equal((await read()).speed, 0);
  }

  // A fresh press anywhere on the pad must preserve the current heading.
  await drag(25, -8);
  const firstDrag = await read();
  await drag(0, 0, -17);
  const regrip = await read();
  assert.ok(Math.abs(regrip.steering.x - firstDrag.steering.x) < .001, 'Regripping never resets absolute yaw');
  assert.ok(Math.abs(regrip.steering.y - firstDrag.steering.y) < .001, 'Regripping never resets pitch');
  await drag(20, 0, 10);
  assert.ok((await read()).steering.x > regrip.steering.x + .2, 'Second relative drag accumulates from current heading');
  // A yaw-only keyboard input must not clamp a pitch set with the relative pad.
  for (let i = 0; i < 4; i++) await drag(0, 20);
  const highPitch = (await read()).steering.y;
  assert.ok(highPitch > 1);
  await page.keyboard.down('d'); await page.waitForTimeout(120); await page.keyboard.up('d');
  assert.ok(Math.abs((await read()).steering.y - highPitch) < .001, 'Keyboard does not reset an existing pad pitch');
  let state = await read();
  await aim({ yaw: state.guidanceBearing.x*.65, pitch: state.guidanceBearing.y*.65 });
  const approachStart = state.navigation.radius;
  await page.keyboard.down('w');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().mode === 'survey', null, { timeout: 45000 });
  await page.keyboard.up('w'); await page.waitForTimeout(100);
  state = await read();
  assert.ok(state.navigation.radius < approachStart, 'Real forward travel reaches the contact');
  assert.equal(state.speed, 0, 'Contact never engages automatic forward thrust');
  await aim({ yaw: state.guidanceBearing.x * .65, pitch: state.guidanceBearing.y * .65 });
  await page.waitForTimeout(600);
  assert.equal((await read()).navigation.doorDiscovered, false);
  assert.equal(await page.locator('#boarding-action').isEnabled(), false, 'Straight approach cannot succeed');
  await page.keyboard.press('Space');
  assert.equal((await read()).mode, 'survey', 'Blind attack is rejected');
  await page.screenshot({ path: 'qa-output/orbit-front.png' });
  await checkLayout('survey');
  // Too-close clearance rejects both touch/button and keyboard orbit; backing off restores it.
  await page.keyboard.down('w');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().navigation.radius < 115);
  await page.keyboard.up('w'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#orbit-button').isEnabled(), false);
  assert.match(await page.locator('#orbit-readout').innerText(), /너무 가까워 선회 불가/);
  const closePosition = (await read()).navigation.position;
  await page.keyboard.press('o'); await page.waitForTimeout(100);
  assert.equal((await read()).navigation.orbiting, false);
  assert.deepEqual((await read()).navigation.position, closePosition);
  await checkLayout('blocked');
  await page.keyboard.down('s');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().navigation.radius > 155);
  await page.keyboard.up('s'); await page.waitForTimeout(100);
  assert.equal(await page.locator('#orbit-button').isEnabled(), true);
  assert.doesNotMatch(await page.locator('#orbit-readout').innerText(), /선회 불가/);
  // Manual reverse overrides autopilot; releasing holds the new position.
  await tap('#orbit-button');
  await page.waitForTimeout(120);
  await holdThrust('thrust-reverse', 200);
  assert.equal((await read()).navigation.orbiting, false);
  await aim({ yaw: (await read()).guidanceBearing.x*.65, pitch: (await read()).guidanceBearing.y*.65 });
  const fixedEnemy = (await read()).rendering.enemyPosition;
  const fixedRotation = (await read()).rendering.enemyRotation;
  await tap('#orbit-button');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().navigation.angleDegrees > 75);
  await page.screenshot({ path: 'qa-output/orbit-side.png' });
  assert.deepEqual((await read()).rendering.enemyPosition, fixedEnemy, 'Enemy stays fixed as player orbits');
  assert.deepEqual((await read()).rendering.enemyRotation, fixedRotation, 'Orbit is not a spinning enemy model');
  assert.equal((await read()).navigation.doorVisible, false, 'Rear hatch is occluded from the side');
  await tap('#orbit-direction');
  const reverseAngle = (await read()).navigation.angleDegrees;
  await page.waitForTimeout(350);
  assert.ok((await read()).navigation.angleDegrees < reverseAngle, 'Reverse autopilot direction');
  await tap('#orbit-direction');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().navigation.angleDegrees > 178, null, { timeout: 25000 });
  await tap('#orbit-button');
  const parked = (await read()).navigation.position;
  await aim((await read()).navigation.doorBearing);
  await page.waitForTimeout(500);
  state = await read();
  assert.deepEqual(state.navigation.position, parked, 'Stopping orbit holds world position');
  assert.equal(state.navigation.doorDiscovered, true);
  assert.equal(state.navigation.canHarpoon, true);
  await page.screenshot({ path: 'qa-output/orbit-rear.png' });
  for (const id of ['orbit-button', 'orbit-direction', 'boarding-action']) {
    const b = await page.locator('#' + id).boundingBox();
    assert.ok(b.x >= 0 && b.y >= 0 && b.x+b.width <= page.viewportSize().width+1 && b.y+b.height <= page.viewportSize().height+1, id+' fits');
  }
  const seen = new Set(['survey']);
  await tap('#boarding-action');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().mode === 'harpoon');
  seen.add('harpoon');
  await page.waitForFunction(() => SpacePiratesAmbient.getState().mode === 'tethered');
  seen.add('tethered');
  // A focused settings button must open with Space instead of triggering a tether pull.
  await page.locator('#settings-button').focus();
  await page.keyboard.press('Space');
  assert.equal((await read()).settingsOpen, true);
  assert.equal((await read()).mode, 'tethered');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !SpacePiratesAmbient.paused);
  await page.locator('#steering-pad').focus();
  const hooked = await read();
  assert.equal(hooked.navigation.orbiting, false);
  assert.equal(hooked.rendering.harpoonVisible, true);
  await page.keyboard.down('s'); await page.waitForTimeout(120); await page.keyboard.up('s');
  assert.deepEqual((await read()).navigation.position, hooked.navigation.position, 'Tether prevents manual thrust');
  await page.waitForTimeout(1100);
  assert.equal((await read()).mode, 'tethered', 'Hooking alone never triggers the ram');
  assert.deepEqual((await read()).navigation.position, hooked.navigation.position);
  await page.screenshot({ path: 'qa-output/harpoon-locked.png' });
  if (mobile) await tap('#boarding-action');
  else await page.keyboard.press('Space'); // Works even when the previous button still has focus.
  let start = Date.now();
  while (Date.now() - start < 20000) {
    state = await read();
    if (!seen.has(state.mode)) {
      seen.add(state.mode);
      console.log(state.mode, state.distanceMeters.toFixed(1), { drawCalls: state.rendering.drawCalls, breached: state.rendering.armourBreached });
      await page.screenshot({ path: `qa-output/stage-${state.mode}.png` });
      if (state.mode === 'charge') {
        await page.evaluate(() => SpacePiratesAmbient.pause());
        const charge = (await read()).chargeProgress;
        await page.waitForTimeout(250);
        assert.equal((await read()).chargeProgress, charge);
        await page.evaluate(() => SpacePiratesAmbient.resume());
      }
    }
    if (state.mode === 'charge' && state.chargeProgress > 0.72 && !page.chargeCaptured) {
      await page.screenshot({ path: 'qa-output/charge-close.png' }); page.chargeCaptured = true;
    }
    if (state.mode === 'impact' && state.breachProgress > 0.4) await page.screenshot({ path: 'qa-output/impact-breach.png' });
    if (state.mode === 'ready') break;
    await page.waitForTimeout(100);
  }
  const ready = await page.evaluate(() => SpacePiratesAmbient.getState());
  assert.equal(ready.mode, 'ready', 'Full input-driven boarding sequence');
  assert.equal(ready.ramProgress, 1);
  assert.equal(ready.breachProgress, 1);
  assert.equal(ready.clampProgress, 1);
  assert.equal(ready.rendering.armourBreached, true);
  assert.equal(ready.rendering.harpoonVisible, false, 'Cable retracts when the anchored ramp tears away');
  assert.equal(ready.rendering.clawsVisible, true);
  if (mobile) assert.ok(ready.rendering.pixelRatio <= 1.5);
  const heading = ready.rendering.cameraRotation;
  await page.keyboard.down('a'); await page.waitForTimeout(180); await page.keyboard.up('a');
  const locked = await page.evaluate(() => SpacePiratesAmbient.getState());
  assert.ok(Math.abs(locked.rendering.cameraRotation[1] - heading[1]) < 0.001, 'Committed helm rejects steering');
  assert.deepEqual([...seen], ['survey','harpoon','tethered','ram-deploy','charge','impact','clamp','seal','pressurize','ready']);
  assert.equal(ready.rendering.bridgeVisible, true);
  assert.ok(ready.rendering.bridgeUp[1] > 0.97, 'Bridge stays upright near antiparallel headings');
  assert.deepEqual(ready.rendering.passageEnd, ready.rendering.bridgeEnd, 'Passage reaches inside the torn stern ramp');
  assert.ok(ready.rendering.triangles < 18000);
  await page.evaluate(() => SpacePiratesAmbient.pause());
  await checkLayout('docked');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => SpacePiratesAmbient.resume());
  await page.locator('#battle-start').click();
  await page.waitForFunction(() => !document.getElementById('battle-result').hidden, null, { timeout: 45000 });
  await page.screenshot({ path: 'qa-output/battle-result.png' });
  console.log('battle', await page.locator('#battle-result').innerText());
  await page.locator('#battle-result-action').click();
  assert.deepEqual(await page.evaluate(() => SpacePiratesBattle.getCargo()), { fuelCells: 2, ammoCrates: 1, medicalSupplies: 1 });
  await page.locator('#battle-result-action').click();
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().mode), 'cruise');
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().rendering.bridgeVisible), false);
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().steeringLocked), false);
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().rendering.ramVisible), false);
  assert.equal((await read()).navigation.active, false);
  assert.equal((await read()).speed, 0); assert.equal((await read()).thrust, 0);
  assert.equal((await read()).navigation.anchor, null);
  assert.equal((await read()).rendering.harpoonVisible, false);
  await tap('#settings-button');
  await tap('#sound-button');
  assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'false');
  await tap('#settings-close');
  await page.waitForFunction(() => !SpacePiratesAmbient.paused);

  await page.locator('#steering-pad').focus();
  await page.keyboard.down('d');
  await page.waitForTimeout(250);
  await page.keyboard.up('d');
  await page.waitForTimeout(1200);
  const latched = await page.evaluate(() => SpacePiratesAmbient.getState());
  await page.waitForTimeout(400);
  const afterRelease = await page.evaluate(() => SpacePiratesAmbient.getState());
  assert.ok(Math.abs(latched.steering.x - afterRelease.steering.x) < 0.006, 'Released helm remains latched');
  assert.ok(Math.abs(latched.rendering.cameraRotation[1] - afterRelease.rendering.cameraRotation[1]) < 0.005, 'Camera keeps heading');

  await page.evaluate(() => SpacePiratesAmbient.pause());
  const pausedProgress = await page.evaluate(() => SpacePiratesAmbient.getState().searchProgress);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().searchProgress), pausedProgress);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => SpacePiratesAmbient.forceEncounter());
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().encounterReady), true);
  await page.screenshot({ path: 'qa-output/reduced-motion.png' });

  // Context loss pauses the simulation and a restored context can resume it.
  await page.evaluate(() => {
    SpacePiratesAmbient.resume();
    window.qaGL = document.getElementById('starfield').getContext('webgl2').getExtension('WEBGL_lose_context');
    qaGL.loseContext();
  });
  await page.waitForFunction(() => !document.getElementById('renderer-error').hidden);
  assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().rendering.available), false);
  await page.waitForTimeout(300);
  await page.evaluate(() => qaGL.restoreContext());
  await page.waitForFunction(() => document.getElementById('renderer-error').hidden && SpacePiratesAmbient.getState().rendering.available);
  assert.equal(errors.length, 0, errors.join('\n'));

  // Inspect a real collision frame with reduced motion, not just the settled ready state.
  const reduced = await page.evaluate(async () => {
    SpacePiratesAmbient.destroy();
    const { VoyageScene } = await import(new URL('./src/voyage.js?v=radar-1', location.href));
    const scene = new VoyageScene(document.getElementById('starfield'));
    scene.pause();
    scene.forceEncounter();
    scene.assault.impactAge = 0.2;
    scene.assault.breach = 0.4;
    scene.assault.stage = scene.mode = 'impact';
    scene.renderStill();
    const state = scene.getState();
    const flash = document.getElementById('space-scene').style.getPropertyValue('--impact-flash');
    scene.destroy();
    return { state, flash };
  });
  assert.ok(reduced.state.rendering.cameraPosition.every((value, index) => Math.abs(value - Object.values(reduced.state.navigation.position)[index]) < 1e-10), 'Reduced motion removes recoil');
  assert.equal(reduced.state.rendering.debrisVisible, false, 'Reduced motion removes flying debris');
  assert.equal(Number(reduced.flash), 0, 'Reduced motion removes contact flash');

  const unsupported = await browser.newPage();
  await unsupported.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await unsupported.goto(url);
  await unsupported.waitForFunction(() => window.SpacePiratesAmbient);
  assert.equal(await unsupported.locator('#renderer-error').isVisible(), true);
  assert.equal(await unsupported.evaluate(() => SpacePiratesAmbient.getState().rendering.available), false);
  await unsupported.close();
  assert.equal(errors.length, 0, errors.join('\\n'));
  console.log('QA PASSED', [...seen].join(' -> '));
  }
} finally { await browser.close(); }
