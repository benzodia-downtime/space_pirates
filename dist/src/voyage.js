import { VoyageRenderer } from "./voyage-renderer.js?v=ram-1";
import { AssaultSequence, ASSAULT_CONFIG, ASSAULT_COPY } from "./assault.js?v=ram-1";
import { AssaultAudio } from "./assault-audio.js?v=ram-1";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const VOYAGE_CONFIG = Object.freeze({
  cruiseSpeed: 0.058,
  searchBaseRate: 0.026,
  searchAlignedRate: 0.044,
  scanBoost: 0.13,
  scanCooldownSeconds: 4,
  signalProgress: 0.27,
  approachProgress: 0.64,
});

export class VoyageScene {
  constructor(canvas) {
    this.spaceScene = document.getElementById("space-scene");
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
    this.interceptMarker = document.getElementById("intercept-marker");
    this.radar = document.getElementById("voyage-radar");
    this.radarBlip = document.getElementById("radar-blip");
    this.boardingPanel = document.getElementById("boarding-panel");
    this.boardingPhaseLabel = document.getElementById("boarding-phase");
    this.boardingObjective = document.getElementById("boarding-objective");
    this.boardingDistanceLabel = document.getElementById("boarding-distance");
    this.relativeSpeedLabel = document.getElementById("relative-speed");
    this.alignmentLabel = document.getElementById("alignment-value");
    this.breachLabel = document.getElementById("breach-value");
    this.boardingProgressBar = document.getElementById("boarding-progress-bar");
    this.ramState = document.getElementById("ram-state");
    this.clampState = document.getElementById("clamp-state");
    this.boardingSealState = document.getElementById("boarding-seal-state");
    this.boardingAction = document.getElementById("boarding-action");
    this.boardingActionStatus = document.getElementById("boarding-action-status");
    this.boardingActionLabel = document.getElementById("boarding-action-label");
    this.steeringPad = document.getElementById("steering-pad");
    this.steeringKnob = document.getElementById("steering-knob");
    this.scanButton = document.getElementById("scan-button");
    this.scanButtonState = document.getElementById("scan-button-state");
    this.assault = new AssaultSequence();
    this.audio = new AssaultAudio();
    this.soundButton = document.getElementById("sound-button");
    this.assaultCue = document.getElementById("assault-cue");
    this.onSoundToggle = () => { const enabled = this.audio.toggle(); this.soundButton.textContent = enabled ? "SFX ON" : "SFX OFF"; this.soundButton.setAttribute("aria-pressed", String(enabled)); };
    this.visuals = new VoyageRenderer(canvas);
    this.visuals.onLost = () => this.audio.stop();
    this.visuals.onRestore = () => { this.renderStill(); this.startLoop(); };

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

    this.onFrame = this.onFrame.bind(this);
    this.onResize = this.onResize.bind(this);
    this.onVisibilityChange = this.onVisibilityChange.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerEnd = this.onPointerEnd.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onScan = this.triggerScan.bind(this);
    this.onBoardingAction = this.handleBoardingAction.bind(this);
    this.onMotionPreferenceChange = this.onMotionPreferenceChange.bind(this);

    this.addListeners();
    this.visuals.resize();
    this.startNewSearch({ announce: false });
    this.renderStill();
    this.startLoop();
  }

  get hasVisuals() {
    return this.visuals.available;
  }

  get encounterReady() {
    return this.mode === "ready";
  }

  get isSearching() {
    return ["cruise", "signal", "approach"].includes(this.mode);
  }

  get isBoardingActive() { return this.assault.active; }

  addListeners() {
    this.soundButton?.addEventListener("click", this.onSoundToggle);
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerup", this.onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", this.onPointerEnd, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.steeringPad?.addEventListener("pointerdown", this.onPointerDown);
    this.scanButton?.addEventListener("click", this.onScan);
    this.boardingAction?.addEventListener("click", this.onBoardingAction);

    if (this.motionPreference) {
      if (typeof this.motionPreference.addEventListener === "function") {
        this.motionPreference.addEventListener("change", this.onMotionPreferenceChange);
      } else if (typeof this.motionPreference.addListener === "function") {
        this.motionPreference.addListener(this.onMotionPreferenceChange);
      }
    }
  }

