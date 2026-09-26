const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const len = v => Math.hypot(v.x,v.y,v.z);
const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;

export const DEFENSE = Object.freeze({
  turnRate: .04, turnSeconds: 4, holdSeconds: 6,
  orbitRate: .035, orbitSpeed: 12,
  range: 1200, coneYaw: .7, conePitch: .5,
  aimSeconds: 1.8, lockSeconds: 1.2, reloadSeconds: 3.5,
  boltSpeed: 220, boltLife: 6, hitRadius: 6, hull: 100, damage: 25,
  fanStep: .1, fanCount: 9,
});

// Gun pivots are shared with the renderer; a rotating barrel's muzzle follows its bore.
export const GUN_MOUNTS = Object.freeze({
  bow: Object.freeze({x:0,y:2,z:33}),
  dorsal: Object.freeze({x:0,y:20,z:8}),
  stern: Object.freeze({x:0,y:16,z:-43}),
});
// Conservative local-space hull/bridge/engine bounds prevent firing through our own ship.
const HULL_BOUNDS = [
  [[-16.5,-10.5,-50.5],[16.5,10.5,32.2]],
  [[-7.5,8.75,-30],[7.5,13.9,-4]],
  [[-22.5,-7,-39],[-15.5,3,9]], [[15.5,-7,-39],[22.5,3,9]],
];
function blockedByHull(from,to) {
  return HULL_BOUNDS.some(([lo,hi])=>{
    let enter=0,exit=1;
    for(const [i,axis] of ['x','y','z'].entries()) {
      const step=to[axis]-from[axis];
      if(Math.abs(step)<1e-9) {if(from[axis]<lo[i] || from[axis]>hi[i])return false;}
      else {
        const a=(lo[i]-from[axis])/step,b=(hi[i]-from[axis])/step;
        enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
        if(enter>exit)return false;
      }
    }
    return exit>0 && enter<1;
  });
}

