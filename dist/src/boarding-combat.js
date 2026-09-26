// Renderer-independent TPS rules. World units are metres (1 m = 100 Unreal units).
export const CREW = Object.freeze({range:20,damage:10,walk:3.4,run:5.4,crouchSpeed:1.7,radius:.34,magazine:8,reload:1.6,cadence:.24});
export const ROOM = Object.freeze({minX:-9,maxX:9,minZ:-15,maxZ:15,height:5.6});
export const COVER = Object.freeze([
  {x:-2.1,z:5.5,w:3.2,d:1.3,h:1.15},
  {x:2.5,z:-1,w:3.4,d:1.4,h:1.15},
  {x:-5.8,z:-3,w:2.6,d:3,h:2.8},
  {x:6.1,z:7,w:2.4,d:2.8,h:2.3},
  {x:-3,z:-10,w:2.6,d:1.3,h:1.15},
]);
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const length=v=>Math.hypot(v.x,v.y,v.z);
const unit=v=>{const n=length(v)||1;return{x:v.x/n,y:v.y/n,z:v.z/n};};
export const direction=(yaw,pitch=0)=>({x:Math.sin(yaw)*Math.cos(pitch),y:-Math.sin(pitch),z:-Math.cos(yaw)*Math.cos(pitch)});
export const bounds=o=>({min:{x:o.x-o.w/2,y:0,z:o.z-o.d/2},max:{x:o.x+o.w/2,y:o.h,z:o.z+o.d/2}});
export const SOLIDS=[...COVER.map(bounds),
  bounds({x:-9.3,z:0,w:.6,d:31,h:5.6}),bounds({x:9.3,z:0,w:.6,d:31,h:5.6}),
  bounds({x:0,z:-15.3,w:18,d:.6,h:5.6}),bounds({x:0,z:15.3,w:18,d:.6,h:5.6}),
];
export function rayBox(from,dir,box,max=Infinity) {
  let near=0,far=max;
  for(const axis of ['x','y','z']) {
    if(Math.abs(dir[axis])<1e-9) {if(from[axis]<box.min[axis]||from[axis]>box.max[axis])return null;}
    else {const a=(box.min[axis]-from[axis])/dir[axis],b=(box.max[axis]-from[axis])/dir[axis];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far)return null;}
  }
  return near<=max?near:null;
}
const bodyBounds=actor=>({min:{x:actor.x-.38,y:.05,z:actor.z-.32},max:{x:actor.x+.38,y:actor.crouch?1.04:1.86,z:actor.z+.32}});
export function trace(from,dir,max,target=null) {
  let hit={distance:max,kind:'air'};
  for(const box of SOLIDS) {const t=rayBox(from,dir,box,max);if(t!==null&&t<hit.distance)hit={distance:t,kind:'cover'};}
  if(target?.health>0) {const t=rayBox(from,dir,bodyBounds(target),max);if(t!==null&&t<hit.distance)hit={distance:t,kind:'crew'};}
  return {...hit,point:add(from,dir,hit.distance)};
}
export function cameraPose(actor,view,aiming=false) {
  const forward=direction(view.yaw,view.pitch),right={x:Math.cos(view.yaw),y:0,z:Math.sin(view.yaw)};
  const eye={x:actor.x,y:actor.crouch?.92:1.62,z:actor.z};
  const portrait=view.aspect<.8;
  const desired=add(add(eye,forward,aiming?-2.25:-3.6),right,portrait?(aiming?.3:.4):(aiming?.48:.68));desired.y+=.12;
  const offset=sub(desired,eye),distance=length(offset),dir=unit(offset);
  let allowed=distance;
  // A padded boom test keeps the shoulder camera outside walls and cargo.
  for(const box of SOLIDS) {
    const padded={min:add(box.min,{x:-.15,y:-.15,z:-.15}),max:add(box.max,{x:.15,y:.15,z:.15})};
    const t=rayBox(eye,dir,padded,distance);if(t!==null)allowed=Math.min(allowed,Math.max(.08,t-.12));
  }
  return {position:add(eye,dir,allowed),direction:forward,fov:aiming?48:60};
}
export function muzzle(actor,view) {
  const f=direction(view.yaw),r={x:Math.cos(view.yaw),y:0,z:Math.sin(view.yaw)};
  return add(add({x:actor.x,y:actor.crouch?.76:1.38,z:actor.z},f,.68),r,.25);
}
const actor=(x,z,health)=>({x,z,yaw:0,health,maxHealth:health,crouch:false,speed:0,travel:0,shotAge:99,hitAge:99,deathAge:0,state:'idle'});
export class BoardingCombat {
  constructor(){this.reset();}
  reset() {
    this.player=actor(0,11,100);this.enemy=actor(.5,-7,50);this.enemy.yaw=Math.PI;
    this.view={yaw:0,pitch:.025};this.time=0;this.phase='active';this.resultAge=0;
    this.rounds=CREW.magazine;this.reloadTime=0;this.cooldown=0;this.aiming=false;
    this.enemyPhase='wait';this.enemyClock=1.6;this.enemyAim=null;this.flankSide=0;
    this.tracers=[];this.impacts=[];this.shots=0;this.hits=0;this.enemyShots=0;this.hitMarker=0;
  }
  move(a,x,z,dt,speed,other) {
    const n=Math.max(1,Math.hypot(x,z)),before={x:a.x,z:a.z};
    const legal=(px,pz)=>!COVER.some(o=>Math.abs(px-o.x)<o.w/2+CREW.radius&&Math.abs(pz-o.z)<o.d/2+CREW.radius)&&(!other||other.health<=0||Math.hypot(px-other.x,pz-other.z)>.72);
    const dx=x/n*speed*dt,dz=z/n*speed*dt;
    const nx=clamp(a.x+dx,ROOM.minX+CREW.radius,ROOM.maxX-CREW.radius);
    if(legal(nx,a.z))a.x=nx;
    const nz=clamp(a.z+dz,ROOM.minZ+CREW.radius,ROOM.maxZ-CREW.radius);
    if(legal(a.x,nz))a.z=nz;
    a.speed=Math.hypot(a.x-before.x,a.z-before.z)/(dt||1);a.travel+=a.speed*dt;
  }
  reload(){if(this.phase!=='active'||this.reloadTime||this.rounds===CREW.magazine)return false;this.reloadTime=CREW.reload;return true;}
  shoot(source,target,from,dir,color) {
    const hit=trace(from,dir,CREW.range,target);source.shotAge=0;
    this.tracers.push({from:{...from},to:hit.point,age:0,color});
    if(hit.kind!=='air')this.impacts.push({point:hit.point,age:0,color:hit.kind==='crew'?0xffa36a:0x83ddf5});
    if(hit.kind==='crew'){target.health=Math.max(0,target.health-CREW.damage);target.hitAge=0;if(source===this.player){this.hits++;this.hitMarker=.16;}}
    return hit;
  }
  fire() {
    if(this.phase!=='active'||this.reloadTime||this.cooldown)return false;
    if(!this.rounds){this.reload();return false;}
    // Crosshair ray chooses a world point. The physical muzzle then traces toward
    // it, so shoulder peeking cannot shoot through the crate in front of the gun.
    const camera=cameraPose(this.player,this.view,this.aiming),aim=trace(camera.position,camera.direction,60,this.enemy);
    const from=muzzle(this.player,this.view),dir=unit(sub(aim.point,from));
    this.shoot(this.player,this.enemy,from,dir,0x82f2ff);this.rounds--;this.shots++;this.cooldown=CREW.cadence;
    if(!this.rounds)this.reload();return true;
  }
  updateEnemy(dt) {
    const e=this.enemy,p=this.player;let dx=p.x-e.x,dz=p.z-e.z,distance=Math.hypot(dx,dz);
    e.yaw=Math.atan2(dx,-dz);
    const from=muzzle(e,{yaw:e.yaw}),target={x:p.x,y:p.crouch?.65:1.25,z:p.z};
    const visible=trace(from,unit(sub(target,from)),length(sub(target,from)),p).kind==='crew';
    e.speed=0;
    if(this.enemyPhase==='lock') {
      this.enemyClock-=dt;
      if(this.enemyClock<=0){this.shoot(e,p,from,unit(sub(this.enemyAim,from)),0xff7459);this.enemyShots++;this.enemyPhase='wait';this.enemyClock=1.25;}
      return;
    }
    // Move between firing opportunities and flank occluding cargo; freeze during
    // the visible aiming wind-up so players can react to a committed shot.
    if(this.enemyPhase!=='aim') {
      let vx=0,vz=0;
      if(distance>14||!visible){vx=dx/(distance||1);vz=dz/(distance||1);if(!visible){this.flankSide ||= Math.sign(e.x-p.x)||1;vx=this.flankSide;vz*=.25;}}
      else {const side=Math.sin(this.time*.6)>0?1:-1;vx=-dz/(distance||1)*side*.48;vz=dx/(distance||1)*side*.48;}
      this.move(e,vx,vz,dt,1.3,p);
      if(visible)this.flankSide=0;else if(e.speed<.02)this.flankSide*=-1;
    }
    this.enemyClock-=dt;
    if(this.enemyPhase==='wait'&&this.enemyClock<=0&&visible&&distance<=CREW.range){this.enemyPhase='aim';this.enemyClock=.85;}
    else if(this.enemyPhase==='aim') {
      if(!visible||distance>CREW.range){this.enemyPhase='wait';this.enemyClock=.4;}
      else if(this.enemyClock<=0){this.enemyAim={...target};this.enemyPhase='lock';this.enemyClock=.45;}
    }
  }
  update(delta,input={}) {
    const dt=clamp(delta,0,.05);if(!dt)return;
    this.time+=dt;this.hitMarker=Math.max(0,this.hitMarker-dt);
    this.tracers=this.tracers.filter(t=>(t.age+=dt)<.1);this.impacts=this.impacts.filter(t=>(t.age+=dt)<.24);
    for(const a of [this.player,this.enemy]){a.shotAge+=dt;a.hitAge+=dt;if(a.health<=0)a.deathAge+=dt;}
    if(this.phase!=='active'){this.resultAge+=dt;this.player.speed=this.enemy.speed=0;this.animateStates();return;}
    this.aiming=Boolean(input.aim);this.player.crouch=Boolean(input.crouch);this.player.yaw=this.view.yaw;
    this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.cooldown<1e-8)this.cooldown=0;
    if(this.reloadTime){this.reloadTime=Math.max(0,this.reloadTime-dt);if(!this.reloadTime)this.rounds=CREW.magazine;}
    const f=direction(this.view.yaw),r={x:Math.cos(this.view.yaw),z:Math.sin(this.view.yaw)},x=input.x||0,z=input.z||0;
    const speed=this.player.crouch?CREW.crouchSpeed:this.aiming?2.1:input.run?CREW.run:CREW.walk;
    this.move(this.player,r.x*x+f.x*z,r.z*x+f.z*z,dt,speed,this.enemy);
    if(input.fire)this.fire();
    if(this.enemy.health>0)this.updateEnemy(dt);
    if(this.player.health<=0||this.enemy.health<=0){this.phase=this.player.health<=0?'defeat':'victory';this.enemyPhase='idle';this.resultAge=0;}
    this.animateStates();
  }
  animateStates(){for(const a of [this.player,this.enemy])a.state=a.health<=0?'down':a.hitAge<.22?'hit':a.shotAge<.18?'fire':a===this.player&&this.reloadTime?'reload':a.speed>.1?(a.crouch?'crouch-walk':a.speed>4?'run':'walk'):a.crouch?'crouch':a===this.enemy&&['aim','lock'].includes(this.enemyPhase)?'aim':a===this.player&&this.aiming?'aim':'idle';}
  getState(){return {phase:this.phase,time:this.time,player:{...this.player},enemy:{...this.enemy},view:{...this.view},aiming:this.aiming,rounds:this.rounds,reloadTime:this.reloadTime,enemyPhase:this.enemyPhase,enemyAim:this.enemyAim&&{...this.enemyAim},shots:this.shots,hits:this.hits,enemyShots:this.enemyShots,resultAge:this.resultAge,tracers:this.tracers.map(t=>({...t,from:{...t.from},to:{...t.to}}))};}
}
