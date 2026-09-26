import * as THREE from '../vendor/three.module.js';
import {COVER,cameraPose,muzzle} from './boarding-combat.js?v=helm-return-1';
import {WALLS,INTERIOR} from './boarding-layout.js?v=helm-return-1';
import {CrewRig} from './crew-rig.js?v=helm-return-1';

export class BoardingRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.resources=new Set();this.available=false;
    try{this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}catch{return;}
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x050d18);this.scene.fog=new THREE.Fog(0x172330,32,90);
    this.camera=new THREE.PerspectiveCamera(60,1,.06,100);
    this.boxGeometry=this.keep(new THREE.BoxGeometry(1,1,1));
    this.scene.add(new THREE.HemisphereLight(0xc8e4ef,0x27333e,2));
    const key=new THREE.DirectionalLight(0xd7f2ff,2.7);key.position.set(-5,10,9);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-16,right:16,top:48,bottom:-40,near:1,far:85});key.shadow.bias=-.0005;this.scene.add(key);
    const rim=new THREE.DirectionalLight(0xff8b56,1.7);rim.position.set(5,5,-14);this.scene.add(rim);
    this.makeRoom();this.makeOwnShip();this.batch([...this.scene.children].filter(o=>o.isMesh&&o.geometry===this.boxGeometry));
    this.lootMarker=new THREE.Mesh(this.keep(new THREE.OctahedronGeometry(.14)),this.material(0xffd67d,.4,true));this.scene.add(this.lootMarker);
    this.player=new CrewRig(this);this.enemy=new CrewRig(this,true);
    this.lines=Array.from({length:12},()=>{
      const geometry=this.keep(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      const line=new THREE.Line(geometry,this.keep(new THREE.LineBasicMaterial({color:0xffffff,transparent:true})));line.frustumCulled=false;this.scene.add(line);return line;
    });
    this.sparks=Array.from({length:12},()=>{const mesh=new THREE.Mesh(this.keep(new THREE.IcosahedronGeometry(.09,0)),this.material(0xffc478,.2,true));this.scene.add(mesh);return mesh;});
    this.laser=new THREE.Line(this.keep(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()])),this.keep(new THREE.LineBasicMaterial({color:0xff5e40,transparent:true,opacity:.65})));this.laser.frustumCulled=false;this.scene.add(this.laser);
    this.available=true;
    this.onLost=e=>{e.preventDefault();this.available=false;this.onAvailability?.(false);};
    this.onRestored=()=>{this.available=true;this.onAvailability?.(true);};
    canvas.addEventListener('webglcontextlost',this.onLost);canvas.addEventListener('webglcontextrestored',this.onRestored);
  }
  keep(r){this.resources.add(r);return r;}
  material(color,roughness=.75,glow=false){return this.keep(glow?new THREE.MeshBasicMaterial({color}):new THREE.MeshStandardMaterial({color,roughness,metalness:.22,flatShading:true}));}
  box(parent,material,w,h,d,x,y,z) {
    const mesh=new THREE.Mesh(this.boxGeometry,material);mesh.scale.set(w,h,d);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  batch(sources) {
    // Repeated boxes share instanced draw calls, including animated rig pieces.
    // Hidden source nodes retain their joint hierarchy as transform proxies.
    const groups=new Map();
    for(const source of sources){const key=source.material.uuid+source.castShadow;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(source);source.visible=false;}
    const batches=[];
    for(const list of groups.values()) {
      const mesh=this.keep(new THREE.InstancedMesh(this.boxGeometry,list[0].material,list.length));mesh.castShadow=list[0].castShadow;mesh.receiveShadow=true;mesh.frustumCulled=false;this.scene.add(mesh);batches.push({mesh,sources:list});
    }
    this.scene.updateMatrixWorld(true);this.syncBatch(batches);return batches;
  }
  syncBatch(batches){for(const {mesh,sources} of batches){sources.forEach((source,i)=>mesh.setMatrixAt(i,source.matrixWorld));mesh.instanceMatrix.needsUpdate=true;}}
  makeRoom() {
    const floor=this.material(0x344753),wall=this.material(0x263440),beam=this.material(0x506675),dark=this.material(0x111c28),brass=this.material(0xa78340),light=this.material(0xa8edf6,.4,true),red=this.material(0xf38158,.4,true);
    this.box(this.scene,floor,18,.25,30,0,-.15,0);
    this.box(this.scene,this.material(0x16232e,.8,true),18.4,.2,30.4,0,5.72,0).castShadow=false;
    for(let z=-14;z<=14;z+=2){this.box(this.scene,dark,17.9,.01,.035,0,.005,z);for(const x of [-6,-2,2,6])this.box(this.scene,dark,.025,.012,2,x,.006,z+1);}
    for(const x of [-8.2,8.2])this.box(this.scene,light,.04,.012,28,x,.015,0);
    for(const side of [-1,1]) {
      this.box(this.scene,wall,.4,5.6,30,side*9.2,2.8,0);
      for(let z=-13;z<15;z+=4){this.box(this.scene,beam,.45,5.4,.35,side*8.88,2.7,z);this.box(this.scene,dark,.07,1.8,2.7,side*8.95,2.7,z+1.8);this.box(this.scene,light,.09,.07,1.7,side*8.85,3.9,z+1.8);}
      this.box(this.scene,brass,.16,.16,29,side*8.6,.5,0);
    }
    this.box(this.scene,wall,18,5.6,.4,0,2.8,-15.2);
    for(const side of [-1,1])this.box(this.scene,wall,6.8,5.6,.4,side*5.6,2.8,15.2);
    this.box(this.scene,wall,4.4,1.8,.4,0,4.7,15.2);
    this.box(this.scene,dark,4,3.5,.12,0,1.75,-14.96);this.box(this.scene,beam,3.5,3.1,.16,0,1.55,-14.86);
    this.box(this.scene,red,.06,2.6,.08,0,1.5,-14.74);
    for(let z=-12;z<=12;z+=6){this.box(this.scene,beam,18,.35,.35,0,5.3,z);this.box(this.scene,light,4,.04,.28,0,5.08,z);}
    for(const c of COVER) {
      this.box(this.scene,wall,c.w,c.h,c.d,c.x,c.h/2,c.z);
      this.box(this.scene,beam,c.w+.05,.1,c.d+.05,c.x,c.h,c.z);
      for(const x of [-1,1])this.box(this.scene,brass,.09,c.h-.1,c.d+.035,c.x+x*(c.w/2-.16),c.h/2,c.z);
      this.box(this.scene,light,.32,.035,.02,c.x,c.h-.23,c.z+c.d/2+.015);
      for(let i=-1;i<=1;i++)this.box(this.scene,dark,.16,.16,.025,c.x+i*.26,.3,c.z+c.d/2+.02);
    }
    // Physical floor markings and the breached entry behind the player.
    for(let z=8;z<=13;z+=1)this.box(this.scene,brass,.13,.015,.5,-3.9,.01,z);
    for(const x of [-2.12,2.12])this.box(this.scene,light,.07,3.7,.1,x,1.85,14.82);
    this.sign('NAUTILUS / RETURN',0,3.35,14.82,3.3,.36,Math.PI);
    this.sign('CARGO / 07',0,3.95,-14.92,2.8,.48);
    this.sign('BOARDING SECTOR',-8.85,2.2,1,2.5,.4,Math.PI/2);
  }
  makeOwnShip() {
    const existing=new Set(this.scene.children);
    const blue=this.material(0x1b394a),floor=this.material(0x385461),trim=this.material(0x557984),dark=this.material(0x0a1926),cyan=this.material(0x69e2ed,.4,true),amber=this.material(0xf5ba6a,.4,true);
    // Walkable lower airlock and elevated cockpit share the simulation's plan.
    this.box(this.scene,floor,8,.25,5,0,-.15,25.5);
    this.box(this.scene,floor,10,.25,8,0,3.85,40);
    this.box(this.scene,dark,10,.2,8,0,8.15,40);
    this.box(this.scene,dark,8,.2,5,0,4.15,25.5);
    this.box(this.scene,dark,4.4,.2,8,0,8.15,32);
    for(const w of WALLS.filter(w=>w.z>=22.8)) {
      this.box(this.scene,blue,w.w,w.h,w.d,w.x,(w.y||0)+w.h/2,w.z);
    }
    for(let i=0;i<16;i++) {
      const h=(i+1)*.25,z=28+i*.5+.25;
      this.box(this.scene,floor,4,h,.5,0,h/2,z);
      this.box(this.scene,cyan,3.9,.018,.035,0,h+.015,z-.22);
    }
    for(const side of [-1,1]) {
      // Repeating short rails follow the stairs down to the forward lower deck.
      for(let i=0;i<8;i++)this.box(this.scene,trim,.065,.07,1.1,side*1.85,1+i*.5,28.5+i);
      this.box(this.scene,cyan,.07,.06,4,side*3.8,.25,25.5);
      this.box(this.scene,cyan,.07,.06,7.7,side*4.8,4.25,40);
      this.box(this.scene,cyan,3.7,.045,.06,side*2.9,7.4,36.05);
      // Forward observation windows above the lower breach; enemy silhouette outside.
      this.box(this.scene,this.material(0x06121e,.7,true),2.7,2.3,.06,side*3.45,6.05,36.04);
      for(let i=0;i<7;i++)this.box(this.scene,cyan,.016,.016,.02,side*3.45+Math.sin(i*3.1)*1.15,5.2+(i%4)*.42,36.09);
      this.box(this.scene,trim,2.3,.35,1.3,side*2.5,4.85,38.4);
      const display=this.box(this.scene,cyan,1.4,.035,.65,side*2.5,5.05,38.4);display.rotation.x=-.25;
      this.box(this.scene,dark,.8,.35,.8,side*2.5,4.5,40);
      this.box(this.scene,blue,.85,1,.25,side*2.5,5,40.4);
    }
    this.sign('NAUTILUS / HELM',0,7.3,36.06,3.2,.4);
    this.sign('PILOT / SIT',2.5,5.6,38.45,1.8,.24);
    this.helmMarker=new THREE.Group();this.scene.add(this.helmMarker);
    for(const side of [-1,1])this.box(this.helmMarker,cyan,.045,.025,1.5,INTERIOR.helm.x+side*.65,4.025,INTERIOR.helm.z);
    this.sign('BREACH / LOWER DECK',0,3.35,23.15,3.5,.32);
    this.sign('RETURN TO HELM',0,6.5,35.75,2.9,.36,Math.PI);
    this.sign('DISCONNECT',3,2,25.3,1.55,.26);
    for(const z of [24.3,26.5,37,39,41]) {
      const y=z>36?4:0;
      this.box(this.scene,cyan,.08,.018,.9,-.6,y+.02,z);
      this.box(this.scene,cyan,.08,.018,.9,.6,y+.02,z);
    }
    // Transparent, ribbed bridge: visibly spans the gap instead of a painted door.
    this.passage=new THREE.Group();this.passage.position.z=23;this.scene.add(this.passage);
    this.box(this.passage,floor,4.4,.25,8,0,-.15,-4);
    this.box(this.passage,dark,4.6,.18,8,0,3.9,-4);
    const glass=this.keep(new THREE.MeshStandardMaterial({color:0x4c8ca5,transparent:true,opacity:.28,side:THREE.DoubleSide,roughness:.35}));
    for(const side of [-1,1]) {
      this.box(this.passage,glass,.1,3.8,8,side*2.25,1.9,-4);
      this.box(this.passage,cyan,.045,.08,8,side*2.1,.35,-4);
      for(let z=-8;z<=0;z+=2)this.box(this.passage,trim,.12,3.8,.18,side*2.2,1.9,z);
    }
    for(let z=-8;z<=0;z+=2)this.box(this.passage,trim,4.5,.12,.18,0,3.8,z);
    const background=this.material(0x2a394a);
    for(const side of [-1,1])this.box(this.scene,background,8,8,25,side*13,1,4);
    this.lever=new THREE.Group();this.lever.position.set(INTERIOR.lever.x,1.1,INTERIOR.lever.z);this.scene.add(this.lever);
    this.box(this.lever,dark,.5,.95,.5,0,-.5,0);
    this.leverArm=new THREE.Group();this.lever.add(this.leverArm);
    this.box(this.leverArm,trim,.075,.55,.075,0,.22,0);
    this.box(this.leverArm,amber,.42,.12,.14,0,.51,0);
    // Own-ship hatch must not shrink or disappear with the retracting bridge.
    const hatch=new THREE.Group();this.scene.add(hatch);
    this.sealDoor=this.box(hatch,blue,4.4,3.8,.2,0,5.8,23);
    this.box(this.sealDoor,amber,.75,.025,1.1,0,0,.55);
    // Architectural ceilings should not cast coarse, room-wide bands through
    // the much smaller combat shadow map. Characters/cargo retain shadows.
    for(const child of this.scene.children)if(!existing.has(child))child.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  }
  sign(text,x,y,z,w,h,yaw=0) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#172630';ctx.fillRect(0,0,512,80);ctx.font='bold 40px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#c4d8d9';ctx.fillText(text,256,40);
    const texture=this.keep(new THREE.CanvasTexture(canvas));texture.colorSpace=THREE.SRGBColorSpace;
    const mesh=new THREE.Mesh(this.keep(new THREE.PlaneGeometry(w,h)),this.keep(new THREE.MeshBasicMaterial({map:texture})));mesh.position.set(x,y,z);mesh.rotation.y=yaw;this.scene.add(mesh);
  }
  resize(){const w=this.canvas.clientWidth,h=this.canvas.clientHeight;if(!w||!h)return;if(w!==this.width||h!==this.height){this.width=w;this.height=h;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}}
  line(line,from,to,color,opacity=1){const a=line.geometry.attributes.position;a.setXYZ(0,from.x,from.y,from.z);a.setXYZ(1,to.x,to.y,to.z);a.needsUpdate=true;line.material.color.setHex(color);line.material.opacity=opacity;}
  draw(sim,reduced=false) {
    if(!this.available)return;this.resize();
    const pose=cameraPose(sim.player,sim.view,sim.aiming,sim.solids);this.camera.position.set(pose.position.x,pose.position.y,pose.position.z);
    const recoil=reduced?0:Math.max(0,1-sim.player.shotAge/.12)*.008;
    this.camera.lookAt(pose.position.x+pose.direction.x,pose.position.y+pose.direction.y+recoil,pose.position.z+pose.direction.z);
    if(this.camera.fov!==pose.fov){this.camera.fov=pose.fov;this.camera.updateProjectionMatrix();}
    this.player.update(sim.player,sim.time,sim.view.pitch,reduced);this.enemy.update(sim.enemy,sim.time,0,reduced);
    this.lootMarker.visible=sim.enemy.health<=0&&!sim.enemy.looted;
    this.lootMarker.position.set(sim.enemy.x,.7+(reduced?0:Math.sin(sim.time*3)*.07),sim.enemy.z);
    this.lootMarker.rotation.y=sim.time;
    this.leverArm.rotation.x=-sim.extraction*1.1;
    // Watch the bridge retract, then close the fixed ship-side hatch.
    this.passage.scale.z=Math.max(.01,1-sim.extraction/.65);
    this.passage.visible=sim.extraction<.65;
    this.sealDoor.position.y=5.8-Math.max(0,Math.min(1,(sim.extraction-.65)/.35))*3.9;
    this.helmMarker.visible=sim.phase==='home';
    this.lines.forEach((line,i)=>{const shot=sim.tracers[i];line.visible=Boolean(shot);if(shot)this.line(line,shot.from,shot.to,shot.color,1-shot.age/.1);});
    this.sparks.forEach((mesh,i)=>{const impact=sim.impacts[i];mesh.visible=Boolean(impact)&&!reduced;if(impact){mesh.position.set(impact.point.x,impact.point.y,impact.point.z);mesh.scale.setScalar(1+impact.age*4);mesh.material.color.setHex(impact.color);}});
    this.laser.visible=sim.phase==='active'&&['aim','lock'].includes(sim.enemyPhase);
    if(this.laser.visible){const from=muzzle(sim.enemy,{yaw:sim.enemy.yaw}),to=sim.enemyPhase==='lock'?sim.enemyAim:{x:sim.player.x,y:sim.player.y+(sim.player.crouch?.65:1.25),z:sim.player.z};this.line(this.laser,from,to,sim.enemyPhase==='lock'?0xff5942:0xffc56b,.48);}
    this.renderer.render(this.scene,this.camera);
  }
  getState(){return {type:this.available?'webgl2':'unavailable',camera:this.camera?.position.toArray(),fov:this.camera?.fov,player:this.player?.getState(),enemy:this.enemy?.getState(),connectedInterior:true,cockpitHeight:4,bridgeHeight:0,leverAngle:this.leverArm?.rotation.x,bridgeVisible:this.passage?.visible,hatchClosed:this.sealDoor?.position.y<2,helmMarkerVisible:this.helmMarker?.visible,drawCalls:this.renderer?.info.render.calls,triangles:this.renderer?.info.render.triangles,pixelRatio:this.renderer?.getPixelRatio()};}
  destroy(){this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);for(const r of this.resources)r.dispose();this.renderer?.dispose();}
}
