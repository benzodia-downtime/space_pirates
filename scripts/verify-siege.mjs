import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('qa-output',{recursive:true});
const url=process.argv[2]||'http://localhost:4173/dist/';
const browser=await chromium.launch({channel:process.env.QA_BROWSER||(process.platform==='win32'?'msedge':'chromium'),headless:true});
try {
  for(const mobile of [false,true]) {
    const page=await browser.newPage(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const read=()=>page.evaluate(()=>siegeQA.getState());
    const step=frames=>page.evaluate(n=>{for(let i=0;i<n;i++)siegeQA.update(.02);siegeQA.renderStill();},frames);
    const aim=()=>page.evaluate(()=>{
      const s=siegeQA,p=s.navigation.position,t=s.navigation.door,dx=t.x-p.x,dy=t.y-p.y,dz=t.z-p.z;
      s.pointer={x:Math.atan2(dx,-dz)/.442,y:Math.atan2(-dy,Math.hypot(dx,dz))/.312};s.pointerTarget={...s.pointer};
      s.navigation.inspect(s.getView(),.5);s.renderStill();
    });
    async function fresh() {
      await page.goto(url);await page.waitForFunction(()=>SpacePiratesAmbient?.getState().rendering.type==='webgl2');
      await page.evaluate(async()=>{
        SpacePiratesAmbient.destroy();const {VoyageScene}=await import(new URL('./src/voyage.js?v=aftgun-1',location.href));
        window.siegeQA=new VoyageScene(document.querySelector('#starfield'));
        siegeQA.stopLoop();siegeQA.forceContact();siegeQA.navigation.forceRear(true,false);
      });await aim();
    }
    const tap=async selector=>{if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();};
    async function hold(frames) {
      if(!mobile) {await page.keyboard.down('r');await step(frames);await page.keyboard.up('r');return;}
      const cdp=await page.context().newCDPSession(page),box=await page.locator('#cannon-button').boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:box.x+box.width/2,y:box.y+box.height/2}]});
      await step(frames);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    }
    async function layout(stage) {
      const original=page.viewportSize();
      for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,568],[844,390],[568,320]]) {
        await page.setViewportSize({width,height});await step(0);
        const issues=await page.evaluate(()=>{
          const issues=[],dock=document.querySelector('.hud-bottom').getBoundingClientRect();
          if(dock.top<innerHeight*.65)issues.push('dock above bottom 35%');
          for(const el of document.querySelectorAll('.voyage-ui button, #steering-pad')) {
            if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
            if(r.width<44||r.height<44||r.left<0||r.right>innerWidth+.5||r.bottom>innerHeight+.5)issues.push(el.id+' bounds');
            if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))issues.push(el.id+' obscured');
          }return issues;
        });assert.deepEqual(issues,[],stage+' '+width+'x'+height);
      }await page.setViewportSize(original);await step(0);
    }
    await fresh();
    assert.equal((await read()).navigation.armorHealth,120);assert.equal((await read()).navigation.canHarpoon,false);
    assert.equal(await page.locator('#boarding-action').isDisabled(),true);
    assert.equal((await read()).rendering.rearArmorVisible,true);assert.equal((await read()).rendering.anchorFrameVisible,false);
    await page.keyboard.press('f');await step(1);assert.equal((await read()).mode,'survey');
    await layout('sealed');await page.screenshot({path:`qa-output/siege-sealed-${mobile?'mobile':'desktop'}.png`});
    await hold(85);let state=await read();
    assert.equal(state.cannon.shots,3);assert.equal(state.navigation.armorHealth,60);assert.ok(state.rendering.rearArmorCracks>0);
    assert.equal(state.navigation.canHarpoon,false);assert.match(await page.locator('#cannon-button').innerText(),/장전/);
    await page.screenshot({path:`qa-output/siege-damaged-${mobile?'mobile':'desktop'}.png`});
    // Reverse and release during reload. Damage survives this real movement, not a reset fixture.
    await page.keyboard.down('s');await step(30);await page.keyboard.up('s');await step(110);await aim();
    assert.equal((await read()).navigation.armorHealth,60);assert.equal((await read()).cannon.shots,3);
    await hold(95);state=await read();
    assert.equal(state.cannon.shots,6);assert.equal(state.navigation.armorHealth,0);assert.equal(state.cannon.armorHits,6);
    assert.ok(state.enemyDefense.shots>0,'Enemy continues shooting until harpoon impact');assert.notEqual(state.enemyDefense.phase,'tethered');
    assert.equal(state.rendering.armourBreached,false,'Inner ramp still awaits the ram');
    await step(90);await aim();state=await read();
    assert.equal(state.rendering.rearArmorVisible,false);assert.equal(state.rendering.anchorFrameVisible,true);assert.equal(state.navigation.canHarpoon,true);
    await layout('exposed');await page.screenshot({path:`qa-output/siege-exposed-${mobile?'mobile':'desktop'}.png`});
    await tap('#boarding-action');await step(40);state=await read();assert.equal(state.mode,'tethered');
    assert.equal(state.enemyDefense.phase,'tethered');assert.equal(state.rendering.enemyBoltsVisible,0);assert.equal(state.shooting,false);
    assert.equal(await page.locator('#cannon-button').isDisabled(),true);
    const enemyShots=state.enemyDefense.shots;await step(150);assert.equal((await read()).enemyDefense.shots,enemyShots);
    await tap('#boarding-action');await step(540);state=await read();assert.equal(state.mode,'ready');assert.equal(state.rendering.armourBreached,true);
    await layout('board-ready');await page.screenshot({path:`qa-output/siege-boarded-${mobile?'mobile':'desktop'}.png`});

    await fresh();
    if(mobile) {
      const cdp=await page.context().newCDPSession(page);
      const pad=await page.locator('#steering-pad').boundingBox(),gun=await page.locator('#cannon-button').boundingBox();
      const a={id:1,x:pad.x+pad.width/2,y:pad.y+pad.height/2},b={id:2,x:gun.x+gun.width/2,y:gun.y+gun.height/2};
      const initial=(await read()).navigation.position;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
      a.x+=24;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[a]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});await step(30);
      state=await read();assert.ok(state.cannon.shots>=2,'Second thumb fires while movement finger is held');assert.notDeepEqual(state.navigation.position,initial);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[b]});
      const released=await read(),shots=released.cannon.shots;await step(30);assert.equal((await read()).cannon.shots,shots,'Release really stops shooting');
      assert.notDeepEqual((await read()).navigation.position,released.navigation.position,'First thumb remains in control after releasing the gun');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();
    } else {
      const zone=await page.locator('#look-zone').boundingBox();await page.mouse.move(zone.x+zone.width*.5,zone.y+zone.height*.4);
      await page.mouse.down({button:'right'});await step(3);state=await read();assert.equal(state.cannon.shots,1);assert.ok(state.rendering.playerBoltsVisible>0);
      await page.screenshot({path:'qa-output/siege-firing-desktop.png'});
      await page.mouse.up({button:'right'});await step(60);assert.equal((await read()).cannon.shots,1);
      await page.locator('#cannon-button').focus();const p=(await read()).navigation.position;
      await page.keyboard.down('Space');await step(2);await page.keyboard.up('Space');await step(30);
      assert.equal((await read()).cannon.shots,2);assert.deepEqual((await read()).navigation.position,p,'Focused gun Space fires without ascent');
      // Mouse chord: start looking first, then press/release fire without ending the drag.
      await page.mouse.move(zone.x+zone.width*.5,zone.y+zone.height*.4);await page.mouse.down();
      await page.mouse.down({button:'right'});await step(2);assert.equal((await read()).cannon.shots,3);
      await page.mouse.up({button:'right'});await step(230);assert.equal((await read()).cannon.shots,3);
      const heading=(await read()).steering.x;await page.mouse.move(zone.x+zone.width*.5+20,zone.y+zone.height*.4);await page.mouse.up();
      assert.ok((await read()).steering.x>heading,'Left drag remains active after releasing right fire');
    }
    await fresh();await page.keyboard.down('r');await step(1);await page.evaluate(()=>dispatchEvent(new Event('blur')));
    await step(60);assert.equal((await read()).cannon.shots,1);assert.equal((await read()).shooting,false);await page.keyboard.up('r');
    await page.keyboard.down('r');await step(1);await tap('#settings-button');const paused=await read();
    await step(100);assert.deepEqual((await read()).cannon,paused.cannon);assert.equal((await read()).shooting,false);await page.keyboard.up('r');
    await tap('#settings-close');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.evaluate(()=>siegeQA.stopLoop());await step(60);assert.equal((await read()).cannon.shots,paused.cannon.shots);
    await page.evaluate(()=>siegeQA.startNewSearch());state=await read();assert.equal(state.navigation.armorHealth,120);assert.equal(state.cannon.shots,0);assert.equal(state.cannon.rounds,3);
    await page.emulateMedia({reducedMotion:'reduce'});await fresh();await hold(85);await step(140);await aim();await hold(95);await step(1);
    state=await read();assert.equal(state.navigation.armorHealth,0);assert.equal(state.rendering.rearArmorVisible,false);
    assert.equal(state.rendering.anchorFrameVisible,true);assert.deepEqual(errors,[]);
    console.log(`Siege ${mobile?'mobile':'desktop'} PASS: real fire/reload, six hits, persistent armor, visible break, harpoon gate/ceasefire, ram, inputs/pause/reset and seven layouts`);
    await page.close();
  }
} finally {await browser.close();}
