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
    const read=()=>page.evaluate(()=>defenseQA.getState());
    const tap=s=>mobile?page.locator(s).tap():page.locator(s).click();
    async function fresh(rear=false) {
      await page.goto(url);
      await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type==='webgl2');
      await page.evaluate(async rear=>{
        SpacePiratesAmbient.destroy();
        const {VoyageScene}=await import(new URL('./src/voyage.js?v=turret360-1',location.href));
        window.defenseQA=new VoyageScene(document.querySelector('#starfield'));
        const s=defenseQA;s.stopLoop();s.forceContact();
        const view=rear?s.navigation.forceRear(true):s.getView();
        if(!rear) {const target=s.getActualBearing();view.yaw=target.x*.65;view.pitch=target.y*.65;}
        s.pointer={x:view.yaw/.442,y:view.pitch/.312};s.pointerTarget={...s.pointer};s.renderStill();
      },rear);
    }
    const step=frames=>page.evaluate(n=>{for(let i=0;i<n;i++)defenseQA.update(.02);defenseQA.renderStill();},frames);
    async function drag(dx,dy) {
      const box=await page.locator('#steering-pad').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
      if(mobile) {
        const touch=await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
      } else {await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:3});await page.mouse.up();}
      await step(1);
    }
    async function latch() {
      await fresh(true);assert.equal((await read()).navigation.canHarpoon,true);
      await tap('#boarding-action');await step(40);assert.equal((await read()).mode,'tethered');
    }
    async function layout(stage) {
      const original=page.viewportSize();
      for(const [width,height] of [[1440,900],[390,844],[320,568],[568,320]]) {
        await page.setViewportSize({width,height});await step(0);
        const issues=await page.evaluate(()=>{
          const issues=[],dock=document.querySelector('.hud-bottom').getBoundingClientRect();
          if(dock.top<innerHeight*.65)issues.push('dock above bottom 35%');
          for(const el of document.querySelectorAll('.voyage-ui button, #steering-pad')) {
            if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
            if(r.width<44||r.height<44||r.left<0||r.right>innerWidth+.5||r.bottom>innerHeight+.5)issues.push(el.id);
            if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))issues.push(el.id+' obscured');
          }
          return issues;
        });assert.deepEqual(issues,[],stage+' '+width+'x'+height);
      }
      await page.setViewportSize(original);await step(0);
    }
    const until=async(phase)=>{
      const reached=await page.evaluate(target=>{
        for(let i=0;i<2000;i++) {if(defenseQA.enemyDefense.gunPhase===target)return true;defenseQA.update(.02);}
        return false;
      },phase);assert.ok(reached,phase);await step(0);
    };
    await fresh();
    await until('aim');await step(45);
    assert.equal((await read()).rendering.enemyAimVisible,true);
    await page.screenshot({path:`qa-output/defense-charge-${mobile?'mobile':'desktop'}.png`});
    await until('locked');
    const locked=await read();
    assert.equal(locked.rendering.turretChargeColor,0xff4830);
    await page.screenshot({path:`qa-output/defense-lock-${mobile?'mobile':'desktop'}.png`});
    // Actual UI settings pause freezes enemy state and returns cleanly.
    await tap('#settings-button');
    const paused=await read();await page.waitForTimeout(100);
    assert.deepEqual((await read()).enemyDefense,paused.enemyDefense);
    await tap('#settings-close');await page.evaluate(()=>defenseQA.stopLoop());
    // Upward orbit after the red lock dodges a fixed, non-homing shot.
    await tap('#orbit-button');
    if(mobile) {
      const touch=await page.context().newCDPSession(page),box=await page.locator('#steering-pad').boundingBox();
      const x=box.x+box.width/2,y=box.y+box.height/2;
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-30}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {await page.keyboard.down('ArrowUp');await step(1);await page.keyboard.up('ArrowUp');}
    await step(70);
    assert.ok((await read()).enemyDefense.shots>=1);
    assert.ok((await read()).rendering.enemyBoltsVisible>0);
    await page.screenshot({path:`qa-output/defense-dodge-${mobile?'mobile':'desktop'}.png`});
    await step(110);assert.equal((await read()).enemyDefense.hull,100,'Changing orbit after lock avoids damage');
    assert.ok((await read()).navigation.position.y>locked.navigation.position.y+30);

    await fresh();await step(400);await until('aim');await step(40);
    assert.equal((await read()).enemyDefense.pattern,'fan');assert.equal((await read()).rendering.enemyAimRays,9);
    await page.screenshot({path:`qa-output/fan-${mobile?'mobile':'desktop'}.png`});
    await until('locked');await step(63);assert.equal((await read()).rendering.enemyBoltsVisible,9);

    for(const [name,angle,elevation] of [['starboard',Math.PI/2,0],['port',-Math.PI/2,0],['rear',Math.PI,0],['above',Math.PI/2,1]]) {
      await fresh();
      await page.evaluate(({angle,elevation})=>{
        const s=defenseQA;s.navigation.angle=angle;s.navigation.elevation=elevation;s.navigation.updatePosition();
        const p=s.navigation.position,t=s.navigation.enemyPosition,dx=t.x-p.x,dy=t.y-p.y,dz=t.z-p.z;
        // This fixture teleports between viewpoints: choose an upright view, not orbital Euler continuity.
        s.pointer={x:Math.atan2(dx,-dz)/.442,y:Math.atan2(-dy,Math.hypot(dx,dz))/.312};s.pointerTarget={...s.pointer};s.renderStill();
      },{angle,elevation});
      await until('aim');await step(45);
      const state=await read(),gun=state.rendering.gunMounts.find(g=>g.mount==='dorsal'),aim=state.enemyDefense.aimPoint;
      assert.equal(state.rendering.activeGun,'dorsal',name+' uses the visible roof turret');
      assert.equal(state.rendering.enemyAimVisible,true);
      assert.ok(gun.position[1]>state.navigation.enemyPosition.y+19);
      const target=[aim.x,aim.y,aim.z].map((v,i)=>v-gun.position[i]),length=Math.hypot(...target);
      assert.ok(target.reduce((sum,v,i)=>sum+v/length*gun.direction[i],0)>.99999,name+' barrel points at its actual aim point');
      await page.screenshot({path:`qa-output/turret-${name}-${mobile?'mobile':'desktop'}.png`});
      await until('locked');await step(65);assert.ok((await read()).rendering.enemyBoltsVisible>0);
      await step(100);assert.equal((await read()).enemyDefense.hull,75,name+' shot actually reaches a stationary player');
    }

    await latch();const tetherShots=(await read()).enemyDefense.shots;await step(1000);
    assert.equal((await read()).enemyDefense.phase,'tethered');
    assert.equal((await read()).rendering.enemyAimVisible,false);assert.equal((await read()).rendering.enemyBoltsVisible,0);
    assert.equal((await read()).enemyDefense.shots,tetherShots);assert.equal((await read()).enemyDefense.hull,100,'No counterfire after attachment');
    await page.screenshot({path:`qa-output/tether-ceasefire-${mobile?'mobile':'desktop'}.png`});
    await drag(0,-45);await step(105);
    assert.ok((await read()).navigation.correction.y>8,'Alignment input remains available');
    const held=(await read()).navigation.position;await step(10);assert.deepEqual((await read()).navigation.position,held);

    await latch();await tap('#boarding-action');await step(80);
    assert.equal((await read()).mode,'charge');assert.equal((await read()).steeringLocked,false);
    await drag(18,0);await step(112);
    let ram=await read();assert.equal(ram.mode,'jammed');assert.equal(ram.collision,'graze');assert.ok(ram.enemyDefense.hull<=90);
    assert.equal(ram.breachProgress,0);await step(1000);assert.equal((await read()).mode,'jammed');
    assert.equal((await read()).enemyDefense.hull,90,'Jammed ram costs collision damage only, no counterfire');
    await layout('jammed');await page.screenshot({path:`qa-output/ram-jammed-${mobile?'mobile':'desktop'}.png`});
    await drag(-18,0);await step(30);
    assert.equal((await read()).mode,'impact');assert.equal((await read()).enemyDefense.gunPhase,'idle');
    await step(350);ram=await read();assert.equal(ram.mode,'ready');assert.equal(ram.rendering.armourBreached,true);
    await page.screenshot({path:`qa-output/ram-recovered-${mobile?'mobile':'desktop'}.png`});

    await latch();await tap('#boarding-action');await step(80);await drag(48,0);await step(112);
    ram=await read();assert.equal(ram.mode,'rebound');assert.equal(ram.collision,'miss');assert.equal(ram.breachProgress,0);
    await layout('rebound');await step(50);ram=await read();
    assert.equal(ram.mode,'survey');assert.equal(ram.navigation.anchor,null);assert.equal(ram.navigation.canOrbit,true);
    assert.equal(ram.rendering.bridgeVisible,false);assert.equal(ram.enemyDefense.hull,80);
    const recovered=ram.navigation.position;await step(1);assert.deepEqual((await read()).navigation.position,recovered);

    await latch();await tap('#boarding-action');await step(540);
    assert.equal((await read()).mode,'ready','Centered ram completes without an artificial forced miss');
    await latch();await page.evaluate(()=>{defenseQA.enemyDefense.hull=20;});
    await tap('#boarding-action');await step(80);await drag(48,0);await step(112);
    assert.equal((await read()).mode,'defeated','Ram collision damage can disable the ship');
    assert.equal((await read()).enemyDefense.hull,0);
    await fresh();await step(1600);
    const failed=await read();assert.equal(failed.enemyDefense.hull,0);assert.equal(failed.mode,'defeated');
    assert.equal(await page.locator('#boarding-action-label').innerText(),'다시 도전');
    assert.equal(await page.locator('#thrust-forward').isDisabled(),true);
    const p=failed.navigation.position;
    await page.keyboard.press('o');await page.keyboard.down('w');await step(20);await page.keyboard.up('w');
    assert.deepEqual((await read()).navigation.position,p);
    await page.screenshot({path:`qa-output/defense-defeated-${mobile?'mobile':'desktop'}.png`});
    await tap('#boarding-action');
    const reset=await read();assert.equal(reset.enemyDefense.hull,100);assert.equal(reset.mode,'survey');
    assert.equal(reset.navigation.radius,220);assert.equal(reset.enemyDefense.shots,0);
    assert.equal(await page.locator('#boarding-panel, #assault-cue, #orbit-direction').count(),0);
    assert.deepEqual(errors,[]);
    console.log(`Defense ${mobile?'mobile':'desktop'} PASS: visible 360-degree roof turret, side/rear/above hits, focused/fan telegraphs, immediate tether ceasefire, ram recovery/retry, pause, compact HUD`);
    await page.close();
  }
} finally {await browser.close();}
