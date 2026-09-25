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
  await page.evaluate(() => SpacePiratesAmbient.forceContact());
  const seen = new Set();
  let start = Date.now();
  while (Date.now() - start < 65000) {
    const state = await page.evaluate(() => SpacePiratesAmbient.getState());
    const box = await page.locator('#steering-pad').boundingBox();
    const x = box.x + box.width / 2 + Math.max(-1, Math.min(1, state.guidanceBearing.x / .68)) * box.width * .36;
    const y = box.y + box.height / 2 + Math.max(-1, Math.min(1, state.guidanceBearing.y / .48)) * box.height * .36;
    if (mobile) await page.touchscreen.tap(x, y);
    else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); }
    if (!seen.has(state.mode)) {
      seen.add(state.mode);
      console.log(state.mode, state.distanceMeters.toFixed(1), { drawCalls: state.rendering.drawCalls, breached: state.rendering.armourBreached });
      if (state.mode !== 'ready') {
        const action = await page.locator('#boarding-action').boundingBox();
        assert.ok(action.x >= 0 && action.x + action.width <= page.viewportSize().width + 1, 'Assault action fits at ' + state.mode);
      }
      await page.screenshot({ path: `qa-output/stage-${state.mode}.png` });
      if (state.mode === 'charge') {
        await page.evaluate(() => SpacePiratesAmbient.pause());
        const charge = await page.evaluate(() => SpacePiratesAmbient.getState().chargeProgress);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => SpacePiratesAmbient.getState().chargeProgress), charge);
        await page.evaluate(() => SpacePiratesAmbient.resume());
      }
    }
    if (state.mode === 'charge' && state.chargeProgress > 0.72 && !page.chargeCaptured) {
      await page.screenshot({ path: 'qa-output/charge-close.png' });
      // Record once without changing the ordered stage assertion.
      page.chargeCaptured = true;
    }
    if (state.mode === 'impact' && state.breachProgress > 0.4) await page.screenshot({ path: 'qa-output/impact-breach.png' });
    if (state.mode === 'ready') break;
    if (state.mode === 'armed' && await page.locator('#boarding-action').isEnabled()) await page.locator('#boarding-action').click();
    await page.waitForTimeout(160);
  }
  const ready = await page.evaluate(() => SpacePiratesAmbient.getState());
  assert.equal(ready.mode, 'ready', 'Full input-driven boarding sequence');
  assert.equal(ready.ramProgress, 1);
  assert.equal(ready.breachProgress, 1);
  assert.equal(ready.clampProgress, 1);
  assert.equal(ready.rendering.armourBreached, true);
  assert.equal(ready.rendering.clawsVisible, true);
  if (mobile) assert.ok(ready.rendering.pixelRatio <= 1.5);
  const heading = ready.rendering.cameraRotation;
  await page.keyboard.down('a'); await page.waitForTimeout(180); await page.keyboard.up('a');
  const locked = await page.evaluate(() => SpacePiratesAmbient.getState());
  assert.ok(Math.abs(locked.rendering.cameraRotation[1] - heading[1]) < 0.001, 'Committed helm rejects steering');
  assert.deepEqual([...seen], ['intercept','align','armed','ram-deploy','charge','impact','clamp','seal','pressurize','ready']);
  assert.equal(ready.rendering.bridgeVisible, true);
  assert.ok(ready.rendering.bridgeUp[1] > 0.97, 'Bridge stays upright near antiparallel headings');
  assert.deepEqual(ready.rendering.passageEnd, ready.rendering.bridgeEnd, 'Passage reaches inside the pierced bow');
  assert.ok(ready.rendering.triangles < 18000);
  await page.evaluate(() => SpacePiratesAmbient.pause());
  for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => SpacePiratesAmbient.redraw());
    await page.screenshot({ path: `qa-output/docked-${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' no horizontal overflow');
    assert.ok(await page.locator('#battle-start').isVisible());
    const target = await page.locator('#contact-marker').boundingBox();
    const cue = await page.locator('#assault-cue').boundingBox();
    assert.ok(cue.y + cue.height < target.y + target.height / 2, name + ': cue leaves breach centre clear');
    for (const id of ['steering-pad', 'scan-button', 'sound-button', 'battle-start']) {
      const bounds = await page.locator('#' + id).boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, name + ': ' + id + ' fits');
    }
  }
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
  await page.locator('#sound-button').click();
  assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'), 'false');

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
    const { VoyageScene } = await import(new URL('./src/voyage.js?v=ram-1', location.href));
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
  assert.ok(reduced.state.rendering.cameraPosition.every((value, index) => Math.abs(value - [0,0,6][index]) < 1e-10), 'Reduced motion removes recoil');
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
} finally { await browser.close(); }
