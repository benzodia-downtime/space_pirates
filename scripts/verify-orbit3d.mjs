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
    const tap = async selector => {
      if(mobile) await page.locator(selector).tap(); else await page.locator(selector).click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    };
    const advance = frames => page.evaluate(count=>{
      const scene = orbitQA;
      for(let i=0;i<count;i++) scene.update(.02);
      scene.renderStill();
    }, frames);
    async function drag(dx,dy,frames=0,selector='#steering-pad') {
      const b=await page.locator(selector).boundingBox(), x=b.x+b.width/2, y=b.y+b.height*.35;
      if(mobile) {
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        if(dx || dy) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
        await advance(frames);
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else {
        await page.mouse.move(x,y); await page.mouse.down();
        if(dx || dy) await page.mouse.move(x+dx,y+dy);
        await advance(frames);
        await page.mouse.up();
      }
    }
    await page.goto(url);
    await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type === 'webgl2');
    // Set up a stopped contact, then test the real touch/mouse and keyboard input paths.
    await page.evaluate(async ()=>{
      SpacePiratesAmbient.destroy();
      const {VoyageScene}=await import(new URL("./src/voyage.js?v=aftgun-1",location.href));
      window.orbitQA=new VoyageScene(document.getElementById("starfield"));
      const s=orbitQA; s.stopLoop(); s.forceContact();
      const b=s.getActualBearing();
      s.pointer={x:b.x*.65/.442,y:b.y*.65/.312}; s.pointerTarget={...s.pointer};
      s.renderStill();
    });
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    const start=await read(); await advance(10);
    assert.deepEqual((await read()).navigation.position,start.navigation.position,'Starts stopped');
    assert.equal(await page.locator('#thrust-forward, #thrust-reverse, [data-thrust]').count(),0);
    await drag(0,-35,15);const forward=await read();
    assert.ok(forward.navigation.radius<start.navigation.radius-6,'Pad up moves forward');
    assert.equal(forward.movement.y,0);assert.deepEqual(forward.steering,start.steering);
    await drag(0,35,15);assert.ok(dist((await read()).navigation.position,start.navigation.position)<1e-6,'Pad down reverses');
    await drag(-35,0,15);assert.ok(dist((await read()).navigation.position,start.navigation.position)>9,'Pad left strafes');
    await drag(35,0,15);assert.ok(dist((await read()).navigation.position,start.navigation.position)<1e-6);
    await drag(35,0,20);
    let state=await read();
    assert.ok(dist(state.navigation.position,start.navigation.position)>12,'Pad translates');
    assert.deepEqual(state.steering,start.steering,'Pad never changes look');
    const parked=state.navigation.position;await advance(10);
    assert.deepEqual((await read()).navigation.position,parked,'Release stops with no drift');
    await drag(25,-12,0,'#look-zone');
    const aimed=await read();
    assert.deepEqual(aimed.navigation.position,parked,'Look never moves the ship');
    assert.ok(aimed.steering.x>state.steering.x+.2);
    await drag(0,0,0,'#look-zone');await advance(10);
    assert.deepEqual((await read()).steering,aimed.steering,'Regrip and release preserve heading');

    await tap('#track-button');await advance(100);
    const tracked=await read();
    assert.equal(tracked.lookTracking,true);assert.deepEqual(tracked.navigation.position,parked,'Tracking is not autopilot');
    assert.equal(tracked.navigation.doorDiscovered,false,'Front lock does not discover the ramp');
    await drag(0,-35,35);state=await read();
    assert.ok(state.navigation.radius<tracked.navigation.radius-14,'Pad forward retains target tracking');
    const centreError=await page.evaluate(()=>{
      const s=orbitQA,p=s.navigation.position,t=s.navigation.enemyPosition,v=s.getView();
      const d={x:t.x-p.x,y:t.y-p.y,z:t.z-p.z},len=Math.hypot(d.x,d.y,d.z);
      return 1-(d.x*Math.sin(v.yaw)*Math.cos(v.pitch)-d.y*Math.sin(v.pitch)-d.z*Math.cos(v.yaw)*Math.cos(v.pitch))/len;
    });
    assert.ok(centreError<.0001,'Manual strafe retains hull-centre tracking');
    await tap('#track-button');const unlocked=await read();
    assert.equal(unlocked.lookTracking,false);await advance(5);
    assert.deepEqual((await read()).steering,unlocked.steering,'Turning tracking off does not snap view');

    await tap('#orbit-button');await advance(5);const orbitStart=await read();
    await drag(-35,0,5);
    state=await read();assert.equal(state.navigation.orbiting,false,'Translation overrides optional orbit');
    assert.ok(dist(state.navigation.position,orbitStart.navigation.position)<4,'No teleport on takeover');
    await advance(5);assert.deepEqual((await read()).navigation.position,state.navigation.position);

    await page.locator('#steering-pad').focus();
    const keyboardStart=await read();
    await page.keyboard.down('Space');await advance(10);await page.keyboard.up('Space');
    state=await read();assert.deepEqual(state.navigation.position,keyboardStart.navigation.position);
    assert.equal(state.mode,'survey','Space has no flight/action binding');
    assert.deepEqual(state.steering,keyboardStart.steering);
    await page.keyboard.down('Control');await advance(10);await page.keyboard.up('Control');
    assert.ok(dist((await read()).navigation.position,keyboardStart.navigation.position)<1e-6);
    await page.keyboard.down('ArrowUp');await advance(10);await page.keyboard.up('ArrowUp');
    assert.ok(dist((await read()).navigation.position,keyboardStart.navigation.position)>4);
    await page.keyboard.down('ArrowDown');await advance(10);await page.keyboard.up('ArrowDown');
    assert.ok(dist((await read()).navigation.position,keyboardStart.navigation.position)<1e-6);

    const dodgeStart=await read();
    await page.keyboard.down('a');await page.keyboard.press('Shift');await page.keyboard.up('a');await advance(12);
    state=await read();assert.ok(dist(state.navigation.position,dodgeStart.navigation.position)>24);
    assert.equal(state.navigation.dodging,false);assert.ok(state.navigation.dodgeCooldown>0);
    await page.keyboard.press('Shift');await advance(5);
    assert.deepEqual((await read()).navigation.position,state.navigation.position,'Cooldown prevents double boost');
    await tap('#settings-button');const paused=await read();await advance(30);
    assert.equal((await read()).navigation.dodgeCooldown,paused.navigation.dodgeCooldown);
    await tap('#settings-close');await page.evaluate(()=>orbitQA.stopLoop());await advance(80);

    if(mobile) {
      const p=await page.locator('#steering-pad').boundingBox(),b=await page.locator('#dodge-button').boundingBox();
      const pad={x:p.x+p.width/2,y:p.y+p.height/2,id:1},button={x:b.x+b.width/2,y:b.y+b.height/2,id:2};
      const before=await read();
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pad]});
      const held={...pad,x:pad.x+35};
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[button]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[held,button]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[held]});
      assert.equal((await read()).navigation.dodging,true,'Right thumb activates dodge while left holds a direction');
      await advance(12);
      assert.ok(dist((await read()).navigation.position,before.navigation.position)>24);
      await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await advance(1);const released=await read();await advance(10);
      assert.deepEqual((await read()).navigation.position,released.navigation.position,'Cancel clears pad');
      // Two independent pointers move and look simultaneously.
      const l=await page.locator('#look-zone').boundingBox(),look={x:l.x+l.width/2,y:l.y+l.height*.35,id:2};
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pad]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pad,look]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...pad,x:pad.x+35},{...look,x:look.x+20}]});
      await advance(10);state=await read();
      assert.ok(dist(state.navigation.position,released.navigation.position)>5);
      assert.ok(state.steering.x>released.steering.x+.2);
      await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    }
    await page.screenshot({path:`qa-output/evasion-controls-${mobile?'mobile':'desktop'}.png`});
    // Fire with orbit engaged, without a stop command, through both real input paths.
    // Isolate this scenario from the preceding low-level CDP touch gestures.
    await page.reload();
    await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type === 'webgl2');
    await page.evaluate(async ()=>{
      SpacePiratesAmbient.destroy();
      const {VoyageScene}=await import(new URL('./src/voyage.js?v=aftgun-1',location.href));
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
    assert.equal(hooked.lookTracking,false);
    assert.equal(await page.locator('#dodge-button').isDisabled(),true);
    await page.keyboard.press('Shift');
    assert.equal((await read()).navigation.dodging,false,'Tether prohibits boost');
    await page.keyboard.press('o'); await advance(30);
    assert.equal((await read()).navigation.orbiting,false);
    assert.deepEqual((await read()).navigation.position,hooked.navigation.position,'Anchored ship cannot resume orbit');
    await drag(0,-35,20);assert.deepEqual((await read()).navigation.position,hooked.navigation.position,'Forward pad is locked by the cable');
    await drag(0,10,0,'#look-zone');const corrected=await read();
    assert.notEqual(corrected.steering.y,hooked.steering.y,'Look can correct pitch without vertical strafe');
    assert.deepEqual(corrected.navigation.position,hooked.navigation.position);
    await tap('#boarding-action');
    assert.equal((await read()).mode,'ram-deploy');
    await advance(2);assert.deepEqual((await read()).steering,corrected.steering,'Pull does not snap away from corrected aim');
    await drag(0,-10,0,'#look-zone');
    assert.deepEqual((await read()).navigation.position,hooked.navigation.position,'Pull begins at impact position without a jump');
    await page.keyboard.press('o'); await drag(25,-25,0); await advance(220);
    assert.equal((await read()).navigation.orbiting,false,'Pull never resumes orbit');
    assert.equal(await page.locator('#boarding-panel, #assault-cue').count(),0);
    assert.deepEqual(errors,[]);
    console.log(`Evasion ${mobile?'touch':'mouse'}: PASS (translation/look, tracking, boost, multi-touch, orbital shot, tether/pull lock)`);
    await page.close();
  }
} finally {await browser.close();}
