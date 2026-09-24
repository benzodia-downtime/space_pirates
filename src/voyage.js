const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap = (value, size) => ((value % size) + size) % size;

const VOYAGE_CONFIG = Object.freeze({
  nearPlane: 42,
  farPlane: 3600,
  desktopStarDensity: 1 / 3000,
  mobileStarDensity: 1 / 4300,
  minimumStars: 150,
  maximumStars: 420,
  cruiseSpeed: 0.058,
  searchBaseRate: 0.026,
  searchAlignedRate: 0.044,
  scanBoost: 0.13,
  scanCooldownSeconds: 4,
  signalProgress: 0.27,
  approachProgress: 0.64,
});

class PerspectiveStarfield {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas && typeof canvas.getContext === "function"
      ? canvas.getContext("2d", { alpha: true })
      : null;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.focalLength = 720;
    this.worldWidth = 2600;
    this.worldHeight = 1600;
    this.stars = [];
  }

  resize() {
    if (!this.canvas || !this.context) return;

    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || this.canvas.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, bounds.height || this.canvas.clientHeight || window.innerHeight || 1);
    const isMobile = width <= 720;
    const pixelRatio = clamp(window.devicePixelRatio || 1, 1, isMobile ? 1.5 : 2);
    const bufferWidth = Math.round(width * pixelRatio);
    const bufferHeight = Math.round(height * pixelRatio);

    if (
      bufferWidth === this.canvas.width &&
      bufferHeight === this.canvas.height &&
      width === this.width &&
      height === this.height
    ) {
      return;
    }

    this.canvas.width = bufferWidth;
    this.canvas.height = bufferHeight;
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.focalLength = Math.max(420, Math.min(width, height) * 0.92);
    this.worldWidth = Math.max(2200, width * 3.4);
    this.worldHeight = Math.max(1500, height * 3.2);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.createStars(isMobile);
  }

  createStars(isMobile) {
    const density = isMobile
      ? VOYAGE_CONFIG.mobileStarDensity
      : VOYAGE_CONFIG.desktopStarDensity;
    const count = Math.round(clamp(
      this.width * this.height * density,
      VOYAGE_CONFIG.minimumStars,
      VOYAGE_CONFIG.maximumStars,
    ));
    const depthSpan = VOYAGE_CONFIG.farPlane - VOYAGE_CONFIG.nearPlane;

    this.stars = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * this.worldWidth,
      y: (Math.random() - 0.5) * this.worldHeight,
      z: VOYAGE_CONFIG.nearPlane + Math.random() * depthSpan,
      size: 0.45 + Math.random() * 1.25,
      alpha: 0.42 + Math.random() * 0.56,
      phase: Math.random() * Math.PI * 2,
      tint: Math.random(),
    }));
  }

  draw(sceneTime, travelDistance, steering, allowMotion, speedFactor = 1) {
    const context = this.context;
    if (!context || !this.width || !this.height) return;

    const near = VOYAGE_CONFIG.nearPlane;
    const far = VOYAGE_CONFIG.farPlane;
    const depthSpan = far - near;
    const travel = travelDistance;
    const centerX = this.width / 2 - steering.x * this.width * 0.065;
    const centerY = this.height * 0.42 - steering.y * this.height * 0.05;
    const cameraX = steering.x * 0.2;
    const cameraY = steering.y * 0.14;
    const streakDepth = allowMotion ? 72 * speedFactor : 0;

    context.clearRect(0, 0, this.width, this.height);
    context.save();
    context.globalCompositeOperation = "lighter";

    for (const star of this.stars) {
      const z = near + wrap(star.z - travel - near, depthSpan);
      const shiftedX = star.x - cameraX * z;
      const shiftedY = star.y - cameraY * z;
      const scale = this.focalLength / z;
      const screenX = centerX + shiftedX * scale;
      const screenY = centerY + shiftedY * scale;
      const margin = 50;

      if (
        screenX < -margin ||
        screenX > this.width + margin ||
        screenY < -margin ||
        screenY > this.height + margin
      ) {
        continue;
      }

      const proximity = 1 - (z - near) / depthSpan;
      const twinkle = allowMotion
        ? 0.84 + Math.sin(sceneTime * (0.6 + star.size * 0.34) + star.phase) * 0.16
        : 0.92;
      const alpha = clamp(star.alpha * (0.2 + proximity * 0.95) * twinkle, 0.06, 1);
      const radius = star.size * (0.42 + proximity * proximity * 2.2);
      const color = star.tint > 0.92
        ? "190, 229, 255"
        : star.tint < 0.07
          ? "255, 222, 187"
          : "238, 248, 255";

      if (streakDepth > 0 && proximity > 0.18 && z + streakDepth < far) {
        const previousZ = z + streakDepth;
        const previousScale = this.focalLength / previousZ;
        const previousX = centerX + (star.x - cameraX * previousZ) * previousScale;
        const previousY = centerY + (star.y - cameraY * previousZ) * previousScale;
        context.beginPath();
        context.moveTo(previousX, previousY);
        context.lineTo(screenX, screenY);
        context.strokeStyle = `rgba(${color}, ${alpha * 0.62})`;
        context.lineWidth = Math.max(0.5, radius * 0.68);
        context.stroke();
      } else {
        context.beginPath();
        context.arc(screenX, screenY, Math.max(0.35, radius), 0, Math.PI * 2);
        context.fillStyle = `rgba(${color}, ${alpha})`;
        context.fill();
      }
    }

    context.restore();
  }

  clear() {
    this.context?.clearRect(0, 0, this.width, this.height);
  }
}