  removeListeners() {
    this.soundButton?.removeEventListener("click", this.onSoundToggle);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerEnd);
    window.removeEventListener("pointercancel", this.onPointerEnd);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.steeringPad?.removeEventListener("pointerdown", this.onPointerDown);
    this.scanButton?.removeEventListener("click", this.onScan);
    this.boardingAction?.removeEventListener("click", this.onBoardingAction);

    if (this.motionPreference) {
      if (typeof this.motionPreference.removeEventListener === "function") {
        this.motionPreference.removeEventListener("change", this.onMotionPreferenceChange);
      } else if (typeof this.motionPreference.removeListener === "function") {
        this.motionPreference.removeListener(this.onMotionPreferenceChange);
      }
    }
  }

  onPointerDown(event) {
    if (this.manuallyPaused || this.destroyed || this.assault.committed) return;
    if (this.activePointerId !== null && this.activePointerId !== event.pointerId) return;
    this.activePointerId = event.pointerId;
    this.steeringPad?.setPointerCapture?.(event.pointerId);
    this.updateTargetFromPad(event.clientX, event.clientY);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (this.manuallyPaused || this.destroyed || this.assault.committed) return;
    if (this.activePointerId !== event.pointerId) return;
    this.updateTargetFromPad(event.clientX, event.clientY);
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
    // The helm is latched: releasing the pad keeps the selected heading.
  }

  onKeyDown(event) {
    const tagName = event.target?.tagName;
    const isTextControl = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
    const isNativeButtonAction = tagName === "BUTTON" && (event.code === "Space" || event.key === "Enter");
    if (isTextControl) return;
    if (this.spaceScene?.hidden) return;
    if (this.manuallyPaused || this.destroyed) {
      if (event.code === "Space" || event.key === "Enter") event.preventDefault();
      return;
    }
    if (isNativeButtonAction) {
      if (event.repeat) event.preventDefault();
      return;
    }
    if (event.code === "Space" && event.repeat) {
      event.preventDefault();
      return;
    }

    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      if (!this.assault.committed) this.keys.add(key);
      event.preventDefault();
    } else if (event.code === "Space") {
      if (this.isSearching) {
        this.triggerScan();
      } else if (this.encounterReady) {
        this.battleButton?.click();
      } else {
        this.handleBoardingAction();
      }
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
    this.visuals.resize();
    this.renderStill();
  }

  onVisibilityChange() {
    if (document.hidden) {
      this.stopLoop();
      this.audio.stop();
    } else if (!this.manuallyPaused) {
      this.visuals.resize();
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

  resetBoardingState() {
    this.assault.reset();
    if (this.boardingPanel) this.boardingPanel.hidden = true;
    if (this.assaultCue) this.assaultCue.hidden = true;
    if (this.interceptMarker) this.interceptMarker.hidden = true;
    if (this.boardingAction) { this.boardingAction.hidden = true; this.boardingAction.disabled = true; }
    this.steeringPad?.setAttribute("aria-disabled", "false");
    this.spaceScene?.removeAttribute("data-boarding-state");
    this.spaceScene?.removeAttribute("data-helm-locked");
    this.spaceScene?.style.setProperty("--impact-flash", "0");
    this.audio.stop();
  }

  startNewSearch({ announce = true } = {}) {
    this.mode = "cruise";
    this.searchProgress = 0;
    this.cruiseElapsed = 0;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.spaceScene?.classList.remove("is-scanning");
    this.resetBoardingState();
    this.contactBearing = {
      x: (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.24),
      y: -0.14 + Math.random() * 0.26,
    };

    if (this.battleButton) {
      this.battleButton.hidden = true;
      this.battleButton.disabled = true;
    }
    if (this.battleButtonStatus) this.battleButtonStatus.textContent = "전방 격벽 관통 · 진입 가능";
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

  setVoyageMode(nextMode, announcement = "") {
    const modeChanged = this.mode !== nextMode;
    this.mode = nextMode;
    if (modeChanged) this.audio.play(nextMode);
    this.spaceScene?.setAttribute("data-voyage-state", nextMode);
    if (this.isBoardingActive) {
      this.spaceScene?.setAttribute("data-boarding-state", nextMode);
    }
    if (announcement && this.announcement) this.announcement.textContent = announcement;
    this.updateBoardingControls();
  }

  beginIntercept() {
    this.assault.begin();
    if (this.boardingPanel) this.boardingPanel.hidden = false;
    if (this.boardingAction) this.boardingAction.hidden = false;
    if (this.battleButton) { this.battleButton.hidden = true; this.battleButton.disabled = true; }
    if (this.scanButton) this.scanButton.disabled = true;
    this.setVoyageMode("intercept", "적함 정면을 확보했습니다. 전방 격벽의 돌파 지점을 조준하십시오.");
    this.updateHud(true);
  }

  getActualBearing() {
    if (this.assault.attackBearing) return { ...this.assault.attackBearing };
    if (!this.isBoardingActive) return { ...this.contactBearing };
    return {
      x: this.contactBearing.x + Math.sin(this.sceneTime * 0.6) * 0.018,
      y: this.contactBearing.y + Math.sin(this.sceneTime * 0.43) * 0.008,
    };
  }

  getGuidanceBearing() { return this.getActualBearing(); }

  getTrackingMetrics() {
    const guidance = this.getGuidanceBearing();
    const relativeX = guidance.x - this.pointer.x * 0.68;
    const relativeY = guidance.y - this.pointer.y * 0.48;
    const error = Math.hypot(relativeX, relativeY);
    return {
      guidance,
      relativeX,
      relativeY,
      error,
      quality: clamp(1 - error / 0.58, 0, 1),
    };
  }

  handleBoardingAction() {
    if (this.destroyed || this.manuallyPaused || !this.visuals.available || this.spaceScene?.hidden) return;
    const tracking = this.getTrackingMetrics();
    if (!this.assault.canCommit(tracking.error)) return;
    this.audio.unlock();
    if (!this.assault.commit(tracking.error, this.getActualBearing())) return;
    this.keys.clear();
    if (this.activePointerId !== null) this.steeringPad?.releasePointerCapture?.(this.activePointerId);
    this.activePointerId = null;
    this.pointerTarget.x = this.assault.attackBearing.x / 0.68;
    this.pointerTarget.y = this.assault.attackBearing.y / 0.48;
    this.setVoyageMode(this.assault.stage, ASSAULT_COPY[this.assault.stage][1]);
    this.updateHud(true);
  }

  getBoardingProgress() { return this.assault.progress; }

  triggerScan() {
    if (
      this.destroyed ||
      this.manuallyPaused ||
      !this.isSearching ||
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

  updateBoardingControls() {
    if (!this.isBoardingActive) return;
    const armed = this.assault.canCommit(this.getTrackingMetrics().error);
    if (this.battleButton) { this.battleButton.hidden = !this.encounterReady; this.battleButton.disabled = !this.encounterReady; }
    if (this.boardingAction) {
      this.boardingAction.hidden = this.encounterReady;
      this.boardingAction.disabled = !armed;
    }
    const copy = ASSAULT_COPY[this.mode];
    const label = this.mode === "armed" ? "강습 돌입" : copy?.[0] || "정면 접근";
    const status = this.mode === "armed" ? (armed ? "충돌 항로 확보 · 눌러서 돌진" : "돌파 지점을 다시 중앙에 정렬") : copy?.[1] || "";
    if (this.boardingActionLabel) this.boardingActionLabel.textContent = label;
    if (this.boardingActionStatus) this.boardingActionStatus.textContent = status;
    this.boardingAction?.setAttribute("aria-label", status + ". " + label);
    if (this.scanButtonState) this.scanButtonState.textContent = this.assault.committed ? "LOCK" : "AIM";
    this.steeringPad?.setAttribute("aria-disabled", String(this.assault.committed));
    this.spaceScene?.setAttribute("data-helm-locked", String(this.assault.committed));
    this.scanButton?.setAttribute("aria-label", this.assault.committed ? "강습 항로 고정 중" : "적함 전방 격벽 조준 중");
    if (this.assaultCue) {
      this.assaultCue.hidden = !this.assault.committed;
      this.assaultCue.querySelector("span").textContent = copy?.[2] || "";
      this.assaultCue.querySelector("strong").textContent = copy?.[0] || "";
    }
  }

  updateBoarding(deltaSeconds) {
    this.assault.update(deltaSeconds, this.getTrackingMetrics().error);
    if (this.mode !== this.assault.stage) this.setVoyageMode(this.assault.stage, ASSAULT_COPY[this.assault.stage][1]);
  }

  update(deltaSeconds) {
    this.sceneTime += deltaSeconds;
    this.journeyDistance += deltaSeconds * VOYAGE_CONFIG.cruiseSpeed * 820;
    this.cruiseElapsed += deltaSeconds;
    this.hudAccumulator += deltaSeconds;

    if (this.sceneTime >= this.nextCourseAt) this.chooseNewCourse();

    const keyboardTarget = this.getKeyboardTarget();
    if (keyboardTarget && !this.assault.committed) {
      const nudgeRate = this.isBoardingActive ? 0.62 : 1.05;
      this.pointerTarget.x = clamp(
        this.pointerTarget.x + keyboardTarget.x * nudgeRate * deltaSeconds,
        -1,
        1,
      );
      this.pointerTarget.y = clamp(
        this.pointerTarget.y + keyboardTarget.y * nudgeRate * deltaSeconds,
        -1,
        1,
      );
    }
    const target = this.pointerTarget;
    const pointerEase = 1 - Math.exp(-deltaSeconds * 3.8);
    const courseEase = 1 - Math.exp(-deltaSeconds * 0.5);
    this.pointer.x += (target.x - this.pointer.x) * pointerEase;
    this.pointer.y += (target.y - this.pointer.y) * pointerEase;
    this.course.x += (this.courseTarget.x - this.course.x) * courseEase;
    this.course.y += (this.courseTarget.y - this.course.y) * courseEase;
    this.course.roll += (this.courseTarget.roll - this.course.roll) * courseEase;

    const targetStarSpeed = this.isSearching ? 1 : this.mode === "charge" ? 1 + this.assault.charge * 8 : this.assault.committed ? 0.015 : 0.5;
    const starSpeedEase = 1 - Math.exp(-deltaSeconds * 1.8);
    this.starSpeedFactor = this.assault.impactAge >= 0 ? 0 : this.starSpeedFactor + (targetStarSpeed - this.starSpeedFactor) * starSpeedEase;
    if (!this.reducedMotion) {
      this.starTravel += deltaSeconds * 305 * this.starSpeedFactor;
    }

    if (this.scanCooldown > 0) {
      const previousCooldown = this.scanCooldown;
      this.scanCooldown = Math.max(0, this.scanCooldown - deltaSeconds);
      if (this.scanCooldown === 0 && this.scanButton && this.isSearching) {
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

    if (this.isSearching) {
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
    } else if (this.isBoardingActive && !this.encounterReady) {
      this.updateBoarding(deltaSeconds);
    }

    if (this.hudAccumulator >= 0.12) {
      this.hudAccumulator = 0;
      this.updateHud();
    }
  }

  updateMode() {
    const previousMode = this.mode;
    if (this.searchProgress >= 1) {
      this.beginIntercept();
      return;
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
    }
  }

  updateHud(force = false) {
    const progressPercent = Math.round((this.isSearching ? this.searchProgress : this.getBoardingProgress()) * 100);
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
    } else if (this.isBoardingActive) {
      if (this.stateLabel) this.stateLabel.textContent = ASSAULT_COPY[this.mode][0];
      if (this.distanceLabel) this.distanceLabel.textContent = this.assault.committed ? ASSAULT_COPY[this.mode][2] : Math.round(this.assault.distance) + " m · 전방 격벽 조준";
    }

    if (this.progressBar) this.progressBar.style.width = `${progressPercent}%`;
    if (this.speedLabel) {
      this.speedLabel.textContent = this.isBoardingActive ? `${this.assault.speed.toFixed(1)} m/s` : `${(VOYAGE_CONFIG.cruiseSpeed + Math.abs(this.pointer.x) * 0.004).toFixed(3)}c`;
    }
    if (this.coordinateLabel) {
      const x = Math.floor((this.journeyDistance * 0.72) % 1000).toString().padStart(3, "0");
      const y = Math.floor((this.journeyDistance * 0.39) % 1000).toString().padStart(3, "0");
      this.coordinateLabel.textContent = `X ${x} · Y ${y}`;
    }
    if (this.scanButtonState && this.scanCooldown > 0 && this.isSearching) {
      this.scanButtonState.textContent = `${Math.ceil(this.scanCooldown)}s`;
    } else if (this.scanButtonState && this.isSearching) {
      this.scanButtonState.textContent = "SCAN";
    }

    if (this.isBoardingActive) {
      const a = this.assault;
      if (this.boardingDistanceLabel) this.boardingDistanceLabel.textContent = a.breach > 0 ? "관통 " + (a.breach * (ASSAULT_CONFIG.contactDistance - ASSAULT_CONFIG.seatedDistance)).toFixed(1) + " m" : a.distance.toFixed(a.distance < 100 ? 1 : 0) + " m";
      if (this.relativeSpeedLabel) this.relativeSpeedLabel.textContent = a.speed.toFixed(1) + " m/s";
      if (this.alignmentLabel) this.alignmentLabel.textContent = a.committed ? "항로 고정" : Math.round(this.getTrackingMetrics().quality * 100) + "%";
      if (this.breachLabel) this.breachLabel.textContent = a.breach > 0 ? Math.round(a.breach * 100) + "%" : "대기";
      if (this.boardingProgressBar) this.boardingProgressBar.style.width = progressPercent + "%";
      if (this.boardingPhaseLabel) this.boardingPhaseLabel.textContent = ASSAULT_COPY[this.mode][0];
      if (this.boardingObjective) this.boardingObjective.textContent = ASSAULT_COPY[this.mode][1];
      for (const [element, progress, text] of [[this.ramState, a.ram, "RAM"], [this.clampState, a.clamps, "CLAWS"], [this.boardingSealState, a.pressure, "SEAL"]]) {
        if (!element) continue;
        element.dataset.state = progress >= 1 ? "locked" : "standby";
        element.textContent = text + " · " + (progress >= 1 ? "LOCKED" : progress > 0 ? Math.round(progress * 100) + "%" : "STOWED");
      }
      this.updateBoardingControls();
    }

    if (force) this.updateContactVisuals();
  }

  updateContactVisuals() {
    const actual = this.getActualBearing();
    const actualRelativeX = actual.x - this.pointer.x * 0.68;
    const actualRelativeY = actual.y - this.pointer.y * 0.48;
    const guidance = this.getTrackingMetrics();
    const contactStrength = this.isBoardingActive
      ? 1
      : clamp(
        (this.searchProgress - VOYAGE_CONFIG.signalProgress) /
          (1 - VOYAGE_CONFIG.signalProgress),
        0,
        1,
      );
    const enemyReveal = this.isBoardingActive
      ? 1
      : clamp(
        (this.searchProgress - VOYAGE_CONFIG.approachProgress) /
          (1 - VOYAGE_CONFIG.approachProgress),
        0,
        1,
      );

    const projected = this.visuals.draw({
      bearing: actual, guidance: guidance.guidance, steering: this.pointer,
      distance: this.isBoardingActive ? this.assault.distance : 1200 + (1 - enemyReveal) * 3800,
      reveal: enemyReveal, time: this.sceneTime, motion: !this.reducedMotion,
      travel: this.starTravel, assault: this.assault,
    });
    const markerX = clamp(projected?.contact.x ?? 50 + actualRelativeX * 54, 6, 94);
    const markerY = clamp(projected?.contact.y ?? 40 + actualRelativeY * 38, 8, 78);
    const interceptX = clamp(projected?.intercept.x ?? 50 + guidance.relativeX * 54, 6, 94);
    const interceptY = clamp(projected?.intercept.y ?? 40 + guidance.relativeY * 38, 8, 78);

    this.spaceScene?.style.setProperty("--contact-x", `${markerX.toFixed(2)}%`);
    this.spaceScene?.style.setProperty("--contact-y", `${markerY.toFixed(2)}%`);
    this.spaceScene?.style.setProperty("--contact-opacity", contactStrength.toFixed(3));
    this.spaceScene?.style.setProperty("--intercept-x", `${interceptX.toFixed(2)}%`);
    this.spaceScene?.style.setProperty("--intercept-y", `${interceptY.toFixed(2)}%`);

    if (this.contactMarker) {
      this.contactMarker.hidden = this.mode === "cruise";
    }
    if (this.interceptMarker) this.interceptMarker.hidden = true;
    if (this.contactBearingLabel) {
      this.contactBearingLabel.textContent = this.isBoardingActive ? (this.assault.breach > 0 ? "BREACH POINT" : "FORWARD BULKHEAD") : this.mode === "signal" ? "FAINT CONTACT" : "UNKNOWN VESSEL";
    }

    if (this.radar) {
      this.radar.style.setProperty("--radar-x", `${clamp(50 + actualRelativeX * 64, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-y", `${clamp(46 + actualRelativeY * 58, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-opacity", clamp(this.searchProgress * 1.7, 0, 1).toFixed(3));
    }

  }

  render(allowMotion) {
    const steering = this.pointer;

    const age = this.assault.impactAge;
    const impact = allowMotion && age >= 0 ? Math.exp(-age * 4.5) : 0;
    const cockpitVibration = allowMotion ? (Math.sin(this.sceneTime * 19) * 0.16 + Math.sin(age * 67) * impact * 7) : 0;
    this.spaceScene?.style.setProperty("--impact-flash", (allowMotion && age >= 0 ? Math.exp(-age * 11) * 0.28 : 0).toFixed(3));

    if (this.spaceScene) {
      this.spaceScene.style.setProperty("--cockpit-vibration", `${cockpitVibration.toFixed(2)}px`);
    }
    if (this.steeringKnob) {
      this.steeringKnob.style.setProperty("--knob-x", `${(steering.x * 22).toFixed(1)}px`);
      this.steeringKnob.style.setProperty("--knob-y", `${(steering.y * 22).toFixed(1)}px`);
    }

    this.updateContactVisuals();
  }

  renderStill() {
    this.visuals.resize();
    this.render(false);
    this.updateHud(true);
  }

  onFrame(timestamp) {
    this.frameId = 0;
    if (this.destroyed || this.manuallyPaused || document.hidden || !this.visuals.available) return;

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
    this.audio.stop();
    this.stopLoop();
  }

  resume() {
    this.manuallyPaused = false;
    this.visuals.resize();
    this.renderStill();
    this.startLoop();
  }

  forceContact() {
    if (this.destroyed || this.spaceScene?.hidden) return;

    this.searchProgress = 1;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.spaceScene?.classList.remove("is-scanning");
    this.resetBoardingState();
    this.beginIntercept();
    this.updateHud(true);
    this.renderStill();
  }

  forceEncounter(options = {}) {
    if (options?.stage === "contact" || options?.stage === "intercept") {
      this.forceContact();
      return;
    }
    if (this.destroyed || this.spaceScene?.hidden) return;

    this.searchProgress = 1;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.spaceScene?.classList.remove("is-scanning");
    this.resetBoardingState();
    this.beginIntercept();
    this.assault.forceReady(this.getActualBearing());
    this.pointer.x = this.pointerTarget.x = this.assault.attackBearing.x / 0.68;
    this.pointer.y = this.pointerTarget.y = this.assault.attackBearing.y / 0.48;
    this.setVoyageMode("ready", ASSAULT_COPY.ready[1]);
    this.updateHud(true);
    this.renderStill();
  }

  getState() {
    const tracking = this.getTrackingMetrics();
    return {
      rendering: this.visuals.getState(),
      mode: this.mode,
      boardingStage: this.isBoardingActive ? this.mode : null,
      searchProgress: this.searchProgress,
      encounterReady: this.encounterReady,
      journeyDistance: this.journeyDistance,
      distanceMeters: this.isBoardingActive ? this.assault.distance : null,
      relativeSpeed: this.assault.speed,
      alignment: tracking.quality,
      steeringLocked: this.assault.committed,
      ramProgress: this.assault.ram,
      chargeProgress: this.assault.charge,
      breachProgress: this.assault.breach,
      clampProgress: this.assault.clamps,
      bridgeProgress: this.assault.seal,
      pressureProgress: this.assault.pressure,
      impactAge: this.assault.impactAge,
      guidanceBearing: { ...tracking.guidance },
      steering: { ...this.pointer },
      course: { ...this.course },
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
    this.visuals.dispose();
    this.audio.destroy();
    this.spaceScene?.classList.remove("is-scanning");
    this.keys.clear();

  }
}
