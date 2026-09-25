const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const easeOut = (value) => 1 - (1 - clamp(value)) ** 3;

export const ASSAULT_CONFIG = Object.freeze({
  startDistance: 1200, alignDistance: 170, stagingDistance: 90,
  contactDistance: 4, seatedDistance: 1.2,
  aimTolerance: 0.09, aimHoldSeconds: 0.65,
  deploySeconds: 1.4, chargeSeconds: 2.4, impactSeconds: 1.05,
  hitStopSeconds: 0.13, clampSeconds: 1.3, sealSeconds: 1.4, pressureSeconds: 2.2,
});

export const ASSAULT_COPY = Object.freeze({
  intercept: ["정면 접근", "적함 선수의 돌파 지점을 중앙 조준선에 맞추십시오.", "BOW INTERCEPT"],
  align: ["돌입축 정렬", "전방 격벽을 중앙에 유지해 강습 항로를 확보하십시오.", "ALIGN BREACH AXIS"],
  armed: ["강습 준비", "조준을 유지한 채 강습 돌입을 누르십시오.", "RAM SOLUTION READY"],
  "ram-deploy": ["충각 전개", "항로 고정. 선수 돌파 장치와 완충기를 전개합니다.", "01 / RAM DEPLOYING"],
  charge: ["강습 가속", "충돌에 대비하십시오. 적함 전방 격벽으로 돌진합니다.", "02 / BRACE FOR IMPACT"],
  impact: ["격벽 관통", "전방 장갑 파열. 충각이 진입구를 확보합니다.", "03 / HULL BREACHED"],
  clamp: ["선체 고정", "고정 발톱을 펼쳐 충각을 적함 격벽에 고정합니다.", "04 / CLAW LOCK"],
  seal: ["진입구 밀폐", "충각 내부의 기밀 통로를 손상된 격벽에 결합합니다.", "05 / BREACH SEAL"],
  pressurize: ["압력 동기화", "기밀 확인 후 내부 차단문을 개방합니다.", "06 / PRESSURE EQUALIZING"],
  ready: ["강습로 확보", "진입구가 확보되었습니다. 승무원을 적함 내부로 투입하십시오.", "PASSAGE CLEAR"],
});

// Simulation time only: pausing, a hidden tab or a lost GPU context cannot skip a beat.
export class AssaultSequence {
  constructor() { this.reset(); }

  reset() {
    this.stage = "inactive";
    this.elapsed = 0;
    this.distance = ASSAULT_CONFIG.startDistance;
    this.speed = 0;
    this.aimHold = 0;
    this.ram = 0;
    this.charge = 0;
    this.breach = 0;
    this.clamps = 0;
    this.seal = 0;
    this.pressure = 0;
    this.impactAge = -1;
    this.attackBearing = null;
  }

  get active() { return this.stage !== "inactive"; }
  get committed() { return this.attackBearing !== null; }
  enter(stage) { this.stage = stage; this.elapsed = 0; }
  begin() { this.reset(); this.enter("intercept"); }

  canCommit(aimError) {
    return this.stage === "armed" && aimError <= ASSAULT_CONFIG.aimTolerance && this.aimHold >= ASSAULT_CONFIG.aimHoldSeconds;
  }

  commit(aimError, bearing) {
    if (!this.canCommit(aimError)) return false;
    this.attackBearing = { ...bearing };
    this.enter("ram-deploy");
    return true;
  }

  update(delta, aimError) {
    if (!this.active || this.stage === "ready" || delta <= 0) return;
    const dt = clamp(delta, 0, 0.05);
    const c = ASSAULT_CONFIG;
    this.elapsed += dt;
    if (this.impactAge >= 0) this.impactAge += dt;
    const quality = clamp(1 - aimError / 0.5);

    if (this.stage === "intercept") {
      this.speed = -4 + quality * 130;
      this.distance = clamp(this.distance - this.speed * dt, c.alignDistance, c.startDistance + 200);
      if (this.distance <= c.alignDistance) this.enter("align");
    } else if (this.stage === "align" || this.stage === "armed") {
      this.speed = this.distance > c.stagingDistance ? 8 + quality * 23 : 0;
      this.distance = Math.max(c.stagingDistance, this.distance - this.speed * dt);
      const aligned = this.distance === c.stagingDistance && aimError <= c.aimTolerance;
      this.aimHold = aligned ? Math.min(c.aimHoldSeconds, this.aimHold + dt) : 0;
      if (this.stage === "align" && this.aimHold >= c.aimHoldSeconds) this.enter("armed");
    } else if (this.stage === "ram-deploy") {
      this.ram = easeOut(this.elapsed / c.deploySeconds);
      if (this.elapsed >= c.deploySeconds) this.enter("charge");
    } else if (this.stage === "charge") {
      this.charge = clamp(this.elapsed / c.chargeSeconds);
      this.distance = c.stagingDistance - (c.stagingDistance - c.contactDistance) * this.charge ** 2;
      this.speed = 2 * (c.stagingDistance - c.contactDistance) / c.chargeSeconds * this.charge;
      if (this.charge >= 1) {
        this.distance = c.contactDistance;
        this.speed = 0;
        this.impactAge = 0;
        this.enter("impact");
      }
    } else if (this.stage === "impact") {
      // Brief contact hold, then a short, visibly separate penetration stroke.
      this.breach = easeOut((this.elapsed - c.hitStopSeconds) / (c.impactSeconds - c.hitStopSeconds));
      this.distance = c.contactDistance - (c.contactDistance - c.seatedDistance) * this.breach;
      if (this.elapsed >= c.impactSeconds) { this.breach = 1; this.distance = c.seatedDistance; this.enter("clamp"); }
    } else if (this.stage === "clamp") {
      this.clamps = easeOut(this.elapsed / c.clampSeconds);
      if (this.elapsed >= c.clampSeconds) this.enter("seal");
    } else if (this.stage === "seal") {
      this.seal = easeOut(this.elapsed / c.sealSeconds);
      if (this.elapsed >= c.sealSeconds) this.enter("pressurize");
    } else if (this.stage === "pressurize") {
      this.pressure = clamp(this.elapsed / c.pressureSeconds);
      if (this.pressure >= 1) this.enter("ready");
    }
  }

  get progress() {
    const c = ASSAULT_CONFIG;
    if (this.stage === "intercept") return clamp((c.startDistance - this.distance) / (c.startDistance - c.alignDistance)) * 0.2;
    if (this.stage === "align") return 0.2 + clamp((c.alignDistance - this.distance) / (c.alignDistance - c.stagingDistance)) * 0.1;
    return ({ armed: 0.3, "ram-deploy": 0.3 + this.ram * 0.1, charge: 0.4 + this.charge * 0.2, impact: 0.6 + this.breach * 0.12, clamp: 0.72 + this.clamps * 0.1, seal: 0.82 + this.seal * 0.08, pressurize: 0.9 + this.pressure * 0.1, ready: 1 })[this.stage] || 0;
  }

  forceReady(bearing) {
    this.begin();
    this.attackBearing = { ...bearing };
    this.distance = ASSAULT_CONFIG.seatedDistance;
    this.ram = this.charge = this.breach = this.clamps = this.seal = this.pressure = 1;
    this.impactAge = 8;
    this.enter("ready");
  }
}
