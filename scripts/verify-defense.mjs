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
    async function fresh() {
      await page.goto(url);
      await page.waitForFunction(()=>window.SpacePiratesAmbient?.getState().rendering.type==='webgl2');
      await page.evaluate(async()=>{
        SpacePiratesAmbient.destroy();
        const {VoyageScene}=await import(new URL('./src/voyage.js?v=defender-1',location.href));
        window.defenseQA=new VoyageScene(document.querySelector('#starfield'));
        const s=defenseQA;s.stopLoop();s.forceContact();
        const view=s.getActualBearing();s.pointer={x:view.x*.65/.442,y:view.y*.65/.312};s.pointerTarget={...s.pointer};s.renderStill();
      });
    }
    const step=frames=>page.evaluate(n=>{for(let i=0;i<n;i++)defenseQA.update(.02);defenseQA.renderStill();},frames);
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
    console.log(`Defense ${mobile?'mobile':'desktop'} PASS: telegraph, touch/key dodge, actual miss/hit, defeat/retry, pause, compact HUD`);
    await page.close();
  }
} finally {await browser.close();}