export class VoyageScene {
  constructor(ship, canvas) {
    this.ship = ship;
    this.spaceScene = document.getElementById("space-scene");
    this.playerStage = document.getElementById("ship-stage");
    this.enemyStage = document.getElementById("enemy-ship-stage");
    this.battleButton = document.getElementById("battle-start");
    this.battleButtonStatus = this.battleButton?.querySelector("span");
    this.stateLabel = document.getElementById("voyage-state");
    this.distanceLabel = document.getElementById("voyage-distance");
    this.progressBar = document.getElementById("voyage-progress-bar");
    this.speedLabel = document.getElementById("voyage-speed");
    this.coordinateLabel = document.getElementById("voyage-coordinate");
    this.announcement = document.getElementById("voyage-announcement");
    this.contactMarker = document.getElementById("contact-marker");
    this.contactBearingLabel = document.getElementById("contact-bearing");
    this.radar = document.getElementById("voyage-radar");
    this.radarBlip = document.getElementById("radar-blip");
    this.steeringPad = document.getElementById("steering-pad");
    this.steeringKnob = document.getElementById("steering-knob");
    this.scanButton = document.getElementById("scan-button");
    this.scanButtonState = document.getElementById("scan-button-state");
    this.starfield = new PerspectiveStarfield(canvas);
    this.engineGlows = ship
      ? Array.from(ship.querySelectorAll("[data-engine-glow], .engine-glow, .engine"))
      : [];

    this.pointer = { x: 0, y: 0 };
    this.pointerTarget = { x: 0, y: 0 };
    this.course = { x: 0, y: 0, roll: 0 };
    this.courseTarget = { x: 0, y: 0, roll: 0 };
    this.contactBearing = { x: 0.32, y: -0.08 };
    this.keys = new Set();
    this.activePointerId = null;
    this.sceneTime = 0;
    this.starTravel = 0;
    this.starSpeedFactor = 1;
    this.journeyDistance = 0;
    this.searchProgress = 0;
    this.cruiseElapsed = 0;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.spaceScene?.classList.remove("is-scanning");
    this.nextCourseAt = 3;
    this.lastFrameTime = 0;
    this.frameId = 0;
    this.hudAccumulator = 0;
    this.mode = "cruise";
    this.manuallyPaused = false;
    this.destroyed = false;

    this.requestFrame = window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(() => callback(Date.now()), 16);
    this.cancelFrame = window.cancelAnimationFrame
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    this.motionPreference = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    this.reducedMotion = Boolean(this.motionPreference?.matches);
    this.originalEngineOpacity = this.engineGlows.map((engine) => engine.style.opacity);

    this.onFrame = this.onFrame.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerEnd = this.onPointerEnd.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onScan = this.triggerScan.bind(this);
    this.onMotionPreferenceChange = this.onMotionPreferenceChange.bind(this);

    this.addListeners();
    this.starfield.resize();
    this.startNewSearch({ announce: false });
    this.renderStill();
    this.startLoop();
  }

