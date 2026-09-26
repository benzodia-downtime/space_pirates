import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const url=process.argv[2]||'http://localhost:4173/dist/';
await mkdir('qa-output',{recursive:true});
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});
try {
  for(const mobile of [false,true]) {
    const page=await browser.newPage(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const read=()=>page.evaluate(()=>SpacePiratesBattle.getState());
    const step=n=>page.evaluate(n=>{SpacePiratesBattle.stopLoop();for(let i=0;i<n;i++)SpacePiratesBattle.update(.02);SpacePiratesBattle.redraw();},n);
    const tap=async selector=>{if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
    async function fresh() {
      await page.goto(url);await page.waitForFunction(()=>window.SpacePiratesBattle);
      await page.evaluate(()=>{SpacePiratesBattle.start();});assert.equal((await read()).active,false,'Cannot bypass the ship breach');
      await page.evaluate(()=>SpacePiratesAmbient.forceEncounter());await tap('#battle-start');await step(0);
    }
    async function drag(dx,dy,selector='#battle-look',frames=0) {
      const b=await page.locator(selector).boundingBox(),x=b.x+b.width*.65,y=b.y+b.height*.42;
      if(mobile) {
        const cdp=await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:x+dx,y:y+dy}]});await step(frames);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
      } else {await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.move(x+dx,y+dy);await step(frames);await page.mouse.up({button:'right'});}
      await step(0);
    }
    async function aim() {
      for(let i=0;i<5;i++) {
        const s=await read(),cam=s.rendering.camera,dx=s.enemy.x-cam[0],dz=s.enemy.z-cam[2];
        const yaw=Math.atan2(dx,-dz),pitch=Math.atan2(cam[1]-1.25,Math.hypot(dx,dz));
        const err=Math.atan2(Math.sin(yaw-s.view.yaw),Math.cos(yaw-s.view.yaw));
        await drag(err/.005,(pitch-s.view.pitch)/.004);
      }
    }
    await fresh();let s=await read();
    assert.equal(s.rendering.type,'webgl2');assert.equal(s.rendering.player.type,'articulated-human');assert.equal(s.player.health,100);assert.equal(s.enemy.health,50);
    assert.ok(s.rendering.drawCalls<100,'Instancing keeps room and animated human draw calls bounded');assert.ok(s.rendering.triangles<12000);
    assert.equal(await page.locator('#battle-level img').count(),0,'No 2D sprite remains in combat');
    await page.screenshot({path:`qa-output/tps-idle-${mobile?'mobile':'desktop'}.png`});
    const original=page.viewportSize();
    for(const [width,height] of [[1440,900],[390,844],[320,568],[844,390],[568,320]]) {
      await page.setViewportSize({width,height});await step(0);
      const issues=await page.evaluate(()=>{
        const els=[...document.querySelectorAll('#battle-controls button,#battle-pad,#battle-pause')],issues=[];
        for(const el of els){const r=el.getBoundingClientRect();if(r.width<44||r.height<44||r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight)issues.push(el.id+' bounds');if(!el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))issues.push(el.id+' covered');}
        return issues;
      });assert.deepEqual(issues,[],`${width}x${height}`);
    }
    await page.setViewportSize(original);await step(0);
    const p={...s.player};await drag(0,-30,'#battle-pad',20);s=await read();assert.ok(s.player.z<p.z-1);
    assert.notEqual(s.rendering.player.leftLeg,s.rendering.player.rightLeg,'Actual joints animate during movement');
    await page.screenshot({path:`qa-output/tps-walk-${mobile?'mobile':'desktop'}.png`});
    const stopped=s.player.z;await step(10);assert.equal((await read()).player.z,stopped);
    await drag(30,10);assert.ok((await read()).view.yaw>.1);assert.equal((await read()).player.z,stopped);
    await tap('#battle-crouch');await step(1);assert.equal((await read()).player.state,'crouch');
    await page.screenshot({path:`qa-output/tps-crouch-${mobile?'mobile':'desktop'}.png`});
    await tap('#battle-crouch');await tap('#battle-aim');await step(1);assert.equal((await read()).rendering.fov,48);
    await tap('#battle-pause');const paused=await read();await step(100);assert.deepEqual((await read()).player,paused.player);
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'battle-return');
    await tap('#battle-resume');await step(0);
    if(!mobile) {
      await fresh();const b=await page.locator('#battle-look').boundingBox(),x=b.width*.7,y=b.height*.4;
      await page.mouse.move(x,y);await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});await step(14);
      const chord=await read();assert.equal(chord.aiming,true);assert.ok(chord.shots>=2,'LMB fires while RMB aim stays held: '+JSON.stringify(chord));
      await page.mouse.up({button:'right'});const count=chord.shots;await step(14);assert.ok((await read()).shots>count,'Releasing aim does not cancel held fire');
      await page.mouse.up({button:'left'});const release=(await read()).shots;await step(15);assert.equal((await read()).shots,release);
    }
    await fresh();await aim();
    if(mobile) {
      const cdp=await page.context().newCDPSession(page),p=await page.locator('#battle-pad').boundingBox(),g=await page.locator('#battle-fire').boundingBox();
      const a={id:1,x:p.x+p.width/2,y:p.y+p.height/2},b={id:2,x:g.x+g.width/2,y:g.y+g.height/2};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});a.x+=24;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[a]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});await step(15);
      s=await read();assert.ok(s.player.x>.5);assert.ok(s.shots>=2,'Second thumb fires during movement');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await cdp.detach();
      const released=await read();await step(20);s=await read();assert.equal(s.shots,released.shots);assert.equal(s.player.x,released.player.x);
      await fresh();
    }
    // Real aim drags and fire-button input, no health or battle-result injection.
    for(let i=0;i<7&&(await read()).phase==='active';i++) {await aim();await tap('#battle-fire');await step(1);if(i===0)await page.screenshot({path:`qa-output/tps-fire-${mobile?'mobile':'desktop'}.png`});await step(13);}
    s=await read();assert.equal(s.phase,'victory');assert.equal(s.enemy.health,0);assert.equal(s.hits,5);
    await step(10);await page.screenshot({path:`qa-output/tps-down-${mobile?'mobile':'desktop'}.png`});await step(45);
    assert.equal(await page.locator('#battle-result').isVisible(),true);
    await tap('#battle-result-action');assert.deepEqual(await page.evaluate(()=>SpacePiratesBattle.getCargo()),{fuelCells:2,ammoCrates:1,medicalSupplies:1});
    await tap('#battle-result-action');assert.equal((await read()).active,false);assert.equal(await page.evaluate(()=>SpacePiratesAmbient.getState().mode),'cruise');
    await fresh();await step(2000);assert.equal((await read()).phase,'defeat');await step(60);
    await tap('#battle-result-action');await step(0);assert.equal((await read()).player.health,100);assert.equal((await read()).enemy.health,50);
    await page.keyboard.down('w');await step(10);await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.keyboard.up('w');
    assert.equal((await read()).paused,true);assert.equal((await read()).input.z,0);
    await fresh();await page.emulateMedia({reducedMotion:'reduce'});await tap('#battle-fire');await step(1);
    assert.equal((await read()).rendering.player.muzzleVisible,false);assert.ok((await read()).shots>0);
    // GPU interruption must pause gameplay and expose a usable recovery path.
    await page.evaluate(()=>document.querySelector('#battle-canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
    assert.equal((await read()).paused,true);assert.equal(await page.locator('#battle-graphics-error').isVisible(),true);
    await page.evaluate(()=>document.querySelector('#battle-canvas').dispatchEvent(new Event('webglcontextrestored')));
    await tap('#battle-resume');await step(1);assert.equal((await read()).rendering.type,'webgl2');
    assert.deepEqual(errors,[]);console.log(`TPS ${mobile?'mobile':'desktop'} PASS: 3D rig/animation, shoulder camera, controls, touch chords, layout, five-hit victory, loot/return, defeat/retry, pause`);
    await page.close();
  }
}finally{await browser.close();}
