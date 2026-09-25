import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const url = process.argv[2] || 'http://localhost:4173/dist/';
await mkdir('qa-output', {recursive:true});
const browser = await chromium.launch({channel:process.env.QA_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless:true});
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage(mobile ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2} : {viewport:{width:1440,height:900}});
    const errors = []; page.on('pageerror', e=>errors.push(e.message));
    const touch = mobile ? await page.context().newCDPSession(page) : null;
    const read = () => page.evaluate(()=>orbitQA.getState());
    const tap = selector => mobile ? page.locator(selector).tap() : page.locator(selector).click();
    const advance = frames => page.evaluate(count=>{
      const scene = orbitQA;
      for(let i=0;i<count;i++) scene.update(.02);
      scene.renderStill();
    }, frames);
    async function drag(dx,dy) {
      const b=await page.locator('#steering-pad').boundingBox(), x=b.x+b.width/2, y=b.y+b.height/2;
      if(mobile) {
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        if(dx || dy) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else {
        await page.mouse.move(x,y); await page.mouse.down();
        if(dx || dy) await page.mouse.move(x+dx,y+dy);
        await page.mouse.up();
      }
    }
    await page.goto(url);
    await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type === 'webgl2');
    // Set up a stopped contact, then test the real touch/mouse and keyboard input paths.
    await page.evaluate(async ()=>{
      SpacePiratesAmbient.destroy();
      const {VoyageScene}=await import(new URL("./src/voyage.js?v=breachplay-1",location.href));
      window.orbitQA=new VoyageScene(document.getElementById("starfield"));
      const s=orbitQA; s.stopLoop(); s.forceContact();
      const b=s.getActualBearing();
      s.pointer={x:b.x*.65/.442,y:b.y*.65/.312}; s.pointerTarget={...s.pointer};
      s.renderStill();
    });
    await tap('#orbit-button');
    const start=await read();
    await drag(0,-30);
    const chosen=(await read()).navigation.orbitNormal;
    assert.deepEqual((await read()).navigation.position,start.navigation.position,'No input teleport');
    assert.deepEqual((await read()).steering,start.steering,'Orbit pad changes path, not just camera');
    await advance(300);
    let state=await read();
    assert.ok(state.navigation.position.y>start.navigation.position.y+50,'Pad up causes real vertical travel');
    assert.deepEqual(state.navigation.orbitNormal,chosen,'Release preserves selected orbit');
    assert.ok(Math.abs(state.radarPitchDegrees)<.001,'Target remains vertically tracked');
    assert.ok(Math.abs(state.navigation.radius-start.navigation.radius)<1e-7);
    assert.deepEqual(state.rendering.enemyPosition,start.rendering.enemyPosition);
    assert.ok(state.rendering.enemyRotation.every((v,i)=>Math.abs(v-start.rendering.enemyRotation[i])<.001),'No artificial hull spin on a vertical orbital path');
    await page.screenshot({path:`qa-output/orbit3d-above-${mobile?'mobile':'desktop'}.png`});
    await drag(0,0);
    assert.deepEqual((await read()).navigation.orbitNormal,chosen,'Regrip does not flatten orbit');
    // Cross a pole via the integrated scene: camera and radar must agree, without a flip.
    const polar=await page.evaluate(()=>{
      const s=orbitQA; let maxYaw=0,maxPitch=0,maxRadar=0;
      for(let i=0;i<1800;i++) {
        const prev=s.getView(); s.update(.02); const next=s.getView();
        maxYaw=Math.max(maxYaw,Math.abs(next.yaw-prev.yaw));
        maxPitch=Math.max(maxPitch,Math.abs(next.pitch-prev.pitch));
        maxRadar=Math.max(maxRadar,Math.abs(s.getState().radarPitchDegrees));
      }
      s.renderStill(); return {maxYaw,maxPitch,maxRadar};
    });
    assert.ok(polar.maxYaw<.02 && polar.maxPitch<.02,JSON.stringify(polar));
    // The hatch may become the guidance target after discovery; allow its physical offset.
    assert.ok(polar.maxRadar<20,JSON.stringify(polar));
    assert.equal(await page.locator('#orbit-direction').count(),0);
    await page.keyboard.press('q');
    assert.deepEqual((await read()).navigation.orbitNormal,chosen,'Removed Q shortcut does nothing');
    await drag(0,30);
    const reversed=(await read()).navigation.orbitNormal;
    for(const key of ['x','y','z']) assert.ok(Math.abs(reversed[key]+chosen[key])<1e-8);
    await drag(25,-25);
    const diagonal=(await read()).navigation.orbitNormal;
    assert.notDeepEqual(diagonal,reversed);
    await advance(70);
    assert.deepEqual((await read()).navigation.orbitNormal,diagonal);
    await page.screenshot({path:`qa-output/orbit3d-diagonal-${mobile?'mobile':'desktop'}.png`});
    await page.keyboard.down('ArrowDown'); await advance(30); await page.keyboard.up('ArrowDown');
    assert.notDeepEqual((await read()).navigation.orbitNormal,diagonal,'Arrow keys steer orbital plane too');
    await tap('#orbit-button');
    state=await read(); await drag(20,0); await advance(20);
    const manual=await read();
    assert.deepEqual(manual.navigation.position,state.navigation.position,'Stopped orbit stays still');
    assert.ok(manual.steering.x>state.steering.x+.1,'Stopped orbit restores manual aiming');
    assert.ok(Math.abs(manual.steering.y-state.steering.y)<1e-8,'No pitch reset after crossing poles');
    // Fire with orbit engaged, without a stop command, through both real input paths.
    // Isolate this scenario from the preceding low-level CDP touch gestures.
    await page.reload();
    await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type === 'webgl2');
    await page.evaluate(async ()=>{
      SpacePiratesAmbient.destroy();
      const {VoyageScene}=await import(new URL('./src/voyage.js?v=breachplay-1',location.href));
      window.orbitQA=new VoyageScene(document.getElementById('starfield'));
      const s=orbitQA; s.stopLoop(); s.forceContact();
      const view=s.navigation.forceRear(true);
      s.pointer={x:view.yaw/.442,y:view.pitch/.312}; s.pointerTarget={...s.pointer};
      s.renderStill();
    });
    await tap('#orbit-button');
    await page.waitForFunction(()=>orbitQA.navigation.orbiting,null,{timeout:1500});
    const shotStart=await read();
    assert.equal(shotStart.navigation.orbiting,true,JSON.stringify(shotStart.navigation));
    assert.equal(await page.locator('#boarding-action').isEnabled(),true);
    if(mobile) await tap('#boarding-action'); else await page.keyboard.press('f');
    await advance(15);
    const flying=await read();
    assert.equal(flying.mode,'harpoon'); assert.equal(flying.navigation.orbiting,true);
    assert.equal(flying.navigation.anchor,null); assert.ok(flying.navigation.harpoonTarget);
    assert.equal(flying.rendering.harpoonVisible,true);
    assert.notDeepEqual(flying.navigation.position,shotStart.navigation.position);
    await advance(21);
    const hooked=await read();
    assert.equal(hooked.mode,'tethered'); assert.equal(hooked.navigation.orbiting,false);
    assert.ok(hooked.navigation.anchor, 'Impact attaches to the moving rear ramp');
    assert.equal(hooked.navigation.harpoonTarget,null);
    await page.keyboard.press('o'); await advance(30);
    assert.equal((await read()).navigation.orbiting,false);
    assert.deepEqual((await read()).navigation.position,hooked.navigation.position,'Anchored ship cannot resume orbit');
    await tap('#boarding-action');
    assert.equal((await read()).mode,'ram-deploy');
    assert.deepEqual((await read()).navigation.position,hooked.navigation.position,'Pull begins at impact position without a jump');
    await page.keyboard.press('o'); await drag(25,-25); await advance(220);
    assert.equal((await read()).navigation.orbiting,false,'Pull never resumes orbit');
    assert.equal(await page.locator('#boarding-panel, #assault-cue').count(),0);
    assert.deepEqual(errors,[]);
    console.log(`3D orbit ${mobile?'touch':'mouse'}: PASS (steering, half speed, orbital shot, flight, impact stop, tether/pull lock)`);
    await page.close();
  }
} finally {await browser.close();}