  get hasVisuals() {
    return Boolean(this.ship || this.starfield.context);
  }

  get encounterReady() {
    return this.mode === "ready";
  }

  addListeners() {
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerup", this.onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", this.onPointerEnd, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.steeringPad?.addEventListener("pointerdown", this.onPointerDown);
    this.scanButton?.addEventListener("click", this.onScan);

    if (this.motionPreference) {
      if (typeof this.motionPreference.addEventListener === "function") {
        this.motionPreference.addEventListener("change", this.onMotionPreferenceChange);
      } else if (typeof this.motionPreference.addListener === "function") {
        this.motionPreference.addListener(this.onMotionPreferenceChange);
      }
    }
  }

  removeListeners() {
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerEnd);
    window.removeEventListener("pointercancel", this.onPointerEnd);
    document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.steeringPad?.removeEventListener("pointerdown", this.onPointerDown);
    this.scanButton?.removeEventListener("click", this.onScan);

    if (this.motionPreference) {
      if (typeof this.motionPreference.removeEventListener === "function") {
        this.motionPreference.removeEventListener("change", this.onMotionPreferenceChange);
      } else if (typeof this.motionPreference.removeListener === "function") {
        this.motionPreference.removeListener(this.onMotionPreferenceChange);
      }
    }
  }

  onPointerDown(event) {
    if (this.manuallyPaused || this.destroyed) return;
    this.activePointerId = event.pointerId;
    this.steeringPad?.setPointerCapture?.(event.pointerId);
    this.updateTargetFromPad(event.clientX, event.clientY);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (this.manuallyPaused || this.destroyed) return;

    if (this.activePointerId === event.pointerId) {
      this.updateTargetFromPad(event.clientX, event.clientY);
      return;
    }

    if (event.pointerType === "mouse" && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      this.pointerTarget.x = clamp((event.clientX / width) * 2 - 1, -1, 1);
      this.pointerTarget.y = clamp((event.clientY / height) * 2 - 1, -1, 1);
    }
  }

  updateTargetFromPad(clientX, clientY) {
    const bounds = this.steeringPad?.getBoundingClientRect();
    if (!bounds) return;
    const halfWidth = Math.max(1, bounds.width / 2);
    const halfHeight = Math.max(1, bounds.height / 2);
    this.pointerTarget.x = clamp((clientX - bounds.left - halfWidth) / (halfWidth * 0.72), -1, 1);
    this.pointerTarget.y = clamp((clientY - bounds.top - halfHeight) / (halfHeight * 0.72), -1, 1);
  }

  onPointerEnd(event) {
    if (this.activePointerId !== event.pointerId) return;
    this.steeringPad?.releasePointerCapture?.(event.pointerId);
    this.activePointerId = null;
    this.pointerTarget.x = 0;
    this.pointerTarget.y = 0;
  }

  onPointerLeave() {
    if (this.activePointerId !== null) return;
    this.pointerTarget.x = 0;
    this.pointerTarget.y = 0;
  }

  onKeyDown(event) {
    const tagName = event.target?.tagName;
    const isFormControl = tagName === "BUTTON" || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
    if (isFormControl) return;

    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      this.keys.add(key);
      if (!this.spaceScene?.hidden) event.preventDefault();
    } else if (event.code === "Space" && !this.spaceScene?.hidden) {
      this.triggerScan();
      event.preventDefault();
    }
  }

  onKeyUp(event) {
    this.keys.delete(event.key.toLowerCase());
  }

  getKeyboardTarget() {
    const x = Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft"));
    const y = Number(this.keys.has("s") || this.keys.has("arrowdown")) - Number(this.keys.has("w") || this.keys.has("arrowup"));
    if (!x && !y) return null;
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }

  onResize() {
    this.starfield.resize();
    this.renderStill();
  }

  onVisibilityChange() {
    if (document.hidden) {
      this.stopLoop();
    } else if (!this.manuallyPaused) {
      this.starfield.resize();
      this.startLoop();
    }
  }

  onMotionPreferenceChange(event) {
    this.reducedMotion = event.matches;
    if (!this.manuallyPaused && !document.hidden) this.startLoop();
    this.renderStill();
  }

  chooseNewCourse() {
    this.courseTarget.x = (Math.random() - 0.5) * 10;
    this.courseTarget.y = (Math.random() - 0.5) * 6;
    this.courseTarget.roll = (Math.random() - 0.5) * 1.1;
    this.nextCourseAt = this.sceneTime + 5 + Math.random() * 7;
  }

  startNewSearch({ announce = true } = {}) {
    this.mode = "cruise";
    this.searchProgress = 0;
    this.cruiseElapsed = 0;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.contactBearing = {
      x: (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.24),
      y: -0.14 + Math.random() * 0.26,
    };

    if (this.enemyStage) {
      this.enemyStage.dataset.contactState = "hidden";
      this.enemyStage.setAttribute("aria-hidden", "true");
      this.enemyStage.style.setProperty("--enemy-opacity", "0");
      this.enemyStage.style.setProperty("--enemy-scale", "0.08");
    }
    if (this.battleButton) {
      this.battleButton.hidden = true;
      this.battleButton.disabled = true;
    }
    if (this.battleButtonStatus) this.battleButtonStatus.textContent = "장거리 탐색 중";
    if (this.contactMarker) this.contactMarker.hidden = true;
    if (this.scanButton) this.scanButton.disabled = false;
    this.scanButton?.setAttribute("aria-label", "장거리 센서 펄스 방출");
    if (this.scanButtonState) this.scanButtonState.textContent = "SCAN";
    this.spaceScene?.setAttribute("data-voyage-state", "cruise");
    this.updateHud(true);

    if (announce && this.announcement) {
      this.announcement.textContent = "새 항로에서 장거리 탐색을 시작합니다.";
    }
  }

  resolveEncounter({ lootRecovered = false } = {}) {
    if (lootRecovered) this.startNewSearch({ announce: true });
  }

  triggerScan() {
    if (
      this.destroyed ||
      this.manuallyPaused ||
      this.encounterReady ||
      this.scanCooldown > 0 ||
      this.spaceScene?.hidden
    ) {
      return;
    }

    this.searchProgress = Math.min(0.96, this.searchProgress + VOYAGE_CONFIG.scanBoost);
    this.scanCooldown = VOYAGE_CONFIG.scanCooldownSeconds;
    this.scanPulse = 0.82;
    this.spaceScene?.classList.add("is-scanning");
    if (this.scanButton) this.scanButton.disabled = true;
    this.scanButton?.setAttribute("aria-label", "장거리 센서 펄스 재충전 중");
    if (this.announcement) {
      this.announcement.textContent = "센서 펄스를 방출했습니다. 다음 펄스까지 4초입니다.";
    }
    this.updateMode();
    this.updateHud(true);
  }

  update(deltaSeconds) {
    this.sceneTime += deltaSeconds;
    this.journeyDistance += deltaSeconds * VOYAGE_CONFIG.cruiseSpeed * 820;
    this.cruiseElapsed += deltaSeconds;
    this.hudAccumulator += deltaSeconds;

    if (this.sceneTime >= this.nextCourseAt) this.chooseNewCourse();

    const keyboardTarget = this.getKeyboardTarget();
    const target = keyboardTarget || this.pointerTarget;
    const pointerEase = 1 - Math.exp(-deltaSeconds * 3.8);
    const courseEase = 1 - Math.exp(-deltaSeconds * 0.5);
    this.pointer.x += (target.x - this.pointer.x) * pointerEase;
    this.pointer.y += (target.y - this.pointer.y) * pointerEase;
    this.course.x += (this.courseTarget.x - this.course.x) * courseEase;
    this.course.y += (this.courseTarget.y - this.course.y) * courseEase;
    this.course.roll += (this.courseTarget.roll - this.course.roll) * courseEase;

    const targetStarSpeed = this.encounterReady ? 0.42 : 1;
    const starSpeedEase = 1 - Math.exp(-deltaSeconds * 1.8);
    this.starSpeedFactor += (targetStarSpeed - this.starSpeedFactor) * starSpeedEase;
    if (!this.reducedMotion) {
      this.starTravel += deltaSeconds * 305 * this.starSpeedFactor;
    }

    if (this.scanCooldown > 0) {
      const previousCooldown = this.scanCooldown;
      this.scanCooldown = Math.max(0, this.scanCooldown - deltaSeconds);
      if (this.scanCooldown === 0 && this.scanButton && !this.encounterReady) {
        this.scanButton.disabled = false;
        this.scanButton.setAttribute("aria-label", "장거리 센서 펄스 방출");
        if (previousCooldown > 0 && this.announcement) {
          this.announcement.textContent = "센서 펄스가 다시 준비되었습니다.";
        }
      }
    }

    if (this.scanPulse > 0) {
      this.scanPulse = Math.max(0, this.scanPulse - deltaSeconds);
      if (this.scanPulse === 0) this.spaceScene?.classList.remove("is-scanning");
    }

    if (!this.encounterReady) {
      const relativeX = this.contactBearing.x - this.pointer.x * 0.68;
      const relativeY = this.contactBearing.y - this.pointer.y * 0.48;
      const alignment = clamp(1 - Math.hypot(relativeX, relativeY) / 0.9, 0, 1);
      const launchRamp = clamp(this.cruiseElapsed / 4, 0.35, 1);
      this.searchProgress = Math.min(
        1,
        this.searchProgress + deltaSeconds * launchRamp * (
          VOYAGE_CONFIG.searchBaseRate + alignment * VOYAGE_CONFIG.searchAlignedRate
        ),
      );
      this.updateMode();
    }

    if (this.hudAccumulator >= 0.12) {
      this.hudAccumulator = 0;
      this.updateHud();
    }
  }

  updateMode() {
    const previousMode = this.mode;
    if (this.searchProgress >= 1) {
      this.mode = "ready";
    } else if (this.searchProgress >= VOYAGE_CONFIG.approachProgress) {
      this.mode = "approach";
    } else if (this.searchProgress >= VOYAGE_CONFIG.signalProgress) {
      this.mode = "signal";
    } else {
      this.mode = "cruise";
    }

    if (this.mode === previousMode) return;
    this.spaceScene?.setAttribute("data-voyage-state", this.mode);

    if (this.mode === "signal" && this.announcement) {
      this.announcement.textContent = "장거리 센서에 희미한 열원이 감지되었습니다.";
    } else if (this.mode === "approach" && this.announcement) {
      this.announcement.textContent = "미확인 함선을 식별했습니다. 접근 중입니다.";
    } else if (this.mode === "ready") {
      this.revealEncounter();
    }
  }

  revealEncounter() {
    if (this.enemyStage) {
      this.enemyStage.dataset.contactState = "ready";
      this.enemyStage.removeAttribute("aria-hidden");
    }
    if (this.battleButton) {
      this.battleButton.hidden = false;
      this.battleButton.disabled = false;
    }
    if (this.battleButtonStatus) this.battleButtonStatus.textContent = "미확인 함선 포착";
    if (this.scanButton) this.scanButton.disabled = true;
    this.scanButton?.setAttribute("aria-label", "적함 포착 완료");
    if (this.scanButtonState) this.scanButtonState.textContent = "LOCK";
    if (this.announcement) {
      this.announcement.textContent = "적함을 포착했습니다. 전투를 시작할 수 있습니다.";
    }
  }

  updateHud(force = false) {
    const progressPercent = Math.round(this.searchProgress * 100);
    const distanceKm = Math.max(1.2, 28.4 * (1 - this.searchProgress) + 1.2);
    const bearingDegrees = Math.round(this.contactBearing.x * 42 - this.pointer.x * 28);
    const bearingText = bearingDegrees === 0
      ? "정면"
      : bearingDegrees > 0
        ? `우현 ${bearingDegrees}°`
        : `좌현 ${Math.abs(bearingDegrees)}°`;

    if (this.mode === "cruise") {
      if (this.stateLabel) this.stateLabel.textContent = "막막한 항해 중";
      if (this.distanceLabel) this.distanceLabel.textContent = "확인된 신호 없음";
    } else if (this.mode === "signal") {
      if (this.stateLabel) this.stateLabel.textContent = "희미한 열원 감지";
      if (this.distanceLabel) this.distanceLabel.textContent = `미확인 신호 · ${bearingText}`;
    } else if (this.mode === "approach") {
      if (this.stateLabel) this.stateLabel.textContent = "미확인 함선 접근 중";
      if (this.distanceLabel) this.distanceLabel.textContent = `${distanceKm.toFixed(1)} km · ${bearingText}`;
    } else {
      if (this.stateLabel) this.stateLabel.textContent = "적함 포착";
      if (this.distanceLabel) this.distanceLabel.textContent = "1.2 km · 승선 거리 확보";
    }

    if (this.progressBar) this.progressBar.style.width = `${progressPercent}%`;
    if (this.speedLabel) {
      this.speedLabel.textContent = `${(VOYAGE_CONFIG.cruiseSpeed + Math.abs(this.pointer.x) * 0.004).toFixed(3)}c`;
    }
    if (this.coordinateLabel) {
      const x = Math.floor((this.journeyDistance * 0.72) % 1000).toString().padStart(3, "0");
      const y = Math.floor((this.journeyDistance * 0.39) % 1000).toString().padStart(3, "0");
      this.coordinateLabel.textContent = `X ${x} · Y ${y}`;
    }
    if (this.scanButtonState && this.scanCooldown > 0 && !this.encounterReady) {
      this.scanButtonState.textContent = `${Math.ceil(this.scanCooldown)}s`;
    } else if (this.scanButtonState && !this.encounterReady) {
      this.scanButtonState.textContent = "SCAN";
    }

    if (force) this.updateContactVisuals();
  }

  updateContactVisuals() {
    const relativeX = this.contactBearing.x - this.pointer.x * 0.68;
    const relativeY = this.contactBearing.y - this.pointer.y * 0.48;
    const markerX = clamp(50 + relativeX * 54, 12, 88);
    const markerY = clamp(37 + relativeY * 38, 16, 67);
    const contactStrength = clamp(
      (this.searchProgress - VOYAGE_CONFIG.signalProgress) /
        (1 - VOYAGE_CONFIG.signalProgress),
      0,
      1,
    );
    const enemyReveal = clamp(
      (this.searchProgress - VOYAGE_CONFIG.approachProgress) /
        (1 - VOYAGE_CONFIG.approachProgress),
      0,
      1,
    );

    this.spaceScene?.style.setProperty("--contact-x", `${markerX.toFixed(2)}%`);
    this.spaceScene?.style.setProperty("--contact-y", `${markerY.toFixed(2)}%`);
    this.spaceScene?.style.setProperty("--contact-opacity", contactStrength.toFixed(3));

    if (this.contactMarker) {
      this.contactMarker.hidden = this.mode === "cruise";
    }
    if (this.contactBearingLabel) {
      this.contactBearingLabel.textContent = this.mode === "ready"
        ? "HOSTILE LOCKED"
        : this.mode === "approach"
          ? "UNKNOWN VESSEL"
          : "FAINT CONTACT";
    }

    if (this.radar) {
      this.radar.style.setProperty("--radar-x", `${clamp(50 + relativeX * 64, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-y", `${clamp(46 + relativeY * 58, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-opacity", clamp(this.searchProgress * 1.7, 0, 1).toFixed(3));
    }

    if (this.enemyStage) {
      this.enemyStage.style.setProperty("--enemy-x", `${markerX.toFixed(2)}%`);
      this.enemyStage.style.setProperty("--enemy-y", `${markerY.toFixed(2)}%`);
      this.enemyStage.style.setProperty("--enemy-opacity", enemyReveal.toFixed(3));
      this.enemyStage.style.setProperty("--enemy-scale", (0.1 + enemyReveal * 0.9).toFixed(3));
      if (enemyReveal > 0 && this.enemyStage.dataset.contactState === "hidden") {
        this.enemyStage.dataset.contactState = "approach";
      }
    }
  }

  render(allowMotion) {
    const time = allowMotion ? this.sceneTime : 0;
    const steering = allowMotion ? this.pointer : { x: 0, y: 0 };
    this.starfield.draw(time, this.starTravel, steering, allowMotion, this.starSpeedFactor);

    const floatX = allowMotion ? Math.sin(this.sceneTime * 0.42) * 3.5 : 0;
    const floatY = allowMotion ? Math.sin(this.sceneTime * 0.58 + 0.7) * 4.5 : 0;
    const x = floatX + this.course.x + steering.x * 34;
    const y = floatY + this.course.y + Math.abs(steering.x) * 3 + steering.y * 12;
    const bank = this.course.roll + steering.x * 8.5;
    const pitch = steering.y * -3.2;
    const wakeLength = allowMotion
      ? clamp(0.78 + Math.sin(this.sceneTime * 31) * 0.08 + Math.sin(this.sceneTime * 53) * 0.04, 0.65, 0.96)
      : 0.78;
    const engineFlicker = allowMotion
      ? clamp(0.76 + Math.sin(this.sceneTime * 27) * 0.12 + Math.sin(this.sceneTime * 61) * 0.055, 0.54, 0.98)
      : 0.76;

    if (this.spaceScene) {
      this.spaceScene.style.setProperty("--flight-x", `${x.toFixed(2)}px`);
      this.spaceScene.style.setProperty("--flight-y", `${y.toFixed(2)}px`);
      this.spaceScene.style.setProperty("--flight-bank", `${bank.toFixed(2)}deg`);
      this.spaceScene.style.setProperty("--flight-pitch", `${pitch.toFixed(2)}deg`);
      this.spaceScene.style.setProperty("--wake-length", wakeLength.toFixed(3));
    }
    if (this.steeringKnob) {
      this.steeringKnob.style.setProperty("--knob-x", `${(steering.x * 22).toFixed(1)}px`);
      this.steeringKnob.style.setProperty("--knob-y", `${(steering.y * 22).toFixed(1)}px`);
    }
    for (const engine of this.engineGlows) {
      engine.style.setProperty("--engine-flicker", engineFlicker.toFixed(3));
      engine.style.opacity = engineFlicker.toFixed(3);
    }

    this.updateContactVisuals();
  }

  renderStill() {
    this.starfield.resize();
    this.render(false);
    this.updateHud(true);
  }

  onFrame(timestamp) {
    this.frameId = 0;
    if (this.destroyed || this.manuallyPaused || document.hidden) return;

    const deltaSeconds = this.lastFrameTime
      ? clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.05)
      : 0;
    this.lastFrameTime = timestamp;
    this.update(deltaSeconds);
    this.render(!this.reducedMotion);
    this.frameId = this.requestFrame(this.onFrame);
  }

  startLoop() {
    if (
      this.destroyed ||
      this.frameId ||
      this.manuallyPaused ||
      document.hidden ||
      !this.hasVisuals
    ) {
      return;
    }
    this.lastFrameTime = 0;
    this.frameId = this.requestFrame(this.onFrame);
  }

  stopLoop() {
    if (this.frameId) {
      this.cancelFrame(this.frameId);
      this.frameId = 0;
    }
    this.lastFrameTime = 0;
  }

  pause() {
    this.manuallyPaused = true;
    this.stopLoop();
  }

  resume() {
    this.manuallyPaused = false;
    this.starfield.resize();
    this.renderStill();
    this.startLoop();
  }

  forceEncounter() {
    this.searchProgress = 1;
    this.updateMode();
    this.updateHud(true);
    this.renderStill();
  }

  getState() {
    return {
      mode: this.mode,
      searchProgress: this.searchProgress,
      encounterReady: this.encounterReady,
      journeyDistance: this.journeyDistance,
    };
  }

  focusControls() {
    this.scanButton?.focus({ preventScroll: true });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    this.removeListeners();
    this.starfield.clear();
    this.spaceScene?.classList.remove("is-scanning");
    this.keys.clear();

    for (const engine of this.engineGlows) {
      const index = this.engineGlows.indexOf(engine);
      engine.style.opacity = this.originalEngineOpacity[index];
      engine.style.removeProperty("--engine-flicker");
    }
  }
}
