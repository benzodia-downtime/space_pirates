import { VoyageRenderer } from "./voyage-renderer.js?v=3d-1";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const VOYAGE_CONFIG = Object.freeze({
  cruiseSpeed: 0.058,
  searchBaseRate: 0.026,
  searchAlignedRate: 0.044,
  scanBoost: 0.13,
  scanCooldownSeconds: 4,
  signalProgress: 0.27,
  approachProgress: 0.64,
  interceptStartDistance: 1200,
  syncStartDistance: 220,
  harpoonRange: 72,
  dockingDistance: 12,
  safeRelativeSpeed: 4,
  safeRotationError: 1.5,
  safeAimError: 0.12,
  syncHoldSeconds: 0.8,
  harpoonReloadSeconds: 0.9,
  cableBreakTension: 98,
  cableBreakSeconds: 1.25,
  bridgeDeploySeconds: 3.2,
  pressurizeSeconds: 4,
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
    this.rotationErrorLabel = document.getElementById("rotation-error");
    this.cableTensionLabel = document.getElementById("cable-tension");
    this.boardingProgressBar = document.getElementById("boarding-progress-bar");
    this.harpoonPortState = document.getElementById("harpoon-port-state");
    this.harpoonStarboardState = document.getElementById("harpoon-starboard-state");
    this.boardingSealState = document.getElementById("boarding-seal-state");
    this.boardingAction = document.getElementById("boarding-action");
    this.boardingActionStatus = document.getElementById("boarding-action-status");
    this.boardingActionLabel = document.getElementById("boarding-action-label");
    this.steeringPad = document.getElementById("steering-pad");
    this.steeringKnob = document.getElementById("steering-knob");
    this.scanButton = document.getElementById("scan-button");
    this.scanButtonState = document.getElementById("scan-button-state");
    this.visuals = new VoyageRenderer(canvas);
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
    this.boardingDistance = VOYAGE_CONFIG.interceptStartDistance;
    this.relativeSpeed = 85;
    this.rotationError = 5.5;
    this.syncHold = 0;
    this.harpoonCount = 0;
    this.cableTension = 0;
    this.cableStress = 0;
    this.actionCooldown = 0;
    this.bridgeProgress = 0;
    this.pressureProgress = 0;
    this.stageElapsed = 0;
    this.lastDockStep = "";
    this.tensionWarningActive = false;
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

  get isBoardingActive() {
    return [
      "intercept",
      "sync",
      "harpoon-port",
      "harpoon-starboard",
      "winch",
      "bridge-ready",
      "bridge",
      "pressurize",
      "ready",
    ].includes(this.mode);
  }

  addListeners() {
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
    if (this.manuallyPaused || this.destroyed) return;
    if (this.activePointerId !== null && this.activePointerId !== event.pointerId) return;
    this.activePointerId = event.pointerId;
    this.steeringPad?.setPointerCapture?.(event.pointerId);
    this.updateTargetFromPad(event.clientX, event.clientY);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (this.manuallyPaused || this.destroyed) return;
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
      this.keys.add(key);
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
    this.boardingDistance = VOYAGE_CONFIG.interceptStartDistance;
    this.relativeSpeed = 85;
    this.rotationError = 5.5;
    this.syncHold = 0;
    this.harpoonCount = 0;
    this.cableTension = 0;
    this.cableStress = 0;
    this.actionCooldown = 0;
    this.bridgeProgress = 0;
    this.pressureProgress = 0;
    this.stageElapsed = 0;
    this.lastDockStep = "";
    this.tensionWarningActive = false;

    if (this.boardingPanel) this.boardingPanel.hidden = true;
    if (this.interceptMarker) this.interceptMarker.hidden = true;
    if (this.boardingAction) {
      this.boardingAction.hidden = true;
      this.boardingAction.disabled = true;
    }
    this.spaceScene?.style.setProperty("--bridge-progress", "0");
    this.spaceScene?.style.setProperty("--tether-alert", "0");
    this.spaceScene?.removeAttribute("data-boarding-state");
    this.updateHarpoonState(this.harpoonPortState, false, "PORT · STANDBY");
    this.updateHarpoonState(this.harpoonStarboardState, false, "STARBOARD · STANDBY");
    this.updateHarpoonState(this.boardingSealState, false, "BRIDGE · STOWED");
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
    if (this.battleButtonStatus) this.battleButtonStatus.textContent = "적함 에어록 개방";
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
    if (modeChanged) this.stageElapsed = 0;
    this.spaceScene?.setAttribute("data-voyage-state", nextMode);
    if (this.isBoardingActive) {
      this.spaceScene?.setAttribute("data-boarding-state", nextMode);
    }
    if (announcement && this.announcement) this.announcement.textContent = announcement;
    this.updateBoardingControls();
  }

  beginIntercept() {
    this.boardingDistance = VOYAGE_CONFIG.interceptStartDistance;
    this.relativeSpeed = 85;
    this.rotationError = 5.5;
    this.syncHold = 0;
    this.harpoonCount = 0;
    this.cableTension = 0;
    this.cableStress = 0;
    this.bridgeProgress = 0;
    this.pressureProgress = 0;

    if (this.boardingPanel) this.boardingPanel.hidden = false;
    if (this.boardingAction) this.boardingAction.hidden = false;
    if (this.battleButton) {
      this.battleButton.hidden = true;
      this.battleButton.disabled = true;
    }
    if (this.scanButton) this.scanButton.disabled = true;
    this.scanButton?.setAttribute("aria-label", "요격 추적 장치 작동 중");
    if (this.scanButtonState) this.scanButtonState.textContent = "TRACK";
    this.setVoyageMode("intercept", "적함을 식별했습니다. 예상 항로를 조준해 요격하십시오.");
    this.updateHud(true);
  }

  getActualBearing() {
    if (!this.isBoardingActive || this.mode === "ready") return { ...this.contactBearing };
    const restraint = clamp(this.harpoonCount * 0.38 + this.bridgeProgress * 0.3, 0, 0.92);
    const amplitudeX = 0.044 * (1 - restraint);
    const amplitudeY = 0.025 * (1 - restraint);
    return {
      x: this.contactBearing.x + Math.sin(this.sceneTime * 0.74 + 0.8) * amplitudeX,
      y: this.contactBearing.y + Math.sin(this.sceneTime * 0.53 + 2.1) * amplitudeY,
    };
  }

  getGuidanceBearing() {
    const actual = this.getActualBearing();
    if (this.mode !== "intercept") return actual;
    const leadDirection = this.contactBearing.x >= 0 ? 1 : -1;
    return {
      x: actual.x + leadDirection * 0.105,
      y: actual.y - 0.045,
    };
  }

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

  get hasHarpoonWindow() {
    const { error } = this.getTrackingMetrics();
    return (
      this.boardingDistance <= VOYAGE_CONFIG.harpoonRange &&
      this.relativeSpeed <= VOYAGE_CONFIG.safeRelativeSpeed &&
      this.rotationError <= VOYAGE_CONFIG.safeRotationError &&
      error <= VOYAGE_CONFIG.safeAimError
    );
  }

  updateHarpoonState(element, active, text) {
    if (!element) return;
    element.dataset.state = active ? "locked" : "standby";
    element.textContent = text;
  }

  handleBoardingAction() {
    if (
      this.destroyed ||
      this.manuallyPaused ||
      this.spaceScene?.hidden ||
      !this.boardingAction ||
      this.boardingAction.hidden ||
      this.boardingAction.disabled
    ) {
      return;
    }

    if (this.mode === "harpoon-port") {
      this.harpoonCount = 1;
      this.actionCooldown = VOYAGE_CONFIG.harpoonReloadSeconds;
      this.rotationError = Math.max(this.rotationError, 1.8);
      this.setVoyageMode("harpoon-starboard", "좌현 자기 작살이 고정되었습니다. 우현 앵커를 정렬하십시오.");
    } else if (this.mode === "harpoon-starboard") {
      this.harpoonCount = 2;
      this.cableStress = 0;
      this.setVoyageMode("winch", "양쪽 자기 작살 고정. 자동 윈치 견인을 시작합니다.");
    } else if (this.mode === "bridge-ready") {
      this.bridgeProgress = 0;
      this.pressureProgress = 0;
      this.lastDockStep = "";
      this.setVoyageMode("bridge", "도킹 칼라 정렬 완료. 장갑 승선교를 전개합니다.");
    }

    this.updateHud(true);
  }

  breakHarpoons(message) {
    this.harpoonCount = 0;
    this.cableTension = 0;
    this.cableStress = 0;
    this.syncHold = 0;
    this.tensionWarningActive = false;
    this.boardingDistance = Math.min(140, this.boardingDistance + 38);
    this.relativeSpeed = Math.max(12, this.relativeSpeed + 8);
    this.rotationError = Math.max(3.8, this.rotationError + 1.8);
    this.setVoyageMode("sync", message);
  }

  getBoardingProgress() {
    if (this.mode === "intercept") {
      return clamp(
        (VOYAGE_CONFIG.interceptStartDistance - this.boardingDistance) /
          (VOYAGE_CONFIG.interceptStartDistance - VOYAGE_CONFIG.syncStartDistance) * 0.22,
        0,
        0.22,
      );
    }
    if (this.mode === "sync") return 0.22 + clamp(this.syncHold / VOYAGE_CONFIG.syncHoldSeconds, 0, 1) * 0.18;
    if (this.mode === "harpoon-port") return 0.4;
    if (this.mode === "harpoon-starboard") return 0.52;
    if (this.mode === "winch") {
      return 0.58 + clamp(
        (VOYAGE_CONFIG.harpoonRange - this.boardingDistance) /
          (VOYAGE_CONFIG.harpoonRange - VOYAGE_CONFIG.dockingDistance),
        0,
        1,
      ) * 0.2;
    }
    if (this.mode === "bridge-ready") return 0.8;
    if (this.mode === "bridge") return 0.8 + this.bridgeProgress * 0.1;
    if (this.mode === "pressurize") return 0.9 + this.pressureProgress * 0.1;
    if (this.mode === "ready") return 1;
    return this.searchProgress;
  }

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

    const harpoonWindow = this.hasHarpoonWindow;
    if (this.battleButton) {
      this.battleButton.hidden = !this.encounterReady;
      this.battleButton.disabled = !this.encounterReady;
    }
    if (this.boardingAction) this.boardingAction.hidden = this.encounterReady;

    let status = "요격 해법 계산 중";
    let label = "항로 추적";
    let disabled = true;
    let systemState = "TRACK";

    if (this.mode === "intercept") {
      status = "예상 항로 마커를 중앙에 유지";
      label = "요격 중";
    } else if (this.mode === "sync") {
      status = this.syncHold > 0
        ? `안정 해법 유지 ${Math.round(this.syncHold / VOYAGE_CONFIG.syncHoldSeconds * 100)}%`
        : "상대 속도와 회전 억제 중";
      label = "속도 동기화";
      systemState = "SYNC";
    } else if (this.mode === "harpoon-port") {
      status = harpoonWindow ? "좌현 앵커 발사 해법 확보" : "발사 조건을 맞추십시오";
      label = "자기 작살 1 발사";
      disabled = !harpoonWindow;
      systemState = "ARM 1";
    } else if (this.mode === "harpoon-starboard") {
      status = this.actionCooldown > 0
        ? `우현 작살 재장전 ${Math.ceil(this.actionCooldown)}초`
        : harpoonWindow
          ? "우현 앵커 발사 해법 확보"
          : "첫 케이블 장력을 안정시키십시오";
      label = "자기 작살 2 발사";
      disabled = this.actionCooldown > 0 || !harpoonWindow;
      systemState = "ARM 2";
    } else if (this.mode === "winch") {
      status = this.cableTension >= 85 ? "장력 위험 · 조준을 보정하십시오" : "양측 윈치 자동 견인";
      label = "견인 중";
      systemState = "TETHER";
    } else if (this.mode === "bridge-ready") {
      status = "도킹 칼라 정렬 완료";
      label = "승선교 전개";
      disabled = false;
      systemState = "DOCK";
    } else if (this.mode === "bridge") {
      status = this.bridgeProgress < 0.42 ? "장갑 통로 전개 중" : "도킹 칼라 결합 중";
      label = `${Math.round(this.bridgeProgress * 100)}%`;
      systemState = "BRIDGE";
    } else if (this.mode === "pressurize") {
      status = this.pressureProgress < 0.78 ? "기밀 확인 · 압력 동기화" : "적함 외부 해치 개방 중";
      label = `${Math.round(this.pressureProgress * 100)}%`;
      systemState = "SEAL";
    } else if (this.mode === "ready") {
      status = "승선교 기밀 확보 · 적함 에어록 개방";
      label = "적함 돌입";
      systemState = "BREACH";
    }

    if (this.boardingActionStatus) this.boardingActionStatus.textContent = status;
    if (this.boardingActionLabel) this.boardingActionLabel.textContent = label;
    if (this.boardingAction) {
      this.boardingAction.disabled = disabled;
      this.boardingAction.setAttribute("aria-label", `${status}. ${label}`);
    }
    if (this.scanButtonState) this.scanButtonState.textContent = systemState;
    this.scanButton?.setAttribute("aria-label", `${systemState}. ${status}`);
  }

  announceDockStep(step, message) {
    if (this.lastDockStep === step) return;
    this.lastDockStep = step;
    if (this.announcement) this.announcement.textContent = message;
  }

  updateBoarding(deltaSeconds) {
    this.stageElapsed += deltaSeconds;
    this.actionCooldown = Math.max(0, this.actionCooldown - deltaSeconds);
    const tracking = this.getTrackingMetrics();
    const quality = tracking.quality;

    if (this.mode === "intercept") {
      const closingSpeed = -5 + quality * 120;
      this.boardingDistance = clamp(
        this.boardingDistance - closingSpeed * deltaSeconds,
        VOYAGE_CONFIG.syncStartDistance,
        VOYAGE_CONFIG.interceptStartDistance + 160,
      );
      this.relativeSpeed += ((85 - quality * 22) - this.relativeSpeed) * (1 - Math.exp(-deltaSeconds * 0.8));
      this.rotationError += ((5.5 - quality * 0.8) - this.rotationError) * (1 - Math.exp(-deltaSeconds * 0.7));
      if (this.boardingDistance <= VOYAGE_CONFIG.syncStartDistance + 0.01) {
        this.relativeSpeed = 62;
        this.rotationError = 5.5;
        this.setVoyageMode("sync", "요격 항로에 진입했습니다. 적함을 중앙에 두고 상대 운동을 동기화하십시오.");
      }
      return;
    }

    if (["sync", "harpoon-port", "harpoon-starboard"].includes(this.mode)) {
      const speedTarget = 0.65 + Math.pow(1 - quality, 2) * 32;
      const rotationTarget = 0.35 + Math.pow(1 - quality, 2) * 8;
      const speedEase = 1 - Math.exp(-deltaSeconds * 0.95);
      const rotationEase = 1 - Math.exp(-deltaSeconds * 1.15);
      this.relativeSpeed += (speedTarget - this.relativeSpeed) * speedEase;
      this.rotationError += (rotationTarget - this.rotationError) * rotationEase;
      if (this.boardingDistance > VOYAGE_CONFIG.harpoonRange - 2) {
        this.boardingDistance = Math.max(
          VOYAGE_CONFIG.harpoonRange - 2,
          this.boardingDistance - (5 + quality * 22) * deltaSeconds,
        );
      }

      const stable = this.hasHarpoonWindow;
      if (this.mode === "sync") {
        this.syncHold = stable
          ? Math.min(VOYAGE_CONFIG.syncHoldSeconds, this.syncHold + deltaSeconds)
          : Math.max(0, this.syncHold - deltaSeconds * 0.8);
        if (this.syncHold >= VOYAGE_CONFIG.syncHoldSeconds) {
          this.setVoyageMode("harpoon-port", "발사 해법이 안정되었습니다. 좌현 자기 작살을 발사할 수 있습니다.");
        }
      }

      if (this.harpoonCount === 1) {
        this.cableTension = clamp(
          27 + (1 - quality) * 74 + this.relativeSpeed * 2.3 + this.rotationError * 2.8,
          0,
          100,
        );
        if (this.cableTension >= VOYAGE_CONFIG.cableBreakTension) {
          this.cableStress += deltaSeconds;
        } else {
          this.cableStress = Math.max(0, this.cableStress - deltaSeconds * 1.6);
        }
        if (this.cableStress >= VOYAGE_CONFIG.cableBreakSeconds) {
          this.breakHarpoons("케이블 장력 한계를 초과해 좌현 작살이 이탈했습니다. 다시 동기화하십시오.");
          return;
        }
      } else {
        this.cableTension = 0;
      }
      return;
    }

    if (this.mode === "winch") {
      this.relativeSpeed += (0.55 - this.relativeSpeed) * (1 - Math.exp(-deltaSeconds * 1.5));
      this.rotationError += (0.28 - this.rotationError) * (1 - Math.exp(-deltaSeconds * 1.7));
      this.cableTension = clamp(
        34 + (1 - quality) * 76 + this.relativeSpeed * 2.6 + this.rotationError * 3.4,
        0,
        100,
      );

      let winchRate = 0;
      if (this.cableTension < 70) winchRate = 5 + quality * 8;
      else if (this.cableTension < 85) winchRate = 2.2;
      else if (this.cableTension >= 95) winchRate = -1.2;
      this.boardingDistance = clamp(
        this.boardingDistance - winchRate * deltaSeconds,
        VOYAGE_CONFIG.dockingDistance,
        VOYAGE_CONFIG.harpoonRange + 18,
      );

      if (this.cableTension >= VOYAGE_CONFIG.cableBreakTension) {
        this.cableStress += deltaSeconds;
      } else {
        this.cableStress = Math.max(0, this.cableStress - deltaSeconds * 1.4);
      }
      if (this.cableStress >= VOYAGE_CONFIG.cableBreakSeconds) {
        this.breakHarpoons("윈치 견인 중 케이블이 파단되었습니다. 적함과 다시 속도를 맞추십시오.");
        return;
      }

      if (this.cableTension >= 90 && !this.tensionWarningActive) {
        this.tensionWarningActive = true;
        if (this.announcement) this.announcement.textContent = "케이블 장력 위험. 적함을 조준선 중앙에 맞추십시오.";
      } else if (this.cableTension < 74) {
        this.tensionWarningActive = false;
      }

      if (this.boardingDistance <= VOYAGE_CONFIG.dockingDistance + 0.01 && this.relativeSpeed <= 1.4) {
        this.boardingDistance = VOYAGE_CONFIG.dockingDistance;
        this.cableTension = 42;
        this.setVoyageMode("bridge-ready", "안전 도킹 거리를 확보했습니다. 장갑 승선교를 전개할 수 있습니다.");
      }
      return;
    }

    if (this.mode === "bridge-ready") {
      this.relativeSpeed = Math.max(0.4, this.relativeSpeed - deltaSeconds);
      this.rotationError = Math.max(0.2, this.rotationError - deltaSeconds);
      this.cableTension += (38 - this.cableTension) * (1 - Math.exp(-deltaSeconds * 1.2));
      return;
    }

    if (this.mode === "bridge") {
      const duration = this.reducedMotion ? 0.65 : VOYAGE_CONFIG.bridgeDeploySeconds;
      this.bridgeProgress = clamp(this.bridgeProgress + deltaSeconds / duration, 0, 1);
      if (this.bridgeProgress < 0.42) {
        this.announceDockStep("extend", "장갑 승선교를 전개하고 있습니다.");
      } else if (this.bridgeProgress < 0.78) {
        this.announceDockStep("collar", "자기 도킹 칼라가 적함 에어록에 결합 중입니다.");
      } else {
        this.announceDockStep("seal", "도킹 칼라 결합 완료. 기밀을 확인합니다.");
      }
      if (this.bridgeProgress >= 1) {
        this.pressureProgress = 0;
        this.lastDockStep = "";
        this.setVoyageMode("pressurize", "승선교 기밀 확보. 양쪽 함선의 압력을 동기화합니다.");
      }
      return;
    }

    if (this.mode === "pressurize") {
      const duration = this.reducedMotion ? 0.8 : VOYAGE_CONFIG.pressurizeSeconds;
      this.pressureProgress = clamp(this.pressureProgress + deltaSeconds / duration, 0, 1);
      if (this.pressureProgress < 0.78) {
        this.announceDockStep("pressure", "승선교 압력을 적함과 동기화하고 있습니다.");
      } else {
        this.announceDockStep("hatch", "압력 동기화 완료. 적함 외부 해치를 개방합니다.");
      }
      if (this.pressureProgress >= 1) {
        this.setVoyageMode("ready", "적함 에어록이 열렸습니다. 승무원이 돌입할 수 있습니다.");

      }
    }
  }

  update(deltaSeconds) {
    this.sceneTime += deltaSeconds;
    this.journeyDistance += deltaSeconds * VOYAGE_CONFIG.cruiseSpeed * 820;
    this.cruiseElapsed += deltaSeconds;
    this.hudAccumulator += deltaSeconds;

    if (this.sceneTime >= this.nextCourseAt) this.chooseNewCourse();

    const keyboardTarget = this.getKeyboardTarget();
    if (keyboardTarget) {
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

    const targetStarSpeed = this.isSearching
      ? 1
      : this.mode === "intercept"
        ? 0.72
        : this.mode === "sync" || this.mode.startsWith("harpoon")
          ? 0.46
          : this.mode === "winch"
            ? 0.24
            : 0.08;
    const starSpeedEase = 1 - Math.exp(-deltaSeconds * 1.8);
    this.starSpeedFactor += (targetStarSpeed - this.starSpeedFactor) * starSpeedEase;
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
    } else if (this.mode === "intercept") {
      if (this.stateLabel) this.stateLabel.textContent = "적함 요격 중";
      if (this.distanceLabel) this.distanceLabel.textContent = `${Math.round(this.boardingDistance)} m · 예상 항로 추적`;
    } else if (this.mode === "sync") {
      if (this.stateLabel) this.stateLabel.textContent = "상대 운동 동기화";
      if (this.distanceLabel) this.distanceLabel.textContent = `${Math.round(this.boardingDistance)} m · 발사 해법 계산`;
    } else if (this.mode === "harpoon-port") {
      if (this.stateLabel) this.stateLabel.textContent = "좌현 자기 작살 준비";
      if (this.distanceLabel) this.distanceLabel.textContent = `${Math.round(this.boardingDistance)} m · 앵커 1 대기`;
    } else if (this.mode === "harpoon-starboard") {
      if (this.stateLabel) this.stateLabel.textContent = "좌현 작살 고정";
      if (this.distanceLabel) this.distanceLabel.textContent = `${Math.round(this.boardingDistance)} m · 앵커 2 정렬`;
    } else if (this.mode === "winch") {
      if (this.stateLabel) this.stateLabel.textContent = "양측 윈치 견인";
      if (this.distanceLabel) this.distanceLabel.textContent = `${this.boardingDistance.toFixed(1)} m · 장력 ${Math.round(this.cableTension)}%`;
    } else if (this.mode === "bridge-ready") {
      if (this.stateLabel) this.stateLabel.textContent = "안전 도킹 거리 확보";
      if (this.distanceLabel) this.distanceLabel.textContent = `${this.boardingDistance.toFixed(1)} m · 승선교 준비`;
    } else if (this.mode === "bridge") {
      if (this.stateLabel) this.stateLabel.textContent = "장갑 승선교 전개";
      if (this.distanceLabel) this.distanceLabel.textContent = `도킹 칼라 · ${Math.round(this.bridgeProgress * 100)}%`;
    } else if (this.mode === "pressurize") {
      if (this.stateLabel) this.stateLabel.textContent = "승선교 압력 동기화";
      if (this.distanceLabel) this.distanceLabel.textContent = `기밀 유지 · ${Math.round(this.pressureProgress * 100)}%`;
    } else if (this.mode === "ready") {
      if (this.stateLabel) this.stateLabel.textContent = "적함 에어록 개방";
      if (this.distanceLabel) this.distanceLabel.textContent = "승선교 연결 완료 · 돌입 가능";
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
    if (this.scanButtonState && this.scanCooldown > 0 && this.isSearching) {
      this.scanButtonState.textContent = `${Math.ceil(this.scanCooldown)}s`;
    } else if (this.scanButtonState && this.isSearching) {
      this.scanButtonState.textContent = "SCAN";
    }

    if (this.isBoardingActive) {
      const distanceText = this.boardingDistance >= 1000
        ? `${(this.boardingDistance / 1000).toFixed(2)} km`
        : `${this.boardingDistance.toFixed(this.boardingDistance < 100 ? 1 : 0)} m`;
      if (this.boardingDistanceLabel) this.boardingDistanceLabel.textContent = distanceText;
      if (this.relativeSpeedLabel) this.relativeSpeedLabel.textContent = `${this.relativeSpeed.toFixed(1)} m/s`;
      if (this.rotationErrorLabel) this.rotationErrorLabel.textContent = `${this.rotationError.toFixed(1)}°/s`;
      if (this.cableTensionLabel) {
        this.cableTensionLabel.textContent = this.harpoonCount
          ? `${Math.round(this.cableTension)}% · ${this.cableTension >= 90 ? "위험" : this.cableTension >= 70 ? "경고" : "안전"}`
          : "—";
      }
      if (this.boardingProgressBar) this.boardingProgressBar.style.width = `${progressPercent}%`;

      const phaseCopy = {
        intercept: ["요격", "점선 요격 마커를 중앙 조준선에 맞추십시오."],
        sync: ["속도 동기화", "적함을 중앙에 두고 속도와 회전을 낮추십시오."],
        "harpoon-port": ["작살 1 준비", "안전 표시가 뜨면 좌현 자기 작살을 발사하십시오."],
        "harpoon-starboard": ["작살 2 준비", "첫 케이블의 장력을 유지하며 우현 작살을 정렬하십시오."],
        winch: ["견인", "적함을 중앙에 유지해 케이블 장력을 안전 범위로 지키십시오."],
        "bridge-ready": ["도킹 준비", "승선교를 전개해 적함 에어록과 결합하십시오."],
        bridge: ["승선교 전개", "장갑 통로와 자기 도킹 칼라를 연결하고 있습니다."],
        pressurize: ["압력 동기화", "기밀을 확인하고 적함 외부 해치를 개방합니다."],
        ready: ["돌입 준비", "에어록이 열렸습니다. 승무원을 적함으로 투입하십시오."],
      }[this.mode];
      if (phaseCopy) {
        if (this.boardingPhaseLabel) this.boardingPhaseLabel.textContent = phaseCopy[0];
        if (this.boardingObjective) this.boardingObjective.textContent = phaseCopy[1];
      }

      this.updateHarpoonState(
        this.harpoonPortState,
        this.harpoonCount >= 1,
        this.harpoonCount >= 1 ? "PORT · LOCKED" : this.mode === "harpoon-port" ? "PORT · ARMED" : "PORT · STANDBY",
      );
      this.updateHarpoonState(
        this.harpoonStarboardState,
        this.harpoonCount >= 2,
        this.harpoonCount >= 2 ? "STARBOARD · LOCKED" : this.mode === "harpoon-starboard" ? "STARBOARD · ARMED" : "STARBOARD · STANDBY",
      );
      const sealActive = ["bridge", "pressurize", "ready"].includes(this.mode);
      const sealText = this.mode === "ready"
        ? "BRIDGE · SEALED"
        : this.mode === "pressurize"
          ? `PRESSURE · ${Math.round(this.pressureProgress * 100)}%`
          : this.mode === "bridge"
            ? `BRIDGE · ${Math.round(this.bridgeProgress * 100)}%`
            : this.mode === "bridge-ready"
              ? "BRIDGE · READY"
              : "BRIDGE · STOWED";
      this.updateHarpoonState(this.boardingSealState, sealActive, sealText);
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
      distance: this.isBoardingActive ? this.boardingDistance : 1200 + (1 - enemyReveal) * 3800,
      reveal: enemyReveal, time: this.sceneTime, motion: !this.reducedMotion,
      travel: this.starTravel, rotationError: this.rotationError,
      anchors: this.harpoonCount, bridgeProgress: this.bridgeProgress,
      pressureProgress: this.pressureProgress,
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
    this.spaceScene?.style.setProperty("--bridge-progress", this.bridgeProgress.toFixed(3));
    this.spaceScene?.style.setProperty("--tether-alert", clamp((this.cableTension - 70) / 30, 0, 1).toFixed(3));

    if (this.contactMarker) {
      this.contactMarker.hidden = this.mode === "cruise";
    }
    if (this.interceptMarker) this.interceptMarker.hidden = this.mode !== "intercept";
    if (this.contactBearingLabel) {
      const contactLabels = {
        signal: "FAINT CONTACT",
        approach: "UNKNOWN VESSEL",
        intercept: "HOSTILE EVADING",
        sync: "MATCH VECTOR",
        "harpoon-port": "ANCHOR POINT 1",
        "harpoon-starboard": "ANCHOR POINT 2",
        winch: "TETHERED",
        "bridge-ready": "DOCKING RANGE",
        bridge: "COLLAR ALIGNMENT",
        pressurize: "SEAL CONFIRMED",
        ready: "AIRLOCK OPEN",
      };
      this.contactBearingLabel.textContent = contactLabels[this.mode] || "FAINT CONTACT";
    }

    if (this.radar) {
      this.radar.style.setProperty("--radar-x", `${clamp(50 + actualRelativeX * 64, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-y", `${clamp(46 + actualRelativeY * 58, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-opacity", clamp(this.searchProgress * 1.7, 0, 1).toFixed(3));
    }

  }

  render(allowMotion) {
    const steering = this.pointer;

    const cockpitVibration = allowMotion
      ? Math.sin(this.sceneTime * 19) * 0.22 + Math.sin(this.sceneTime * 31) * 0.12
      : 0;

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
    this.boardingDistance = VOYAGE_CONFIG.dockingDistance;
    this.relativeSpeed = 0.4;
    this.rotationError = 0.2;
    this.syncHold = VOYAGE_CONFIG.syncHoldSeconds;
    this.harpoonCount = 2;
    this.cableTension = 38;
    this.bridgeProgress = 1;
    this.pressureProgress = 1;
    this.setVoyageMode("ready", "승선 절차를 완료했습니다. 적함으로 돌입할 수 있습니다.");

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
      distanceMeters: this.isBoardingActive ? this.boardingDistance : null,
      relativeSpeed: this.isBoardingActive ? this.relativeSpeed : null,
      rotationError: this.isBoardingActive ? this.rotationError : null,
      alignment: tracking.quality,
      harpoonsAttached: this.harpoonCount,
      cableTension: this.cableTension,
      bridgeProgress: this.bridgeProgress,
      pressureProgress: this.pressureProgress,
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
    this.spaceScene?.classList.remove("is-scanning");
    this.keys.clear();

  }
}
