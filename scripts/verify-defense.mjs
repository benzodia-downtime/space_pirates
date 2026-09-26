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
    const tap=async s=>{
      if(mobile)await page.locator(s).tap();else await page.locator(s).click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    };
    async function fresh(rear=false) {
      await page.goto(url);
      await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type==='webgl2');
      await page.evaluate(async rear=>{
        SpacePiratesAmbient.destroy();
        const {VoyageScene}=await import(new URL('./src/voyage.js?v=enemyorbit-1',location.href));
        window.defenseQA=new VoyageScene(document.querySelector('#starfield'));
        const s=defenseQA;s.stopLoop();s.forceContact();
        const view=rear?s.navigation.forceRear(true):s.getView();
        if(!rear) {const target=s.getActualBearing();view.yaw=target.x*.65;view.pitch=target.y*.65;}
        s.pointer={x:view.yaw/.442,y:view.pitch/.312};s.pointerTarget={...s.pointer};s.renderStill();
      },rear);
    }
    const step=frames=>page.evaluate(n=>{for(let i=0;i<n;i++)defenseQA.update(.02);defenseQA.renderStill();},frames);
    const aimDoor=()=>page.evaluate(()=>{
      const s=defenseQA,p=s.navigation.position,t=s.navigation.door,dx=t.x-p.x,dy=t.y-p.y,dz=t.z-p.z;
      s.pointer={x:Math.atan2(dx,-dz)/.442,y:Math.atan2(-dy,Math.hypot(dx,dz))/.312};s.pointerTarget={...s.pointer};
      s.navigation.inspect(s.getView(),.5);s.renderStill();
    });
    async function drag(dx,dy,frames=Math.round(Math.hypot(dx,dy)*.18/8/.02),selector='#steering-pad') {
      const box=await page.locator(selector).boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
      if(mobile) {
        const touch=await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
        await step(frames);
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
      } else {await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:3});await step(frames);await page.mouse.up();}
      await step(1);
    }
    async function latch() {
      await fresh(true);assert.equal((await read()).navigation.canHarpoon,true);
      await tap('#boarding-action');await step(40);assert.equal((await read()).mode,'tethered');
      await aimDoor();
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
    // Real encounter activation, without forceContact bypassing the detection gate.
    await fresh();await page.evaluate(()=>{
      const s=defenseQA;s.startNewSearch();s.stopLoop();s.navigation.radius=440.1;s.navigation.updatePosition();
      const p=s.navigation.position,t=s.navigation.enemyPosition,dx=t.x-p.x,dy=t.y-p.y,dz=t.z-p.z;
      s.pointer={x:Math.atan2(dx,-dz)/.442,y:Math.atan2(-dy,Math.hypot(dx,dz))/.312};s.pointerTarget={...s.pointer};s.renderStill();
    });
    await step(400);assert.equal((await read()).navigation.active,false);assert.equal((await read()).enemyDefense.shots,0);
    await page.keyboard.down('w');await step(1);await page.keyboard.up('w');
    assert.equal((await read()).navigation.active,true);assert.equal((await read()).mode,'survey');
    assert.ok((await read()).navigation.radius>430,'Detects at 440m rather than the old 220m');
    await until('locked');await step(0);await page.screenshot({path:`qa-output/range-lock-${mobile?'mobile':'desktop'}.png`});
    await step(180);assert.equal((await read()).enemyDefense.hull,75,'Distant fire actually reaches the player');
    await fresh();await page.evaluate(()=>{
      const s=defenseQA;s.navigation.radius=1200;s.navigation.updatePosition();s.enemyDefense.reset();
    });
    await until('locked');await step(340);
    assert.equal((await read()).enemyDefense.hull,75,'Rounds still reach the player at the doubled 1200m range');
    await fresh();
    const orbitStart=await read();await step(80);let moving=await read();
    assert.notDeepEqual(moving.navigation.enemyPosition,orbitStart.navigation.enemyPosition);
    assert.deepEqual(moving.navigation.position,orbitStart.navigation.position);
    assert.deepEqual(moving.steering,orbitStart.steering,'Enemy movement cannot drag the manual camera');
    assert.ok(Math.abs(moving.navigation.radius-orbitStart.navigation.radius)<1e-8);
    assert.deepEqual(moving.rendering.enemyPosition,Object.values(moving.navigation.enemyPosition));
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
    // Real pad/keyboard translation after lock avoids the non-homing salvo.
    if(mobile) await drag(35,0,60);
    else {await page.locator('#steering-pad').focus();await page.keyboard.down('d');await page.keyboard.press('Shift');await step(60);await page.keyboard.up('d');}
    await step(10);
    assert.ok((await read()).enemyDefense.shots>=1);
    assert.ok((await read()).rendering.enemyBoltsVisible>0);
    await page.screenshot({path:`qa-output/defense-dodge-${mobile?'mobile':'desktop'}.png`});
    await step(110);assert.equal((await read()).enemyDefense.hull,100,'Translating after lock avoids damage');
    const dodged=(await read()).navigation.position;
    assert.ok(Math.hypot(dodged.x-locked.navigation.position.x,dodged.z-locked.navigation.position.z)>30);

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
      const state=await read(),mount=name==='rear'?'stern':'dorsal',gun=state.rendering.gunMounts.find(g=>g.mount===mount),aim=state.enemyDefense.aimPoint;
      assert.equal(state.rendering.gunMounts.length,3);assert.equal(state.rendering.activeGun,mount,name+' uses its visible turret');
      assert.equal(state.rendering.enemyAimVisible,true);
      assert.ok(gun.position[1]>state.navigation.enemyPosition.y+(mount==='stern'?15:19));
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
    await drag(45,0);await step(105);
    assert.ok((await read()).navigation.correction.x>8,'Lateral alignment remains available');
    assert.equal((await read()).navigation.correction.y,0,'No vertical alignment movement');
    const held=(await read()).navigation.position;await step(10);assert.deepEqual((await read()).navigation.position,held);

    for(const phase of ['aim','locked']) {
      await fresh(true);await until(phase);await aimDoor();
      assert.equal((await read()).navigation.canHarpoon,true);
      await tap('#boarding-action');await step(36);
      const attached=await read();assert.equal(attached.mode,'tethered');
      assert.equal(attached.enemyDefense.finishingAttack,true);
      assert.equal(attached.rendering.enemyAimVisible,true);
      await step(180);const finished=await read();
      assert.equal(finished.enemyDefense.shots,1);assert.equal(finished.enemyDefense.hull,75);
      assert.deepEqual(finished.navigation.enemyPosition,attached.navigation.enemyPosition);
      await step(600);assert.equal((await read()).enemyDefense.shots,1,'No second attack after the queued volley');
    }

    await latch();await tap('#boarding-action');await step(80);
    assert.equal((await read()).mode,'charge');assert.equal((await read()).steeringLocked,false);
    await drag(18,0);await step(92);
    let ram=await read();assert.equal(ram.mode,'jammed');assert.equal(ram.collision,'graze');assert.ok(ram.enemyDefense.hull<=90);
    assert.equal(ram.breachProgress,0);await step(1000);assert.equal((await read()).mode,'jammed');
    assert.equal((await read()).enemyDefense.hull,90,'Jammed ram costs collision damage only, no counterfire');
    await layout('jammed');await page.screenshot({path:`qa-output/ram-jammed-${mobile?'mobile':'desktop'}.png`});
    await drag(-18,0);await step(30);
    assert.equal((await read()).mode,'impact');assert.equal((await read()).enemyDefense.gunPhase,'idle');
    await step(350);ram=await read();assert.equal(ram.mode,'ready');assert.equal(ram.rendering.armourBreached,true);
    await page.screenshot({path:`qa-output/ram-recovered-${mobile?'mobile':'desktop'}.png`});

    // A vertical aim error must remain recoverable without any vertical thrust binding.
    await latch();await drag(0,30,0,'#look-zone');
    const correctedView=(await read()).steering;await tap('#boarding-action');await step(200);
    assert.equal((await read()).mode,'jammed');assert.deepEqual((await read()).steering,correctedView);
    assert.equal((await read()).navigation.correction.y,0);
    await drag(0,-30,0,'#look-zone');await step(25);assert.equal((await read()).mode,'impact');
    await step(350);assert.equal((await read()).mode,'ready');

    await latch();await tap('#boarding-action');await step(80);await drag(48,0);await step(58);
    ram=await read();assert.equal(ram.mode,'rebound');assert.equal(ram.collision,'miss');assert.equal(ram.breachProgress,0);
    await layout('rebound');await step(50);ram=await read();
    assert.equal(ram.mode,'survey');assert.equal(ram.navigation.anchor,null);assert.equal(ram.navigation.canOrbit,true);
    assert.equal(ram.rendering.bridgeVisible,false);assert.equal(ram.enemyDefense.hull,80);
    const recovered=ram.navigation.position;await step(1);assert.deepEqual((await read()).navigation.position,recovered);

    await latch();await tap('#boarding-action');await step(540);
    assert.equal((await read()).mode,'ready','Centered ram completes without an artificial forced miss');
    await latch();await page.evaluate(()=>{defenseQA.enemyDefense.hull=20;});
    await tap('#boarding-action');await step(80);await drag(48,0);await step(58);
    assert.equal((await read()).mode,'defeated','Ram collision damage can disable the ship');
    assert.equal((await read()).enemyDefense.hull,0);
    await fresh();await step(1600);
    const failed=await read();assert.equal(failed.enemyDefense.hull,0);assert.equal(failed.mode,'defeated');
    assert.equal(await page.locator('#boarding-action-label').innerText(),'다시 도전');
    assert.equal(await page.locator('#thrust-forward, #thrust-reverse').count(),0);
    const p=failed.navigation.position;
    await page.keyboard.press('o');await page.keyboard.down('w');await step(20);await page.keyboard.up('w');
    assert.deepEqual((await read()).navigation.position,p);
    await page.screenshot({path:`qa-output/defense-defeated-${mobile?'mobile':'desktop'}.png`});
    await tap('#boarding-action');
    const reset=await read();assert.equal(reset.enemyDefense.hull,100);assert.equal(reset.mode,'survey');
    assert.equal(reset.navigation.radius,440);assert.equal(reset.enemyDefense.shots,0);
    assert.equal(await page.locator('#boarding-panel, #assault-cue, #orbit-direction').count(),0);
    assert.deepEqual(errors,[]);
    console.log(`Defense ${mobile?'mobile':'desktop'} PASS: moving enemy orbit, three turrets, focused/fan telegraphs, queued tether counterfire, ram recovery/retry, pause, compact HUD`);
    await page.close();
  }
} finally {await browser.close();}
