const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = v => Math.hypot(v.x, v.y, v.z);
const rotate = (v, yaw) => ({ x: Math.cos(yaw) * v.x + Math.sin(yaw) * v.z, y: v.y, z: -Math.sin(yaw) * v.x + Math.cos(yaw) * v.z });

export const HELM = Object.freeze({ yawScale: 0.442, pitchScale: 0.312, dragRadians: 0.006 });
export const FLIGHT = Object.freeze({ contactDistance: 1100, surveyDistance: 220, forwardSpeed: 80, reverseSpeed: 45, closeSpeed: 22, safetyRadius: 85 });
export const ORBIT = Object.freeze({ radius: 155, minRadius: 120, speed: 0.19, sternZ: -51, doorHalfSize: 3.65 });

export function relativeHelm(origin, dragX, dragY) {
  return { x: origin.x + dragX * HELM.dragRadians / HELM.yawScale, y: clamp(origin.y + dragY * HELM.dragRadians / HELM.pitchScale, -3.8, 3.8) };
}

export function lookAt(from, to) {
  const d = subtract(to, from);
  return { yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(-d.y, Math.hypot(d.x, d.z)) };
}

// Enemy pose never changes while orbiting. Only our cockpit travels around it.
// No renderer dependency: discovery, occlusion and harpoon hit tests are deterministic.
export class OrbitNavigation {
  constructor() { this.reset(); }
  reset() {
    this.active = false; this.placed = false; this.orbiting = false; this.direction = 1;
    this.speed = 0; this.safetyStop = false;
    this.angle = 0; this.elevation = 0; this.radius = ORBIT.radius;
    this.enemyYaw = 0; this.enemyPosition = { x: 0, y: 0, z: 0 };
    this.position = { x: 0, y: 0, z: 6 };
    this.discovered = false; this.observeTime = 0; this.anchor = null; this.pullVector = null;
    this.solution = { visible: false, canFire: false, distance: 0, incidence: 0, aimError: Math.PI };
  }
  begin(bearing, { position = this.position, radius = ORBIT.radius, active = true } = {}) {
    const origin = { ...position };
    this.reset(); this.active = active; this.placed = true; this.radius = radius;
    this.enemyYaw = -bearing.x * 0.65; this.elevation = bearing.y * 0.65;
    const offset = rotate({ x: 0, y: Math.sin(this.elevation) * this.radius, z: Math.cos(this.elevation) * this.radius }, this.enemyYaw);
    this.enemyPosition = { x: origin.x - offset.x, y: origin.y - offset.y, z: origin.z - offset.z };
    this.updatePosition();
  }
  world(local) {
    const r = rotate(local, this.enemyYaw);
    return { x: r.x + this.enemyPosition.x, y: r.y + this.enemyPosition.y, z: r.z + this.enemyPosition.z };
  }
  get door() { return this.world({ x: 0, y: 0, z: ORBIT.sternZ }); }
  get target() { return this.anchor || (this.discovered && this.solution.visible ? this.door : this.enemyPosition); }
  updatePosition() {
    const flat = Math.cos(this.elevation) * this.radius;
    this.position = this.world({ x: Math.sin(this.angle) * flat, y: Math.sin(this.elevation) * this.radius, z: Math.cos(this.angle) * flat });
  }
  move(delta, view, thrust = 0) {
    this.speed = 0; this.safetyStop = false;
    if (this.anchor || !thrust || delta <= 0) return;
    this.orbiting = false; // Manual thrust explicitly takes over from autopilot.
    const speed = this.radius < 300 ? FLIGHT.closeSpeed : thrust > 0 ? FLIGHT.forwardSpeed : FLIGHT.reverseSpeed;
    const step = clamp(delta, 0, 0.05) * clamp(thrust, -1, 1) * speed;
    const next = { x: this.position.x + Math.sin(view.yaw) * Math.cos(view.pitch) * step,
      y: this.position.y - Math.sin(view.pitch) * step, z: this.position.z - Math.cos(view.yaw) * Math.cos(view.pitch) * step };
    const local = rotate(subtract(next, this.enemyPosition), -this.enemyYaw);
    const radius = length(local);
    // A non-destructive safety stop keeps ordinary flight out of the enemy hull.
    // The explicit harpoon assault alone is allowed to cross this clearance.
    if (this.placed && radius < FLIGHT.safetyRadius) { this.safetyStop = true; return; }
    this.position = next; this.speed = Math.sign(thrust) * speed;
    this.radius = radius;
    this.angle = Math.atan2(local.x, local.z);
    this.elevation = Math.atan2(local.y, Math.hypot(local.x, local.z));
  }
  get orbitTooClose() { return this.radius < ORBIT.minRadius; }
  get canOrbit() { return this.active && !this.anchor && !this.orbitTooClose; }
  toggleOrbit() {
    // Stopping is always allowed; starting is validated here for every input path.
    if (!this.orbiting && !this.canOrbit) return false;
    this.orbiting = !this.orbiting; return true;
  }
  reverse() { if (this.canOrbit) this.direction *= -1; }
  update(delta, view) {
    const dt = clamp(delta, 0, 0.05);
    const previous = lookAt(this.position, this.enemyPosition);
    if (this.orbiting && !this.anchor) {
      this.angle += dt * ORBIT.speed * this.direction;
      this.elevation *= Math.exp(-dt * 0.6); // Settle onto the target's equatorial orbit without a position jump.
      this.updatePosition();
      this.speed = this.radius * ORBIT.speed;
    }
    const next = lookAt(this.position, this.enemyPosition);
    const shift = { yaw: wrap(next.yaw - previous.yaw), pitch: next.pitch - previous.pitch };
    this.inspect({ yaw: view.yaw + shift.yaw, pitch: view.pitch + shift.pitch }, dt);
    return shift;
  }
  inspect(view, dt = 0) {
    const local = rotate(subtract(this.position, this.enemyPosition), -this.enemyYaw);
    const direction = rotate({ x: Math.sin(view.yaw) * Math.cos(view.pitch), y: -Math.sin(view.pitch), z: -Math.cos(view.yaw) * Math.cos(view.pitch) }, -this.enemyYaw);
    const delta = { x: -local.x, y: -local.y, z: ORBIT.sternZ - local.z };
    const distance = length(delta);
    const incidence = (ORBIT.sternZ - local.z) / distance;
    const dot = (delta.x * direction.x + delta.y * direction.y + delta.z * direction.z) / distance;
    const aimError = Math.acos(clamp(dot, -1, 1));
    // Rear-facing plane + incidence excludes shots through bow/side armour.
    const visible = incidence > 0.3 && distance < 230 && aimError < 0.5;
    this.observeTime = visible && aimError < 0.13 ? this.observeTime + dt : 0;
    if (this.observeTime >= 0.3) this.discovered = true;
    const t = Math.abs(direction.z) > 1e-6 ? (ORBIT.sternZ - local.z) / direction.z : -1;
    const hit = { x: local.x + direction.x * t, y: local.y + direction.y * t, z: ORBIT.sternZ };
    const canFire = !this.anchor && this.discovered && visible && incidence >= 0.9 && t > 0 && Math.abs(hit.x) < ORBIT.doorHalfSize && Math.abs(hit.y) < ORBIT.doorHalfSize;
    this.solution = { visible, canFire, distance, incidence, aimError, hit: canFire ? this.world(hit) : null };
    return this.solution;
  }
  attach(view) {
    const s = this.inspect(view);
    if (!s.canFire) return null;
    this.anchor = { ...s.hit }; this.orbiting = false; this.speed = 0;
    const v = subtract(this.position, this.anchor); const distance = length(v);
    this.pullVector = { x: v.x / distance, y: v.y / distance, z: v.z / distance };
    return { distance: distance - 14, bearing: lookAt(this.position, this.anchor) };
  }
  pull(distance) {
    if (!this.anchor) return;
    this.position = { x: this.anchor.x + this.pullVector.x * (distance + 14), y: this.anchor.y + this.pullVector.y * (distance + 14), z: this.anchor.z + this.pullVector.z * (distance + 14) };
  }
  forceRear(viewOnly = false) {
    this.angle = Math.PI; this.elevation = 0; this.updatePosition();
    const view = lookAt(this.position, this.door);
    this.inspect(view, 0.5);
    if (!viewOnly) this.attach(view);
    return view;
  }
  getState() {
    return { active: this.active, placed: this.placed, speed: this.speed, safetyStop: this.safetyStop, orbiting: this.orbiting, canOrbit: this.canOrbit, orbitTooClose: this.orbitTooClose, minOrbitRadius: ORBIT.minRadius, direction: this.direction, radius: this.radius, angleDegrees: ((this.angle * 180 / Math.PI) % 360 + 360) % 360,
      position: { ...this.position }, enemyPosition: { ...this.enemyPosition }, enemyYaw: this.enemyYaw,
      doorDiscovered: this.discovered, doorVisible: this.solution.visible, canHarpoon: this.solution.canFire,
      doorDistance: this.solution.distance, incidence: this.solution.incidence, anchor: this.anchor && { ...this.anchor },
      doorBearing: lookAt(this.position, this.door) };
  }
}
