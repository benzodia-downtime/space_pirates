const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const easeOut = (value) => 1 - (1 - clamp(value)) ** 3;

export const ASSAULT_CONFIG = Object.freeze({
  startDistance: 155,
  contactDistance: 4, seatedDistance: 1.2,
  deploySeconds: 1.4, chargeSeconds: 2.4, impactSeconds: 1.05,
  hitStopSeconds: 0.13, clampSeconds: 1.3, sealSeconds: 1.4, pressureSeconds: 2.2,
});

export const ASSAULT_COPY = Object.freeze({
  survey: ["진입점 탐색", "자동 선회로 적함 뒤를 살펴보고 하강문을 직접 조준하십시오.", "FIND THE AFT RAMP"],
  harpoon: ["작살 발사", "후방 하강문에 작살을 박고 견인 케이블을 고정합니다.", "HARPOON AWAY"],
  tethered: ["작살 고정", "연결 완료. Space 또는 견인 돌입을 누르면 문을 찢고 진입합니다.", "TETHER LOCKED / AWAITING INPUT"],
  "ram-deploy": ["충각 전개", "항로 고정. 선수 돌파 장치와 완충기를 전개합니다.", "01 / RAM DEPLOYING"],
  charge: ["급속 견인", "케이블 급속 회수. 적함 후방 하강문으로 끌려갑니다.", "02 / WINCH OVERDRIVE"],
  impact: ["하강문 파열", "하강문을 찢고 충각을 밀어 넣어 진입구를 확보합니다.", "03 / RAMP TORN OPEN"],
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
    this.ram = 0;
    this.charge = 0;
    this.breach = 0;
    this.clamps = 0;
    this.seal = 0;
    this.pressure = 0;
    this.impactAge = -1;
    this.attackBearing = null;
    this.harpoon = 0;
    this.tetherBearing = null;
    this.chargeStartDistance = 0;
  }

  get active() { return this.stage !== "inactive"; }
  get committed() { return this.attackBearing !== null; }
  enter(stage) { this.stage = stage; this.elapsed = 0; }
  begin() { this.reset(); this.enter("survey"); }

  fireHarpoon(solution) {
    if (this.stage !== "survey" || !solution || !Number.isFinite(solution.distance) || solution.distance <= ASSAULT_CONFIG.contactDistance) return false;
    this.distance = this.chargeStartDistance = solution.distance;
    this.tetherBearing = { ...solution.bearing };
    this.enter("harpoon");
    return true;
  }

  canCommit() {
    return this.stage === "tethered" && this.harpoon === 1;
  }

  lockTether(solution) {
    if (!this.canCommit() || !solution || !Number.isFinite(solution.distance) || solution.distance <= ASSAULT_CONFIG.contactDistance) return false;
    this.distance = this.chargeStartDistance = solution.distance;
    this.tetherBearing = { ...solution.bearing };
    return true;
  }

  commit() {
    if (!this.canCommit()) return false;
    this.attackBearing = { ...this.tetherBearing };
    this.enter("ram-deploy");
    return true;
  }

  update(delta) {
    if (!this.active || this.stage === "ready" || delta <= 0) return;
    const dt = clamp(delta, 0, 0.05);
    const c = ASSAULT_CONFIG;
    this.elapsed += dt;
    if (this.impactAge >= 0) this.impactAge += dt;
    if (this.stage === "harpoon") {
      this.harpoon = clamp(this.elapsed / 0.7);
      if (this.harpoon >= 1) this.enter("tethered");
    } else if (this.stage === "ram-deploy") {
      this.ram = easeOut(this.elapsed / c.deploySeconds);
      if (this.elapsed >= c.deploySeconds) this.enter("charge");
    } else if (this.stage === "charge") {
      this.charge = clamp(this.elapsed / c.chargeSeconds);
      this.distance = this.chargeStartDistance - (this.chargeStartDistance - c.contactDistance) * this.charge ** 2;
      this.speed = 2 * (this.chargeStartDistance - c.contactDistance) / c.chargeSeconds * this.charge;
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
    return ({ survey: 0, harpoon: 0.15 + this.harpoon * 0.15, tethered: 0.3, "ram-deploy": 0.3 + this.ram * 0.1, charge: 0.4 + this.charge * 0.2, impact: 0.6 + this.breach * 0.12, clamp: 0.72 + this.clamps * 0.1, seal: 0.82 + this.seal * 0.08, pressurize: 0.9 + this.pressure * 0.1, ready: 1 })[this.stage] || 0;
  }

  forceReady(bearing) {
    this.begin();
    this.attackBearing = { ...bearing };
    this.tetherBearing = { ...bearing }; this.harpoon = 1;
    this.distance = ASSAULT_CONFIG.seatedDistance;
    this.ram = this.charge = this.breach = this.clamps = this.seal = this.pressure = 1;
    this.impactAge = 8;
    this.enter("ready");
  }
}
