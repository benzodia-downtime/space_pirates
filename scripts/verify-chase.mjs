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
      SpacePiratesAmbient.destroy();const {VoyageScene}=await import(new URL('./src/voyage.js?v=boarding-tug-1',location.href));
      window.chaseQA=new VoyageScene(document.querySelector('#starfield'));chaseQA.stopLoop();
    });
    const read=()=>page.evaluate(()=>chaseQA.getState());
    const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)chaseQA.update(.02);chaseQA.renderStill();},n);
    const snap=stage=>page.screenshot({path:`qa-output/chase-${stage}-${name}.png`});
    const passageHits=()=>page.evaluate(async()=>{
      const THREE=await import(new URL('./vendor/three.module.js',location.href)),v=chaseQA.visuals;
      v.scene.updateMatrixWorld(true);
      const start=v.player.localToWorld(new THREE.Vector3(0,-4,-25));
      const direction=new THREE.Vector3(0,0,1).applyQuaternion(v.player.quaternion);
      const solids=[];v.player.traverse(object=>{if(object.isMesh && object.visible)solids.push(object);});
      return new THREE.Raycaster(start,direction,0,20).intersectObjects(solids,false).length;
    });
    const checkAim=async()=>{const p=(await read()).rendering.aimScreen;assert.ok(Math.abs(p.x-50)<.001);assert.ok(Math.abs(p.y-40)<.001);};
    let state=await read();assert.equal(state.rendering.view,'third-person');assert.equal(state.navigation.speed,0);
    assert.equal(state.rendering.boardingHardware.design,'salvaged-boarding-tug');
    assert.equal(state.rendering.ramVisible,true);assert.equal(state.rendering.boardingHardware.ramDeployed,false);
    assert.deepEqual(state.rendering.boardingHardware.lowerHatchLocal,[0,-4,-14]);
    assert.equal(state.rendering.boardingHardware.airlockOpen,false);
    assert.ok(await passageHits(),'The stowed airlock has a physical closed door');
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
    assert.equal(state.rendering.boardingHardware.airlockOpen,true);assert.equal(state.rendering.boardingHardware.ramDeployed,true);
    assert.deepEqual(state.rendering.boardingHardware.ramPosition,[0,-4,-18]);
    assert.equal(await passageHits(),0,'After pressure equalization the model leaves a clear lower boarding passage');
    assert.notEqual(state.rendering.boardingHardware.winchAngle,0,'The cable drum reels during the assault');
    assert.ok(Math.hypot(...state.rendering.cameraPosition.map((v,i)=>v-state.rendering.playerPosition[i]))>45);
    await snap('docked');
    await page.evaluate(()=>chaseQA.pause());const frozen=await read();await step(100);assert.deepEqual((await read()).rendering.cameraPosition,frozen.rendering.cameraPosition);
    assert.equal((await read()).rendering.boardingHardware.winchAngle,frozen.rendering.boardingHardware.winchAngle);
    // Asset inspection only: a front-quarter view makes the physical boarding
    // mouth and stowed cutter visible without changing the game's chase camera.
    await page.evaluate(async mobile=>{
      const THREE=await import(new URL('./vendor/three.module.js',location.href)),s=chaseQA,v=s.visuals;
      s.startNewSearch({announce:false});s.renderStill();v.enemy.visible=false;
      const offset=new THREE.Vector3(25,18,-40).multiplyScalar(mobile?1.3:1);
      v.camera.position.copy(v.player.localToWorld(offset));v.camera.up.set(0,1,0).applyQuaternion(v.player.quaternion);
      v.camera.clearViewOffset();v.camera.lookAt(v.player.localToWorld(new THREE.Vector3(0,-1,-3)));
      document.querySelector('.voyage-ui').style.visibility='hidden';document.querySelector('#cockpit-shell').style.visibility='hidden';
      v.renderer.render(v.scene,v.camera);
    },mobile);await snap('design-front');
    assert.deepEqual(errors,[]);console.log(`Chase ${name} PASS: external hull, five aspect ratios, fixed physical aim, thrust/release, strafe bank, drag, cannon, external docking and pause`);
    await page.close();
  }
} finally {await browser.close();}
