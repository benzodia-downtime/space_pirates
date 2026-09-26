import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('qa-output',{recursive:true});
const url=process.argv[2]||'http://localhost:4173/dist/';
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});
try {
  for(const mobile of [false,true]) {
    const name=mobile?'mobile':'desktop';
    const page=await browser.newPage(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>SpacePiratesAmbient?.getState().rendering.type==='webgl2');
    await page.evaluate(async()=>{
      SpacePiratesAmbient.destroy();const {VoyageScene}=await import(new URL('./src/voyage.js?v=chase-1',location.href));
      window.chaseQA=new VoyageScene(document.querySelector('#starfield'));chaseQA.stopLoop();
    });
    const read=()=>page.evaluate(()=>chaseQA.getState());
    const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)chaseQA.update(.02);chaseQA.renderStill();},n);
    const snap=stage=>page.screenshot({path:`qa-output/chase-${stage}-${name}.png`});
    const checkAim=async()=>{const p=(await read()).rendering.aimScreen;assert.ok(Math.abs(p.x-50)<.001);assert.ok(Math.abs(p.y-40)<.001);};
    let state=await read();assert.equal(state.rendering.view,'third-person');assert.equal(state.navigation.speed,0);
    assert.ok(Math.hypot(...state.rendering.cameraPosition.map((v,i)=>v-state.rendering.playerPosition[i]))>35);
    assert.equal(await page.locator('.cockpit-shell__glass,.cockpit-shell__canopy,.cockpit-console').count(),0);
    await checkAim();await snap('arrival');
    for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390],[568,320]]) {
      await page.setViewportSize({width,height});await step(0);state=await read();
      const b=state.rendering.playerBounds;
      assert.ok(b.left>3 && b.right<97 && b.top>40 && b.bottom<78,`${width}x${height} ship framing: ${JSON.stringify(b)}`);
      await checkAim();
    }
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:900});await step(0);
    const start=(await read()).navigation.position;
    await page.keyboard.down('w');await step(30);await snap('forward');await page.keyboard.up('w');
    assert.notDeepEqual((await read()).navigation.position,start);
    const stopped=(await read()).navigation.position;await step(20);assert.deepEqual((await read()).navigation.position,stopped);
    await page.keyboard.down('d');await step(15);assert.ok((await read()).rendering.playerBank<0);await snap('strafe');await page.keyboard.up('d');
    const box=await page.locator('#look-zone').boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.4;
    if(mobile) {
      const cdp=await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+25,y:y-15}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    } else {await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y-15);await page.mouse.up();}
    await step(80);state=await read();await step(50);
    assert.ok(Math.abs((await read()).steering.x-state.steering.x)<.03,'Releasing does not reset heading');await checkAim();
    await page.evaluate(()=>{const s=chaseQA;s.forceContact();const view=s.navigation.forceRear(true,false);s.pointer={x:view.yaw/.442,y:view.pitch/.312};s.pointerTarget={...s.pointer};s.renderStill();});
    await checkAim();await snap('rear');
    await page.keyboard.down('r');await step(20);await page.keyboard.up('r');await step(8);
    assert.equal((await read()).navigation.armorHealth,100);await checkAim();await snap('hit');
    await page.evaluate(()=>chaseQA.forceEncounter());state=await read();
    assert.equal(state.mode,'ready');assert.equal(state.rendering.view,'third-person');assert.equal(state.rendering.bridgeVisible,true);
    assert.ok(Math.hypot(...state.rendering.cameraPosition.map((v,i)=>v-state.rendering.playerPosition[i]))>45);
    await snap('docked');
    await page.evaluate(()=>chaseQA.pause());const frozen=await read();await step(100);assert.deepEqual((await read()).rendering.cameraPosition,frozen.rendering.cameraPosition);
    assert.deepEqual(errors,[]);console.log(`Chase ${name} PASS: external hull, five aspect ratios, fixed physical aim, thrust/release, strafe bank, drag, cannon, external docking and pause`);
    await page.close();
  }
} finally {await browser.close();}
