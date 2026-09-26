import * as THREE from '../vendor/three.module.js';
import {COVER,cameraPose,muzzle} from './boarding-combat.js?v=tps-1';
import {CrewRig} from './crew-rig.js?v=tps-1';

export class BoardingRenderer {
  constructor(canvas) {
    this.canvas=canvas;this.resources=new Set();this.available=false;
    try{this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}catch{return;}
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x101b28);this.scene.fog=new THREE.Fog(0x172330,18,48);
    this.camera=new THREE.PerspectiveCamera(60,1,.06,100);
    this.boxGeometry=this.keep(new THREE.BoxGeometry(1,1,1));
    this.scene.add(new THREE.HemisphereLight(0xc8e4ef,0x27333e,2));
    const key=new THREE.DirectionalLight(0xd7f2ff,2.7);key.position.set(-5,10,9);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-12,right:12,top:18,bottom:-18,near:1,far:40});key.shadow.bias=-.0005;this.scene.add(key);
    const rim=new THREE.DirectionalLight(0xff8b56,1.7);rim.position.set(5,5,-14);this.scene.add(rim);
    this.makeRoom();this.batch([...this.scene.children].filter(o=>o.isMesh&&o.geometry===this.boxGeometry));
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
    this.box(this.scene,wall,18,5.6,.4,0,2.8,-15.2);this.box(this.scene,wall,18,5.6,.4,0,2.8,15.2);
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
    this.box(this.scene,dark,3.8,3.5,.15,0,1.75,14.94);
    for(const x of [-1.9,1.9])this.box(this.scene,light,.07,3.4,.1,x,1.7,14.82);
    this.sign('CARGO / 07',0,3.95,-14.92,2.8,.48);
    this.sign('BOARDING SECTOR',-8.85,2.2,1,2.5,.4,Math.PI/2);
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
    const pose=cameraPose(sim.player,sim.view,sim.aiming);this.camera.position.set(pose.position.x,pose.position.y,pose.position.z);
    const recoil=reduced?0:Math.max(0,1-sim.player.shotAge/.12)*.008;
    this.camera.lookAt(pose.position.x+pose.direction.x,pose.position.y+pose.direction.y+recoil,pose.position.z+pose.direction.z);
    if(this.camera.fov!==pose.fov){this.camera.fov=pose.fov;this.camera.updateProjectionMatrix();}
    this.player.update(sim.player,sim.time,sim.view.pitch,reduced);this.enemy.update(sim.enemy,sim.time,0,reduced);
    this.lines.forEach((line,i)=>{const shot=sim.tracers[i];line.visible=Boolean(shot);if(shot)this.line(line,shot.from,shot.to,shot.color,1-shot.age/.1);});
    this.sparks.forEach((mesh,i)=>{const impact=sim.impacts[i];mesh.visible=Boolean(impact)&&!reduced;if(impact){mesh.position.set(impact.point.x,impact.point.y,impact.point.z);mesh.scale.setScalar(1+impact.age*4);mesh.material.color.setHex(impact.color);}});
    this.laser.visible=sim.phase==='active'&&['aim','lock'].includes(sim.enemyPhase);
    if(this.laser.visible){const from=muzzle(sim.enemy,{yaw:sim.enemy.yaw}),to=sim.enemyPhase==='lock'?sim.enemyAim:{x:sim.player.x,y:sim.player.crouch?.65:1.25,z:sim.player.z};this.line(this.laser,from,to,sim.enemyPhase==='lock'?0xff5942:0xffc56b,.48);}
    this.renderer.render(this.scene,this.camera);
  }
  getState(){return {type:this.available?'webgl2':'unavailable',camera:this.camera?.position.toArray(),fov:this.camera?.fov,player:this.player?.getState(),enemy:this.enemy?.getState(),drawCalls:this.renderer?.info.render.calls,triangles:this.renderer?.info.render.triangles,pixelRatio:this.renderer?.getPixelRatio()};}
  destroy(){this.canvas.removeEventListener('webglcontextlost',this.onLost);this.canvas.removeEventListener('webglcontextrestored',this.onRestored);for(const r of this.resources)r.dispose();this.renderer?.dispose();}
}
