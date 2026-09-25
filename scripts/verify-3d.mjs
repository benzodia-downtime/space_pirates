import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('qa-output', { recursive: true });
const browser = await chromium.launch({ channel: process.env.QA_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true });
const errors = [];
const url = process.argv[2] || process.env.QA_URL || 'http://localhost:4173';
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    if (!seen.has(state.mode)) {
      seen.add(state.mode);
      console.log(state.mode, state.distanceMeters, JSON.stringify(state.rendering));
      await page.screenshot({ path: `qa-output/stage-${state.mode}.png` });
    }
    if (state.mode === 'ready') break;
    if (['harpoon-port', 'harpoon-starboard', 'bridge-ready'].includes(state.mode) && await page.locator('#boarding-action').isEnabled()) await page.locator('#boarding-action').click();
    await page.waitForTimeout(160);
  }
  const ready = await page.evaluate(() => SpacePiratesAmbient.getState());
  assert.equal(ready.mode, 'ready', 'Full input-driven boarding sequence');
  assert.equal(ready.harpoonsAttached, 2);
  assert.equal(ready.rendering.bridgeVisible, true);
  assert.ok(ready.rendering.bridgeUp[1] > 0.97, 'Bridge stays upright near antiparallel headings');
  assert.deepEqual(ready.rendering.hatch, ready.rendering.bridgeEnd, 'Bridge ends at the actual hull airlock');
  assert.ok(ready.rendering.triangles < 18000);
  await page.evaluate(() => SpacePiratesAmbient.pause());
  for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => SpacePiratesAmbient.redraw());
    await page.screenshot({ path: `qa-output/docked-${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ' no horizontal overflow');
    assert.ok(await page.locator('#battle-start').isVisible());
    for (const id of ['steering-pad', 'scan-button', 'battle-start']) {
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
  console.log('QA PASSED', [...seen].join(' -> '));
} finally { await browser.close(); }
