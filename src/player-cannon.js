// Metres, simulation seconds. Geometry is shared by hit tests and the visible rear deck.
export const SIEGE = Object.freeze({
  armorHealth: 120, damage: 20, interval: .45, magazine: 3, reload: 3.5,
  speed: 320, range: 220, muzzle: Object.freeze({x:3.8,y:-1.2,z:14}),
  armorBounds: Object.freeze([[-5.6,-5.2,-55],[5.6,5.2,-53]]),
  frameBounds: Object.freeze([
    [[-7.2,-6.4,-58],[-5.6,6.4,-49]], [[5.6,-6.4,-58],[7.2,6.4,-49]],
    [[-5.6,5.2,-58],[5.6,6.4,-49]], [[-5.6,-6.4,-58],[5.6,-5.2,-49]],
  ]),
});
const hullBounds = [
  [[-16.5,-10.5,-50.5],[16.5,10.5,32.2]],
  [[-7.5,8.75,-30],[7.5,13.9,-4]],
  [[-22.5,-7,-39],[-15.5,3,9]], [[15.5,-7,-39],[22.5,3,9]],
  [[-3.5,14,5],[3.5,22,14]],
  [[-3.8,10,-50],[3.8,18,-39]], // Raised aft turret, above (not in) the boarding path.
  [[-3.7,-3.7,-51.8],[3.7,3.7,-50.5]], // The inner ramp remains for the ram to tear.
];
const axes=['x','y','z'];
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const length=v=>Math.hypot(v.x,v.y,v.z);
const unit=v=>{const d=length(v)||1;return {x:v.x/d,y:v.y/d,z:v.z/d};};
const add=(p,v,s)=>({x:p.x+v.x*s,y:p.y+v.y*s,z:p.z+v.z*s});
const local=(nav,p)=>{const d=sub(p,nav.enemyPosition),c=Math.cos(nav.enemyYaw),s=Math.sin(nav.enemyYaw);return {x:c*d.x-s*d.z,y:d.y,z:s*d.x+c*d.z};};
function intersection(a,b,[lo,hi]) {
  let enter=0,exit=1,face=null;
  for(const [i,axis] of axes.entries()) {
    const d=b[axis]-a[axis];
    if(Math.abs(d)<1e-9) {if(a[axis]<lo[i] || a[axis]>hi[i])return null;continue;}
    const t1=(lo[i]-a[axis])/d,t2=(hi[i]-a[axis])/d;
    const near=Math.min(t1,t2),far=Math.max(t1,t2);
    if(near>enter) {enter=near;face=axis+(d>0?'-':'+');}
    exit=Math.min(exit,far);
    if(enter>exit)return null;
  }
  return {t:enter,face};
}
export function traceCannon(nav,from,to) {
  if(!nav.placed)return null;
  const a=local(nav,from),b=local(nav,to),d=sub(b,a),distance=length(d);
  const candidates=[...hullBounds.map(bounds=>({kind:'hull',bounds})),...SIEGE.frameBounds.map(bounds=>({kind:'hull',bounds}))];
  if(nav.armorHealth>0)candidates.push({kind:'armor',bounds:SIEGE.armorBounds});
  let nearest=null;
  for(const candidate of candidates) {
    const hit=intersection(a,b,candidate.bounds);
    if(!hit || (nearest && hit.t>=nearest.t))continue;
    // Only the outward rear face is vulnerable; side/top/front shots ricochet.
    const kind=candidate.kind==='armor' && hit.face==='z-' && d.z/(distance||1)>.45?'armor':'hull';
    const point=add(a,d,hit.t);
    nearest={kind,point,position:nav.world(point),t:hit.t};
  }
  return nearest;
}

export class PlayerCannon {
  constructor() {this.reset();}
  reset() {
    this.rounds=SIEGE.magazine;this.reloadTime=0;this.cooldown=0;
    this.bolts=[];this.impacts=[];this.shotAge=-1;this.shots=0;this.armorHits=0;
  }
  fire(nav,view) {
    if(nav.anchor || !nav.placed || this.cooldown>0 || this.reloadTime>0 || !this.rounds)return false;
    const sy=Math.sin(view.yaw),cy=Math.cos(view.yaw),sp=Math.sin(view.pitch),cp=Math.cos(view.pitch);
    const forward={x:sy*cp,y:-sp,z:-cy*cp};
    const m=SIEGE.muzzle;
    const muzzle={x:nav.position.x+cy*m.x+sy*sp*m.y+forward.x*m.z,y:nav.position.y+cp*m.y+forward.y*m.z,z:nav.position.z+sy*m.x-cy*sp*m.y+forward.z*m.z};
    // Converge the visible barrel onto the crosshair ray, then let the round fly unguided.
    const far=add(nav.position,forward,SIEGE.range),aim=traceCannon(nav,nav.position,far)?.position || far;
    this.bolts.push({position:muzzle,direction:unit(sub(aim,muzzle)),travel:0});
    this.rounds--;this.shots++;this.shotAge=0;this.cooldown=SIEGE.interval;
    if(!this.rounds)this.reloadTime=SIEGE.reload;
    return true;
  }
  update(delta,nav,{view,trigger=false,enabled=true}={}) {
    const dt=Math.max(0,Math.min(.05,delta)),events=[];
    if(!dt)return events;
    if(this.shotAge>=0)this.shotAge+=dt;
    this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.reloadTime>0) {
      this.reloadTime=Math.max(0,this.reloadTime-dt);
      if(this.reloadTime<1e-8){this.reloadTime=0;this.rounds=SIEGE.magazine;}
    }
    this.impacts=this.impacts.filter(hit=>(hit.age+=dt)<.7);
    if(nav.armorHitAge>=0)nav.armorHitAge+=dt;
    if(nav.armorBreakAge>=0)nav.armorBreakAge+=dt;
    if(!enabled || nav.anchor) {this.bolts=[];return events;}
    for(const bolt of this.bolts) {
      const step=Math.min(SIEGE.speed*dt,SIEGE.range-SIEGE.muzzle.z-bolt.travel);
      const end=add(bolt.position,bolt.direction,step),hit=traceCannon(nav,bolt.position,end);
      bolt.travel+=step;
      if(hit) {
        bolt.travel=SIEGE.range;
        if(hit.kind==='armor' && nav.damageArmor(SIEGE.damage,hit.point)) {
          this.armorHits++;events.push(nav.armorHealth===0?'armor-break':'armor-hit');
        } else events.push('armor-ricochet');
        this.impacts.push({...hit,age:0});
      }
      bolt.position=end;
    }
    this.bolts=this.bolts.filter(b=>b.travel<SIEGE.range-SIEGE.muzzle.z-1e-6);
    if(trigger && view && this.fire(nav,view))events.push('player-fire');
    return events;
  }
  getState() {return {rounds:this.rounds,reloadTime:this.reloadTime,cooldown:this.cooldown,shots:this.shots,armorHits:this.armorHits,bolts:this.bolts.map(b=>({...b,position:{...b.position},direction:{...b.direction}})),impacts:this.impacts.map(h=>({...h,point:{...h.point}}))};}
}
