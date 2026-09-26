import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('qa-output',{recursive:true});
const url=process.argv[2]||'http://localhost:4173/dist/';
const browser=await chromium.launch({channel:process.env.QA_BROWSER||(process.platform==='win32'?'msedge':'chromium'),headless:true});
try {
  for(const mobile of [false,true]) {
    const name=mobile?'mobile':'desktop';
    const page=await browser.newPage(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const read=()=>page.evaluate(()=>engagementQA.getState());
    const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)engagementQA.update(.02);engagementQA.renderStill();},n);
    const snap=stage=>page.screenshot({path:`qa-output/engagement-${stage}-${name}.png`});
    async function fresh() {
      await page.goto(url);await page.waitForFunction(()=>SpacePiratesAmbient?.getState().rendering.type==='webgl2');
      await page.evaluate(async()=>{
        SpacePiratesAmbient.destroy();
        const {VoyageScene}=await import(new URL('./src/voyage.js?v=engagement-1',location.href));
        window.engagementQA=new VoyageScene(document.querySelector('#starfield'));engagementQA.stopLoop();
      });
    }
    const aim=()=>page.evaluate(()=>{
      const s=engagementQA,p=s.navigation.position,t=s.navigation.enemyPosition;
      s.pointer={x:Math.atan2(t.x-p.x,p.z-t.z)/.442,y:Math.atan2(p.y-t.y,Math.hypot(t.x-p.x,t.z-p.z))/.312};s.pointerTarget={...s.pointer};s.renderStill();
    });
    await fresh();let state=await read();assert.equal(state.navigation.speed,0);
    assert.ok(state.navigation.radius>500 && state.navigation.radius<550);
    await snap('arrival');await step(100);assert.deepEqual((await read()).navigation.position,state.navigation.position);
    await page.keyboard.down('w');await step(100);await page.keyboard.up('w');
    assert.equal((await read()).navigation.active,true,'The composed arrival leads into normal combat through real forward input');
    await page.evaluate(()=>engagementQA.forceContact());await aim();
    await page.evaluate(()=>{const s=engagementQA;for(let i=0;i<300 && s.enemyDefense.gunPhase!=='locked';i++)s.update(.02);s.renderStill();});
    state=await read();assert.equal(state.enemyDefense.gunPhase,'locked');assert.equal(state.rendering.engagement.turretsOpen,1);
    await snap('locked');
    // Actual lateral input after lock. No outcome/near-miss state is injected.
    if(mobile) {
      const cdp=await page.context().newCDPSession(page),r=await page.locator('#steering-pad').boundingBox();
      const p={x:r.x+r.width/2,y:r.y+r.height/2};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+50,y:p.y}]});await step(20);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    } else {await page.keyboard.down('d');await step(20);await page.keyboard.up('d');}
    const heading=(await read()).steering;
    await page.evaluate(()=>{const s=engagementQA;for(let i=0;i<100 && !s.enemyDefense.shots;i++)s.update(.02);for(let i=0;i<12;i++)s.update(.02);s.renderStill();});
    assert.ok((await read()).rendering.engagement.boltTrails>0);await snap('incoming');
    await page.evaluate(()=>{const s=engagementQA;for(let i=0;i<200 && !s.enemyDefense.nearMisses;i++)s.update(.02);s.renderStill();});
    state=await read();assert.equal(state.enemyDefense.nearMisses,1);assert.equal(state.enemyDefense.hull,100);
    assert.equal(state.rendering.engagement.nearMissGlow,true);assert.deepEqual(state.steering,heading);
    assert.ok(Math.abs(state.rendering.aimScreen.x-50)<.001 && Math.abs(state.rendering.aimScreen.y-40)<.001);
    await snap('near-miss');
    await page.evaluate(()=>engagementQA.pause());state=await read();await step(50);
    assert.deepEqual((await read()).enemyDefense,state.enemyDefense,'Pause freezes effects and rounds');
    await fresh();await page.evaluate(()=>{const s=engagementQA;s.forceContact();s.navigation.forceRear(true,false);});
    const aimRear=()=>page.evaluate(()=>{
      const s=engagementQA,p=s.navigation.position,t=s.navigation.door;
      s.pointer={x:Math.atan2(t.x-p.x,p.z-t.z)/.442,y:Math.atan2(p.y-t.y,Math.hypot(t.x-p.x,t.z-p.z))/.312};s.pointerTarget={...s.pointer};s.navigation.inspect(s.getView(),.5);s.renderStill();
    });
    await aimRear();await page.keyboard.down('r');
    await page.evaluate(()=>{const s=engagementQA;for(let i=0;i<100 && s.navigation.armorHealth===120;i++)s.update(.02);s.renderStill();});
    await page.keyboard.up('r');state=await read();assert.equal(state.navigation.armorHealth,100);
    assert.ok(state.rendering.engagement.fragments>=10);assert.ok(state.rendering.engagement.scars>0);
    await snap('armor-hit');await step(40);state=await read();assert.equal(state.rendering.engagement.fragments,0);
    assert.ok(state.rendering.engagement.scars>0,'Scorch remains after the burst ends');
    await snap('armor-dent');
    await page.evaluate(()=>{
      const s=engagementQA;s.enemyDefense.reset();s.navigation.angle=Math.PI*.43;s.navigation.elevation=.15;s.navigation.radius=90;s.navigation.updatePosition();
    });await aim();await snap('hull-pass');state=await read();
    assert.ok(state.rendering.drawCalls<350);assert.ok(state.rendering.triangles<22000);
    console.log(name+' rendering',state.rendering.drawCalls,'calls',state.rendering.triangles,'triangles');
    await page.emulateMedia({reducedMotion:'reduce'});await fresh();await page.evaluate(()=>engagementQA.forceContact());await aim();
    await page.evaluate(()=>{const s=engagementQA;for(let i=0;i<300 && s.enemyDefense.gunPhase!=='locked';i++)s.update(.02);s.renderStill();});
    state=await read();assert.equal(state.rendering.engagement.turretsOpen,1,'Physical telegraphs survive reduced motion');
    assert.equal(state.rendering.engagement.nearMissGlow,false);assert.equal(state.rendering.engagement.fragments,0);
    assert.deepEqual(errors,[]);
    console.log(`Engagement ${name} PASS: stationary composed arrival, mechanical charge, real-input near miss, stable camera, persistent damage, close hull, pause and reduced motion`);
    await page.close();
  }
} finally {await browser.close();}