// Deterministic, simulation-time AI. The gun cannot track once its amber aim turns red.
export class EnemyDefense {
  constructor() { this.reset(); }
  reset() {
    this.phase = 'idle'; this.turnTime = 0; this.turnGoal = null; this.turning = 0;
    this.gunPhase = 'idle'; this.gunTime = 0; this.cooldown = 2;
    this.aimPoint = null; this.bolts = []; this.hull = DEFENSE.hull;
    this.hitAge = -1; this.muzzleAge = -1; this.shots = 0; this.hits = 0;
    this.previousPlayer = null;
    this.pattern='focused';this.mount='bow';this.hitVolleys=new Set();
  }
  get defeated() { return this.hull <= 0; }
  get charge() { return this.gunPhase === 'aim' ? this.gunTime / DEFENSE.aimSeconds : this.gunPhase === 'locked' ? 1 : 0; }
  inArc(nav, mount=this.mount) {
    const d = sub(nav.position, nav.enemyPosition);
    if(len(d)>DEFENSE.range+1e-8) return false;
    if(mount==='bow' || mount==='stern') {
      const facing=nav.enemyYaw+(mount==='stern'?Math.PI:0);
      if(Math.abs(wrap(Math.atan2(d.x,d.z)-facing))>DEFENSE.coneYaw || Math.abs(Math.atan2(d.y,Math.hypot(d.x,d.z)))>DEFENSE.conePitch)return false;
    }
    const c=Math.cos(nav.enemyYaw),s=Math.sin(nav.enemyYaw);
    const local={x:c*d.x-s*d.z,y:d.y,z:s*d.x+c*d.z};
    return !blockedByHull(GUN_MOUNTS[mount],local);
  }
  selectMount(nav) {
    return this.inArc(nav,'bow') ? 'bow' : this.inArc(nav,'stern') ? 'stern' : this.inArc(nav,'dorsal') ? 'dorsal' : null;
  }
  muzzle(nav) {
    const pivot=nav.world(GUN_MOUNTS[this.mount]);
    const aim=this.aimPoint || nav.position,d=sub(aim,pivot),distance=len(d)||1;
    return {x:pivot.x+d.x/distance*6,y:pivot.y+d.y/distance*6,z:pivot.z+d.z/distance*6};
  }
  directions(nav) {
    if(!this.aimPoint) return [];
    const d=sub(this.aimPoint,this.muzzle(nav)), length=len(d)||1;
    const centre={x:d.x/length,y:d.y/length,z:d.z/length};
    const count=this.pattern==='fan'?DEFENSE.fanCount:1;
    return Array.from({length:count},(_,i)=>{
      const angle=(i-(count-1)/2)*DEFENSE.fanStep,c=Math.cos(angle),s=Math.sin(angle);
      return {x:c*centre.x+s*centre.z,y:centre.y,z:-s*centre.x+c*centre.z};
    });
  }
  damage(amount) { this.hull=Math.max(0,this.hull-amount);this.hitAge=0; }
  ceaseFire() {
    this.gunPhase = 'idle'; this.gunTime = 0; this.aimPoint = null;
    this.bolts = []; this.turning = 0; this.muzzleAge = -1; this.hitVolleys.clear();
  }
  update(delta, nav, {breached=false}={}) {
    const dt = clamp(delta,0,.05), events = [];
    if (!dt) return events;
    if(this.hitAge >= 0) this.hitAge += dt;
    if(this.muzzleAge >= 0) this.muzzleAge += dt;
    if (!nav.active || this.defeated) {
      this.phase = this.defeated ? 'victory' : 'idle';
      this.ceaseFire(); this.previousPlayer = {...nav.position}; return events;
    }
    // A lodged harpoon arrests the hull and prevents NEW attacks. A charged gun
    // finishes its existing salvo at its last aim point; flying rounds stay physical.
    const suppressed=Boolean(nav.anchor || breached);
    if(suppressed) this.phase=breached?'breached':'tethered';
    else {
      if(['idle','tethered','breached'].includes(this.phase)) {this.phase='turn';this.turnTime=0;this.turnGoal=null;}
      // Orbit the player's current position without dragging the player or forcing
      // a fixed range. Forward thrust can still close the gap. Keep the rear window
      // independent of movement: the hull does not instantly face the player.
      const d=sub(nav.enemyPosition,nav.position),flat=Math.hypot(d.x,d.z);
      const step=Math.min(DEFENSE.orbitRate,DEFENSE.orbitSpeed/(flat||1))*dt,c=Math.cos(step),s=Math.sin(step);
      nav.setEnemyPosition({x:nav.position.x+c*d.x+s*d.z,y:nav.enemyPosition.y,z:nav.position.z-s*d.x+c*d.z});
    }
    // Four seconds of slow yaw; six seconds of stable heading leave a rear window.
    const weaponHold=this.gunPhase==='locked'||(this.shots>0&&this.cooldown>0);
    if(!suppressed && !weaponHold)this.turnTime += dt;
    this.turning = 0;
    if(!suppressed && !weaponHold && this.phase === 'turn') {
      if(this.turnGoal === null) {
        const d = sub(nav.position,nav.enemyPosition);
        this.turnGoal = Math.atan2(d.x,d.z);
      }
      const change = clamp(wrap(this.turnGoal-nav.enemyYaw),-DEFENSE.turnRate*dt,DEFENSE.turnRate*dt);
      nav.setEnemyYaw(nav.enemyYaw+change); this.turning = change/dt;
      if(this.turnTime >= DEFENSE.turnSeconds) {this.phase='hold';this.turnTime=0;}
    } else if(!suppressed && !weaponHold && this.turnTime >= DEFENSE.holdSeconds) {this.phase='turn';this.turnTime=0;this.turnGoal=null;}

    const previousPlayer = this.previousPlayer || nav.position;
    for(const bolt of this.bolts) {
      const before = {...bolt.position}; bolt.age += dt;
      for(const axis of ['x','y','z']) bolt.position[axis] += bolt.direction[axis]*DEFENSE.boltSpeed*dt;
      // Relative swept segments avoid tunnelling and include player movement this frame.
      const a=sub(before,previousPlayer), b=sub(bolt.position,nav.position), ab=sub(b,a);
      const t=clamp(-dot(a,ab)/(dot(ab,ab)||1),0,1);
      if(Math.hypot(a.x+ab.x*t,a.y+ab.y*t,a.z+ab.z*t) <= DEFENSE.hitRadius) {
        bolt.age=DEFENSE.boltLife;
        if(!this.hitVolleys.has(bolt.volley)) {
          this.damage(bolt.damage);this.hitVolleys.add(bolt.volley);this.hits++; events.push('enemy-hit');
        }
      }
    }
    this.bolts=this.bolts.filter(b=>b.age<DEFENSE.boltLife);
    for(const id of this.hitVolleys) if(!this.bolts.some(b=>b.volley===id)) this.hitVolleys.delete(id);
    this.previousPlayer={...nav.position};
    if(this.defeated) { this.phase='victory';this.ceaseFire();nav.stopOrbit();events.push('defeated');return events; }
    this.cooldown=Math.max(0,this.cooldown-dt);
    const mount=this.selectMount(nav),arc=mount!==null;
    if(this.gunPhase === 'idle') {
      if(!suppressed && arc && this.cooldown===0) {this.mount=mount;this.pattern=this.shots%2===0?'focused':'fan';this.gunPhase='aim';this.gunTime=0;this.aimPoint={...nav.position};events.push('enemy-charge');}
    } else if(this.gunPhase === 'aim') {
      if(!suppressed && !arc) {this.gunPhase='idle';this.aimPoint=null;this.cooldown=1;}
      else {
        if(!suppressed) {this.mount=mount;this.aimPoint={...nav.position};}
        this.gunTime+=dt;
        if(this.gunTime>=DEFENSE.aimSeconds) {this.gunPhase='locked';this.gunTime=0;events.push('enemy-lock');}
      }
    } else if(this.gunPhase === 'locked') {
      this.gunTime+=dt;
      if(this.gunTime>=DEFENSE.lockSeconds) {
        const position=this.muzzle(nav);
        for(const direction of this.directions(nav)) this.bolts.push({position:{...position},direction,age:0,volley:this.shots+1,damage:DEFENSE.damage});
        this.shots++;this.muzzleAge=0;this.cooldown=DEFENSE.reloadSeconds;
        this.gunPhase='idle';this.gunTime=0;events.push('enemy-fire');
      }
    }
    return events;
  }
  getState() {
    return {phase:this.phase,turning:this.turning,gunPhase:this.gunPhase,charge:this.charge,pattern:this.pattern,mount:this.mount,
      orbiting:['turn','hold'].includes(this.phase),finishingAttack:['tethered','breached'].includes(this.phase)&&this.gunPhase!=='idle',
      aimPoint:this.aimPoint && {...this.aimPoint},hull:this.hull,defeated:this.defeated,
      shots:this.shots,hits:this.hits,bolts:this.bolts.map(b=>({...b,position:{...b.position},direction:{...b.direction}}))};
  }
}
