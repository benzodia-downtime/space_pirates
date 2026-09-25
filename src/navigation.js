const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = v => Math.hypot(v.x, v.y, v.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const unit = v => scale(v, 1 / (length(v) || 1));
const rotate = (v, yaw) => ({ x: Math.cos(yaw) * v.x + Math.sin(yaw) * v.z, y: v.y, z: -Math.sin(yaw) * v.x + Math.cos(yaw) * v.z });

export const HELM = Object.freeze({ yawScale: 0.442, pitchScale: 0.312, dragRadians: 0.006 });
export const FLIGHT = Object.freeze({ contactDistance: 1100, surveyDistance: 220, forwardSpeed: 80, reverseSpeed: 45, closeSpeed: 22, safetyRadius: 85 });
export const ORBIT = Object.freeze({ radius: 155, minRadius: 120, speed: 0.095, sternZ: -51, doorHalfSize: 3.65 });

export function relativeHelm(origin, dragX, dragY) {
  // An orbit can carry the camera over a pole. Regripping must not clamp that view back.
  const pitchLimit = Math.max(3.8, Math.abs(origin.y));
  return { x: origin.x + dragX * HELM.dragRadians / HELM.yawScale, y: clamp(origin.y + dragY * HELM.dragRadians / HELM.pitchScale, -pitchLimit, pitchLimit) };
}

export function lookAt(from, to, reference) {
  const d = subtract(to, from);
  const flat = Math.hypot(d.x, d.z);
  const yaw = flat < 1e-8 && reference ? reference.yaw : Math.atan2(d.x, -d.z);
  const pitch = Math.atan2(-d.y, flat);
  if (!reference) return { yaw, pitch };
  // Equivalent Euler branches prevent a 180-degree camera flip at the orbital poles.
  const closest = (y, p) => ({ yaw: reference.yaw + wrap(y - reference.yaw), pitch: reference.pitch + wrap(p - reference.pitch) });
  const a = closest(yaw, pitch), b = closest(yaw + Math.PI, Math.PI - pitch);
  const cost = v => Math.hypot(v.yaw - reference.yaw, v.pitch - reference.pitch);
  return cost(a) <= cost(b) ? a : b;
}

// Camera pitch is positive downward. Radar guidance is positive upward.
export function pitchOffsetDegrees(viewPitch, targetPitch) {
  return (viewPitch - targetPitch) * 180 / Math.PI;
}

// Enemy pose never changes while orbiting. Only our cockpit travels around it.
// No renderer dependency: discovery, occlusion and harpoon hit tests are deterministic.
export class OrbitNavigation {
  constructor() { this.reset(); }
  reset() {
    this.active = false; this.placed = false; this.orbiting = false; this.direction = 1;
    this.speed = 0; this.safetyStop = false;
    this.angle = 0; this.elevation = 0; this.radius = ORBIT.radius;
    this.orbitNormal = null;
    this.enemyYaw = 0; this.enemyPosition = { x: 0, y: 0, z: 0 };
    this.position = { x: 0, y: 0, z: 6 };
    this.discovered = false; this.observeTime = 0; this.anchor = null; this.harpoonTarget = null; this.pullVector = null;
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
  get target() { return this.anchor || this.harpoonTarget || (this.discovered && this.solution.visible ? this.door : this.enemyPosition); }
  updatePosition() {
    const flat = Math.cos(this.elevation) * this.radius;
    this.position = this.world({ x: Math.sin(this.angle) * flat, y: Math.sin(this.elevation) * this.radius, z: Math.cos(this.angle) * flat });
    this.orbitNormal = null;
  }
  move(delta, view, thrust = 0) {
    this.speed = 0; this.safetyStop = false;
    if (this.anchor || !thrust || delta <= 0) return;
    this.orbiting = false; // Manual thrust explicitly takes over from autopilot.
    this.orbitNormal = null;
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
    this.orbiting = !this.orbiting;
    if (this.orbiting && !this.orbitNormal) {
      const radial = unit(subtract(this.position, this.enemyPosition));
      const tangent = rotate({ x: Math.cos(this.angle) * this.direction, y: 0, z: -Math.sin(this.angle) * this.direction }, this.enemyYaw);
      this.orbitNormal = unit(cross(radial, tangent));
    }
    return true;
  }
  reverse() {
    if (!this.canOrbit) return;
    this.direction *= -1;
    if (this.orbitNormal) this.orbitNormal = scale(this.orbitNormal, -1);
  }
  stopOrbit() { this.orbiting = false; this.speed = 0; }
  steerOrbit(input, view) {
    if (!this.orbiting || !this.canOrbit || Math.hypot(input.x, input.y) < 0.15) return false;
    const radial = unit(subtract(this.position, this.enemyPosition));
    const right = { x: Math.cos(view.yaw), y: 0, z: Math.sin(view.yaw) };
    const up = { x: Math.sin(view.yaw) * Math.sin(view.pitch), y: Math.cos(view.pitch), z: -Math.cos(view.yaw) * Math.sin(view.pitch) };
    const wanted = { x: right.x * input.x - up.x * input.y, y: -up.y * input.y, z: right.z * input.x - up.z * input.y };
    // Screen-space pad direction projected onto the constant-distance orbital sphere.
    const tangent = subtract(wanted, scale(radial, dot(wanted, radial)));
    if (length(tangent) < 1e-6) return false;
    this.orbitNormal = unit(cross(radial, tangent));
    if (Math.abs(input.x) > 0.15) this.direction = Math.sign(input.x);
    return true;
  }
  update(delta, view) {
    const dt = clamp(delta, 0, 0.05);
    const previous = lookAt(this.position, this.enemyPosition, view);
    if (this.orbiting && !this.anchor && dt > 0) {
      const radial = unit(subtract(this.position, this.enemyPosition));
      const tangent = cross(this.orbitNormal, radial);
      const step = dt * ORBIT.speed, c = Math.cos(step), s = Math.sin(step);
      const nextRadial = unit({ x: radial.x * c + tangent.x * s, y: radial.y * c + tangent.y * s, z: radial.z * c + tangent.z * s });
      this.position = { x: this.enemyPosition.x + nextRadial.x * this.radius, y: this.enemyPosition.y + nextRadial.y * this.radius, z: this.enemyPosition.z + nextRadial.z * this.radius };
      const local = rotate(nextRadial, -this.enemyYaw);
      this.angle = Math.atan2(local.x, local.z);
      this.elevation = Math.atan2(local.y, Math.hypot(local.x, local.z));
      this.speed = this.radius * ORBIT.speed;
    }
    const next = lookAt(this.position, this.enemyPosition, previous);
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
    const canFire = !this.anchor && !this.harpoonTarget && this.discovered && visible && incidence >= 0.9 && t > 0 && Math.abs(hit.x) < ORBIT.doorHalfSize && Math.abs(hit.y) < ORBIT.doorHalfSize;
    this.solution = { visible, canFire, distance, incidence, aimError, hit: canFire ? this.world(hit) : null };
    return this.solution;
  }
  launch(view) {
    const s = this.inspect(view);
    if (!s.canFire) return null;
    // Reserve the ray-hit point, but continue the current orbit during projectile flight.
    this.harpoonTarget = { ...s.hit };
    this.solution.canFire = false;
    return { distance: length(subtract(this.position, this.harpoonTarget)) - 14, bearing: lookAt(this.position, this.harpoonTarget, view) };
  }
  attach(view) {
    if (this.anchor || (!this.harpoonTarget && !this.launch(view))) return null;
    this.anchor = this.harpoonTarget; this.harpoonTarget = null;
    this.stopOrbit();
    // The ship can move during flight. Lock the cable from the impact-time position.
    const v = subtract(this.position, this.anchor); const distance = length(v);
    this.pullVector = { x: v.x / distance, y: v.y / distance, z: v.z / distance };
    return { distance: distance - 14, bearing: lookAt(this.position, this.anchor, view) };
  }
  pull(distance) {
    if (!this.anchor) return;
    this.stopOrbit();
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
      orbitNormal: this.orbitNormal && { ...this.orbitNormal }, elevationDegrees: this.elevation * 180 / Math.PI,
      doorDiscovered: this.discovered, doorVisible: this.solution.visible, canHarpoon: this.solution.canFire,
      doorDistance: this.solution.distance, incidence: this.solution.incidence, anchor: this.anchor && { ...this.anchor },
      harpoonTarget: this.harpoonTarget && { ...this.harpoonTarget },
      doorBearing: lookAt(this.position, this.door) };
  }
}
