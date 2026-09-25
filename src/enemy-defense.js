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
  }
  get defeated() { return this.hull <= 0; }
  get charge() { return this.gunPhase === 'aim' ? this.gunTime / DEFENSE.aimSeconds : this.gunPhase === 'locked' ? 1 : 0; }
  inArc(nav) {
    const d = sub(nav.position, nav.enemyPosition);
    return len(d) <= DEFENSE.range && Math.abs(wrap(Math.atan2(d.x,d.z)-nav.enemyYaw)) <= DEFENSE.coneYaw && Math.abs(Math.atan2(d.y,Math.hypot(d.x,d.z))) <= DEFENSE.conePitch;
  }
  muzzle(nav) { return nav.world({x:0,y:2,z:39}); }
  ceaseFire() {
    this.gunPhase = 'idle'; this.gunTime = 0; this.aimPoint = null;
    this.bolts = []; this.turning = 0;
  }
  update(delta, nav) {
    const dt = clamp(delta,0,.05), events = [];
    if (!dt) return events;
    if(this.hitAge >= 0) this.hitAge += dt;
    if(this.muzzleAge >= 0) this.muzzleAge += dt;
    if (!nav.active || nav.anchor || this.defeated) {
      this.phase = this.defeated ? 'victory' : nav.anchor ? 'tethered' : 'idle';
      this.ceaseFire(); this.previousPlayer = {...nav.position}; return events;
    }
    // Four seconds of slow, committed yaw; six seconds holding still leave a rear window.
    if(this.phase === 'idle') { this.phase = 'turn'; this.turnTime = 0; this.turnGoal = null; }
    this.turnTime += dt; this.turning = 0;
    if(this.phase === 'turn') {
      if(this.turnGoal === null) {
        const d = sub(nav.position,nav.enemyPosition);
        this.turnGoal = Math.atan2(d.x,d.z);
      }
      const change = clamp(wrap(this.turnGoal-nav.enemyYaw),-DEFENSE.turnRate*dt,DEFENSE.turnRate*dt);
      nav.setEnemyYaw(nav.enemyYaw+change); this.turning = change/dt;
      if(this.turnTime >= DEFENSE.turnSeconds) {this.phase='hold';this.turnTime=0;}
    } else if(this.turnTime >= DEFENSE.holdSeconds) {this.phase='turn';this.turnTime=0;this.turnGoal=null;}

    const previousPlayer = this.previousPlayer || nav.position;
    for(const bolt of this.bolts) {
      const before = {...bolt.position}; bolt.age += dt;
      for(const axis of ['x','y','z']) bolt.position[axis] += bolt.direction[axis]*DEFENSE.boltSpeed*dt;
      // Relative swept segments avoid tunnelling and include player movement this frame.
      const a=sub(before,previousPlayer), b=sub(bolt.position,nav.position), ab=sub(b,a);
      const t=clamp(-dot(a,ab)/(dot(ab,ab)||1),0,1);
      if(Math.hypot(a.x+ab.x*t,a.y+ab.y*t,a.z+ab.z*t) <= DEFENSE.hitRadius) {
        bolt.age=DEFENSE.boltLife; this.hull=Math.max(0,this.hull-DEFENSE.damage);
        this.hitAge=0; this.hits++; events.push('enemy-hit');
      }
    }
    this.bolts=this.bolts.filter(b=>b.age<DEFENSE.boltLife);
    this.previousPlayer={...nav.position};
    if(this.defeated) { this.phase='victory';this.ceaseFire();nav.stopOrbit();events.push('defeated');return events; }
    this.cooldown=Math.max(0,this.cooldown-dt);
    const arc=this.inArc(nav);
    if(this.gunPhase === 'idle') {
      if(arc && this.cooldown===0) {this.gunPhase='aim';this.gunTime=0;this.aimPoint={...nav.position};events.push('enemy-charge');}
    } else if(this.gunPhase === 'aim') {
      if(!arc) {this.gunPhase='idle';this.aimPoint=null;this.cooldown=1;}
      else {
        this.aimPoint={...nav.position};this.gunTime+=dt;
        if(this.gunTime>=DEFENSE.aimSeconds) {this.gunPhase='locked';this.gunTime=0;events.push('enemy-lock');}
      }
    } else if(this.gunPhase === 'locked') {
      this.gunTime+=dt;
      if(this.gunTime>=DEFENSE.lockSeconds) {
        const position=this.muzzle(nav), d=sub(this.aimPoint,position), length=len(d)||1;
        this.bolts.push({position,direction:{x:d.x/length,y:d.y/length,z:d.z/length},age:0});
        this.shots++;this.muzzleAge=0;this.cooldown=DEFENSE.reloadSeconds;
        this.gunPhase='idle';this.gunTime=0;events.push('enemy-fire');
      }
    }
    return events;
  }
  getState() {
    return {phase:this.phase,turning:this.turning,gunPhase:this.gunPhase,charge:this.charge,
      aimPoint:this.aimPoint && {...this.aimPoint},hull:this.hull,defeated:this.defeated,
      shots:this.shots,hits:this.hits,bolts:this.bolts.map(b=>({...b,position:{...b.position},direction:{...b.direction}}))};
  }
}
