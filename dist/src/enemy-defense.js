const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const len = v => Math.hypot(v.x,v.y,v.z);
const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;

export const DEFENSE = Object.freeze({
  turnRate: .04, turnSeconds: 4, holdSeconds: 6,
  range: 300, coneYaw: .7, conePitch: .5,
  aimSeconds: 1.8, lockSeconds: 1.2, reloadSeconds: 3.5,
  boltSpeed: 220, boltLife: 3, hitRadius: 6, hull: 100, damage: 25,
  fanStep: .1, fanCount: 9, aftDamage: 10,
});

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
  inArc(nav) {
    const d = sub(nav.position, nav.enemyPosition);
    const facing=nav.enemyYaw+(this.mount==='aft'?Math.PI:0);
    return len(d) <= DEFENSE.range && Math.abs(wrap(Math.atan2(d.x,d.z)-facing)) <= DEFENSE.coneYaw && Math.abs(Math.atan2(d.y,Math.hypot(d.x,d.z))) <= DEFENSE.conePitch;
  }
  muzzle(nav) { return nav.world(this.mount==='aft'?{x:0,y:9,z:-58}:{x:0,y:2,z:39}); }
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
    this.bolts = []; this.turning = 0;
  }
  update(delta, nav, {breached=false}={}) {
    const dt = clamp(delta,0,.05), events = [];
    if (!dt) return events;
    if(this.hitAge >= 0) this.hitAge += dt;
    if(this.muzzleAge >= 0) this.muzzleAge += dt;
    if (!nav.active || breached || this.defeated) {
      this.phase = this.defeated ? 'victory' : breached ? 'breached' : 'idle';
      this.ceaseFire(); this.previousPlayer = {...nav.position}; return events;
    }
    const mount=nav.anchor?'aft':'bow';
    if(this.mount!==mount) {
      this.mount=mount;this.gunPhase='idle';this.gunTime=0;this.aimPoint=null;this.cooldown=.4;
    }
    // Four seconds of slow, committed yaw; six seconds holding still leave a rear window.
    if(this.phase === 'idle') { this.phase = 'turn'; this.turnTime = 0; this.turnGoal = null; }
    const weaponHold=this.gunPhase==='locked'||(this.shots>0&&this.cooldown>0)||Boolean(nav.anchor);
    if(!weaponHold)this.turnTime += dt;
    this.turning = 0;
    if(!weaponHold && this.phase === 'turn') {
      if(this.turnGoal === null) {
        const d = sub(nav.position,nav.enemyPosition);
        this.turnGoal = Math.atan2(d.x,d.z);
      }
      const change = clamp(wrap(this.turnGoal-nav.enemyYaw),-DEFENSE.turnRate*dt,DEFENSE.turnRate*dt);
      nav.setEnemyYaw(nav.enemyYaw+change); this.turning = change/dt;
      if(this.turnTime >= DEFENSE.turnSeconds) {this.phase='hold';this.turnTime=0;}
    } else if(!weaponHold && this.turnTime >= DEFENSE.holdSeconds) {this.phase='turn';this.turnTime=0;this.turnGoal=null;}

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
    const arc=this.inArc(nav);
    if(this.gunPhase === 'idle') {
      if(arc && this.cooldown===0) {this.pattern=this.shots%2===0?'focused':'fan';this.gunPhase='aim';this.gunTime=0;this.aimPoint={...nav.position};events.push('enemy-charge');}
    } else if(this.gunPhase === 'aim') {
      if(!arc) {this.gunPhase='idle';this.aimPoint=null;this.cooldown=1;}
      else {
        this.aimPoint={...nav.position};this.gunTime+=dt;
        if(this.gunTime>=DEFENSE.aimSeconds) {this.gunPhase='locked';this.gunTime=0;events.push('enemy-lock');}
      }
    } else if(this.gunPhase === 'locked') {
      this.gunTime+=dt;
      if(this.gunTime>=DEFENSE.lockSeconds) {
        const position=this.muzzle(nav);
        for(const direction of this.directions(nav)) this.bolts.push({position:{...position},direction,age:0,volley:this.shots+1,damage:this.mount==='aft'?DEFENSE.aftDamage:DEFENSE.damage});
        this.shots++;this.muzzleAge=0;this.cooldown=DEFENSE.reloadSeconds;
        this.gunPhase='idle';this.gunTime=0;events.push('enemy-fire');
      }
    }
    return events;
  }
  getState() {
    return {phase:this.phase,turning:this.turning,gunPhase:this.gunPhase,charge:this.charge,pattern:this.pattern,mount:this.mount,
      aimPoint:this.aimPoint && {...this.aimPoint},hull:this.hull,defeated:this.defeated,
      shots:this.shots,hits:this.hits,bolts:this.bolts.map(b=>({...b,position:{...b.position},direction:{...b.direction}}))};
  }
}
