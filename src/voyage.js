import { VoyageRenderer } from "./voyage-renderer.js?v=settings-1";
import { AssaultSequence, ASSAULT_CONFIG, ASSAULT_COPY } from "./assault.js?v=settings-1";
import { AssaultAudio } from "./assault-audio.js?v=settings-1";

import { OrbitNavigation, HELM, FLIGHT, ORBIT, relativeHelm, lookAt } from "./navigation.js?v=settings-1";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const VOYAGE_CONFIG = Object.freeze({
  searchBaseRate: 0.026,
  searchAlignedRate: 0.044,
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
    this.radar = document.getElementById("voyage-radar");
    this.radarBlip = document.getElementById("radar-blip");
    this.boardingPanel = document.getElementById("boarding-panel");
    this.boardingPhaseLabel = document.getElementById("boarding-phase");
    this.boardingObjective = document.getElementById("boarding-objective");
    this.boardingDistanceLabel = document.getElementById("boarding-distance");
    this.boardingDistanceType = document.getElementById("boarding-distance-type");
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
    this.assault = new AssaultSequence();
    this.navigation = new OrbitNavigation();
    this.orbitControls = document.getElementById("orbit-controls");
    this.orbitButton = document.getElementById("orbit-button");
    this.orbitDirection = document.getElementById("orbit-direction");
    this.orbitReadout = document.getElementById("orbit-readout");
    this.onOrbit = () => this.toggleOrbit();
    this.onReverse = () => { if (!this.manuallyPaused) { this.navigation.reverse(); this.updateHud(true); } };
    this.thrustButtons = [...document.querySelectorAll("[data-thrust]")];
    this.thrustPointers = new Map();
    this.thrustKeyButton = 0;
    this.thrustState = document.getElementById("thrust-state");
    this.onThrustContext = event => event.preventDefault();
    this.onThrustDown = this.onThrustDown.bind(this);
    this.onThrustLost = event => this.endThrustPointer(event.pointerId);
    this.onBlur = () => { this.keys.clear(); this.releasePad(); this.clearThrust(); };
    this.padOrigin = null; this.padDrag = { x: 0, y: 0 };
    this.audio = new AssaultAudio();
    this.soundButton = document.getElementById("sound-button");
    this.assaultCue = document.getElementById("assault-cue");
    this.settingsButton = document.getElementById("settings-button");
    this.settingsDialog = document.getElementById("settings-dialog");
    this.settingsClose = document.getElementById("settings-close");
    this.resumeAfterSettings = false;
    this.onSettingsOpen = () => this.openSettings();
    this.onSettingsClose = () => this.settingsDialog?.close();
    this.onSettingsKeyDown = event => {
      if (event.key !== "Tab") return;
      const controls = [this.settingsClose, this.soundButton].filter(button => button && !button.disabled);
      if (!controls.length) return;
      event.preventDefault();
      const index = controls.indexOf(document.activeElement);
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    };
    this.onSettingsClosed = () => {
      this.settingsButton?.setAttribute("aria-expanded", "false");
      const resume = this.resumeAfterSettings;
      this.resumeAfterSettings = false;
      if (this.destroyed || this.spaceScene?.hidden) return;
      if (resume) this.resume();
      this.settingsButton?.focus({ preventScroll: true });
    };
    try { this.audio.enabled = localStorage.getItem("space-pirates:sfx") !== "off"; } catch { /* Storage is optional. */ }
    this.updateSoundSetting();
    this.onSoundToggle = () => {
      this.audio.toggle();
      this.updateSoundSetting();
      try { localStorage.setItem("space-pirates:sfx", this.audio.enabled ? "on" : "off"); } catch { /* Keep the in-memory setting. */ }
    };
    this.visuals = new VoyageRenderer(canvas);
    this.visuals.onLost = () => { this.audio.stop(); this.onBlur(); };
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
    this.starSpeedFactor = 0;
    this.journeyDistance = 0;
    this.searchProgress = 0;
    this.cruiseElapsed = 0;
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
    for (const button of this.thrustButtons) {
      button.addEventListener("pointerdown", this.onThrustDown);
      button.addEventListener("lostpointercapture", this.onThrustLost);
      button.addEventListener("contextmenu", this.onThrustContext);
    }
    this.orbitButton?.addEventListener("click", this.onOrbit);
    this.orbitDirection?.addEventListener("click", this.onReverse);
    window.addEventListener("blur", this.onBlur);
    this.soundButton?.addEventListener("click", this.onSoundToggle);
    this.settingsButton?.addEventListener("click", this.onSettingsOpen);
    this.settingsClose?.addEventListener("click", this.onSettingsClose);
    this.settingsDialog?.addEventListener("close", this.onSettingsClosed);
    this.settingsDialog?.addEventListener("keydown", this.onSettingsKeyDown);
    window.addEventListener("resize", this.onResize, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("pointerup", this.onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", this.onPointerEnd, { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.steeringPad?.addEventListener("pointerdown", this.onPointerDown);
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
    for (const button of this.thrustButtons) {
      button.removeEventListener("pointerdown", this.onThrustDown);
      button.removeEventListener("lostpointercapture", this.onThrustLost);
      button.removeEventListener("contextmenu", this.onThrustContext);
    }
    this.orbitButton?.removeEventListener("click", this.onOrbit);
    this.orbitDirection?.removeEventListener("click", this.onReverse);
    window.removeEventListener("blur", this.onBlur);
    this.soundButton?.removeEventListener("click", this.onSoundToggle);
    this.settingsButton?.removeEventListener("click", this.onSettingsOpen);
    this.settingsClose?.removeEventListener("click", this.onSettingsClose);
    this.settingsDialog?.removeEventListener("close", this.onSettingsClosed);
    this.settingsDialog?.removeEventListener("keydown", this.onSettingsKeyDown);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerEnd);
    window.removeEventListener("pointercancel", this.onPointerEnd);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.steeringPad?.removeEventListener("pointerdown", this.onPointerDown);
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
    this.pointerTarget = { ...this.pointer };
    this.padOrigin = { clientX: event.clientX, clientY: event.clientY, heading: { ...this.pointer } };
    this.padDrag = { x: 0, y: 0 };
    event.preventDefault();
  }

  onPointerMove(event) {
    if (this.manuallyPaused || this.destroyed || this.assault.committed) return;
    if (this.activePointerId !== event.pointerId) return;
    this.updateTargetFromPad(event.clientX, event.clientY);
  }

  updateTargetFromPad(clientX, clientY) {
    if (!this.padOrigin) return;
    const dx = clientX - this.padOrigin.clientX, dy = clientY - this.padOrigin.clientY;
    this.pointerTarget = relativeHelm(this.padOrigin.heading, dx, dy);
    this.pointer = { ...this.pointerTarget };
    this.padDrag = { x: clamp(dx / 35, -1, 1), y: clamp(dy / 35, -1, 1) };
  }

  releasePad() {
    if (this.activePointerId !== null && this.steeringPad?.hasPointerCapture?.(this.activePointerId)) this.steeringPad.releasePointerCapture(this.activePointerId);
    this.activePointerId = null; this.padOrigin = null; this.padDrag = { x: 0, y: 0 };
  }

  onPointerEnd(event) {
    this.endThrustPointer(event.pointerId);
    if (this.activePointerId === event.pointerId) this.releasePad();
  }

  onThrustDown(event) {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.navigation.anchor || !this.visuals.available) return;
    const button = event.currentTarget;
    this.thrustPointers.set(event.pointerId, { direction: Number(button.dataset.thrust), button });
    button.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    this.updateThrustUi();
  }

  endThrustPointer(pointerId) {
    const input = this.thrustPointers.get(pointerId);
    if (!input) return;
    this.thrustPointers.delete(pointerId);
    if (input.button.hasPointerCapture?.(pointerId)) input.button.releasePointerCapture(pointerId);
    this.updateThrustUi();
  }

  clearThrust() {
    this.thrustKeyButton = 0;
    for (const id of [...this.thrustPointers.keys()]) this.endThrustPointer(id);
    this.navigation.speed = 0;
    this.updateThrustUi();
  }

  getThrust() {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.navigation.anchor || !this.visuals.available) return 0;
    const inputs = [...this.thrustPointers.values()].map(input => input.direction);
    const forward = this.keys.has("w") || inputs.includes(1) || this.thrustKeyButton === 1;
    const reverse = this.keys.has("s") || inputs.includes(-1) || this.thrustKeyButton === -1;
    return Number(forward) - Number(reverse);
  }

  updateThrustUi() {
    const thrust = this.getThrust();
    const locked = Boolean(this.navigation.anchor);
    for (const button of this.thrustButtons) {
      button.disabled = locked;
      button.classList.toggle("is-held", thrust === Number(button.dataset.thrust));
    }
    if (this.thrustState) this.thrustState.textContent = locked ? "견인 고정" : this.navigation.safetyStop ? "충돌 방지 정지" : this.navigation.orbiting ? "자동 선회" : thrust > 0 ? "전진" : thrust < 0 ? "후진" : "정지";
  }

  getView() { return { yaw: this.pointer.x * HELM.yawScale, pitch: this.pointer.y * HELM.pitchScale }; }

  toggleOrbit() {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden) return;
    if (this.navigation.toggleOrbit()) {
      if (this.announcement) this.announcement.textContent = this.navigation.orbiting ? "자동 선회 시작. 거리를 유지하며 적함 주위를 돕니다. 다시 누르면 정지합니다." : "선회 정지. 현재 위치와 시선을 유지합니다.";
    } else if (this.navigation.active && this.navigation.orbitTooClose && !this.navigation.anchor) {
      if (this.announcement) this.announcement.textContent = this.orbitTooCloseMessage;
    }
    this.updateHud(true);
  }

  get orbitTooCloseMessage() {
    return `너무 가까워 선회 불가 · 후진해 중심 거리 ${ORBIT.minRadius}m 이상 확보`;
  }

  updateSoundSetting() {
    if (!this.soundButton) return;
    this.soundButton.textContent = this.audio.enabled ? "켜짐" : "꺼짐";
    this.soundButton.setAttribute("aria-pressed", String(this.audio.enabled));
  }

  openSettings() {
    if (this.destroyed || this.spaceScene?.hidden || !this.settingsDialog || this.settingsDialog.open) return;
    this.resumeAfterSettings = !this.manuallyPaused;
    this.pause(); // Release held controls and freeze navigation while the modal is open.
    this.settingsDialog.showModal();
    this.settingsButton?.setAttribute("aria-expanded", "true");
  }

  onKeyDown(event) {
    if (this.settingsDialog?.open) return; // Keep native dialog Tab, Space, Enter and Escape behavior.
    const tagName = event.target?.tagName;
    const isTextControl = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
    const isNativeButtonAction = tagName === "BUTTON" && (event.code === "Space" || event.key === "Enter");
    if (isTextControl) return;
    if (this.spaceScene?.hidden) return;
    if (isNativeButtonAction && event.target === this.settingsButton) return;
    if (this.manuallyPaused || this.destroyed) {
      if (event.code === "Space" || event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.target?.dataset?.thrust && (event.code === "Space" || event.key === "Enter")) {
      event.preventDefault();
      if (!this.navigation.anchor) this.thrustKeyButton = Number(event.target.dataset.thrust);
      return;
    }
    if (!event.repeat && event.code === "KeyO") { this.toggleOrbit(); event.preventDefault(); return; }
    if (!event.repeat && event.code === "KeyQ") { this.onReverse(); event.preventDefault(); return; }
    if ((event.code === "Space" || event.code === "KeyF") && this.isBoardingActive && !this.encounterReady) {
      event.preventDefault();
      if (!event.repeat && (event.code === "Space" || this.assault.stage === "survey")) this.handleBoardingAction();
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

    const key = /^Key[WASD]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      if (!this.assault.committed && (!event.repeat || this.keys.has(key))) this.keys.add(key);
      event.preventDefault();
    } else if (event.code === "Space") {
      if (this.encounterReady) {
        this.battleButton?.click();
      } else {
        this.handleBoardingAction();
      }
      event.preventDefault();
    }
  }

  onKeyUp(event) {
    const key = /^Key[WASD]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    this.keys.delete(key);
    if (event.code === "Space" || event.key === "Enter") this.thrustKeyButton = 0;
    this.updateThrustUi();
  }

  getKeyboardTarget() {
    const x = Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft"));
    const y = Number(this.keys.has("arrowdown")) - Number(this.keys.has("arrowup"));
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
      this.onBlur();
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
    this.keys.clear(); this.clearThrust();
    this.navigation.reset();
    this.releasePad();
    if (this.orbitControls) this.orbitControls.hidden = true;
    if (this.boardingPanel) this.boardingPanel.hidden = true;
    if (this.assaultCue) this.assaultCue.hidden = true;
    if (this.boardingAction) { this.boardingAction.hidden = true; this.boardingAction.disabled = true; }
    this.steeringPad?.setAttribute("aria-disabled", "false");
    this.spaceScene?.removeAttribute("data-boarding-state");
    this.spaceScene?.removeAttribute("data-helm-locked");
    this.spaceScene?.style.setProperty("--impact-flash", "0");
    this.audio.stop();
  }

  startNewSearch({ announce = true } = {}) {
    const position = { ...this.navigation.position };
    this.mode = "cruise";
    this.searchProgress = 0;
    this.cruiseElapsed = 0;
    this.resetBoardingState();
    this.contactBearing = {
      x: this.pointer.x * 0.68 + (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.24),
      y: clamp(this.pointer.y * 0.48 - 0.14 + Math.random() * 0.26, -0.5, 0.5),
    };

    if (this.battleButton) {
      this.battleButton.hidden = true;
      this.battleButton.disabled = true;
    }
    this.navigation.begin(this.contactBearing, { position, radius: FLIGHT.contactDistance, active: false });
    if (this.battleButtonStatus) this.battleButtonStatus.textContent = "후방 하강문 파열 · 진입 가능";
    this.spaceScene?.setAttribute("data-voyage-state", "cruise");
    this.updateHud(true);

    if (announce && this.announcement) {
      this.announcement.textContent = "정지 상태로 복귀했습니다. W / S 또는 전진·후진 버튼으로 이동하십시오.";
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

  beginIntercept({ force = false } = {}) {
    this.assault.begin();
    if (force) this.navigation.begin(this.contactBearing);
    else this.navigation.active = true;
    if (this.boardingPanel) this.boardingPanel.hidden = false;
    if (this.boardingAction) this.boardingAction.hidden = false;
    if (this.battleButton) { this.battleButton.hidden = true; this.battleButton.disabled = true; }
    this.setVoyageMode("survey", "적함에 접근했습니다. 자동 선회로 뒤쪽을 살펴보고 하강문을 찾으십시오.");
    this.updateHud(true);
  }

  getActualBearing() {
    if (!this.navigation.placed) return { ...this.contactBearing };
    const view = lookAt(this.navigation.position, this.navigation.target);
    return { x: view.yaw / 0.65, y: view.pitch / 0.65 };
  }

  getGuidanceBearing() { return this.getActualBearing(); }

  getTrackingMetrics() {
    const guidance = this.getGuidanceBearing();
    const angle = guidance.x * 0.65 - this.pointer.x * HELM.yawScale;
    const relativeX = Math.atan2(Math.sin(angle), Math.cos(angle)) / 0.65;
    const relativeY = guidance.y - this.pointer.y * 0.48;
    const error = Math.hypot(relativeX, relativeY);
    return { guidance, relativeX, relativeY, error, quality: clamp(1 - error / 0.58, 0, 1) };
  }

  handleBoardingAction() {
    if (this.destroyed || this.manuallyPaused || !this.visuals.available || this.spaceScene?.hidden) return;
    if (this.assault.stage === "survey") {
      const solution = this.navigation.attach(this.getView());
      if (!solution || !this.assault.fireHarpoon(solution)) return;
      this.audio.unlock();
      this.releasePad(); this.keys.clear(); this.clearThrust();
    } else {
      if (!this.assault.canCommit()) return;
      this.audio.unlock();
      if (!this.assault.commit()) return;
      this.keys.clear(); this.releasePad();
      const bearing = this.assault.attackBearing;
      const delta = bearing.yaw - this.getView().yaw;
      this.pointerTarget.x = this.pointer.x + Math.atan2(Math.sin(delta), Math.cos(delta)) / HELM.yawScale;
      this.pointerTarget.y = bearing.pitch / HELM.pitchScale;
    }
    this.setVoyageMode(this.assault.stage, ASSAULT_COPY[this.assault.stage][1]);
    this.updateHud(true);
  }

  getBoardingProgress() { return this.assault.progress; }

  updateBoardingControls() {
    if (!this.isBoardingActive) return;
    const nav = this.navigation, a = this.assault;
    const fire = a.stage === "survey" && nav.solution.canFire;
    const pull = a.canCommit();
    if (this.battleButton) { this.battleButton.hidden = !this.encounterReady; this.battleButton.disabled = !this.encounterReady; }
    if (this.boardingAction) {
      this.boardingAction.hidden = this.encounterReady;
      this.boardingAction.disabled = !(fire || pull);
    }
    const copy = ASSAULT_COPY[this.mode];
    let label = copy?.[0] || "", status = copy?.[1] || "";
    if (this.mode === "survey") {
      label = fire ? "작살 발사" : nav.discovered ? "하강문 조준" : "후방 하강문 찾기";
      status = fire ? "Space / F · 조준한 문에 작살 발사" : nav.orbitTooClose ? "후진해 거리를 확보한 뒤 후방 하강문을 찾으세요" : nav.discovered ? "선회를 멈추고 후방 문 중앙을 조준하세요" : "자동 선회 [O] · 뒤쪽의 하강문을 찾아보세요";
    }
    if (pull) { label = "견인 돌입"; status = "Space · 케이블을 감아 하강문으로 돌진"; }
    if (this.boardingActionLabel) this.boardingActionLabel.textContent = label;
    if (this.boardingActionStatus) this.boardingActionStatus.textContent = status;
    this.boardingAction?.setAttribute("aria-label", status + ". " + label);
    this.steeringPad?.setAttribute("aria-disabled", String(a.committed));
    this.spaceScene?.setAttribute("data-helm-locked", String(a.committed));
    if (this.orbitControls) this.orbitControls.hidden = this.encounterReady || a.committed;
    if (this.orbitButton) {
      this.orbitButton.disabled = !nav.orbiting && !nav.canOrbit;
      this.orbitButton.setAttribute("aria-pressed", String(nav.orbiting));
      this.orbitButton.textContent = nav.orbiting ? "선회 정지 [O]" : "자동 선회 [O]";
    }
    if (this.orbitDirection) { this.orbitDirection.disabled = !nav.canOrbit; this.orbitDirection.textContent = nav.direction > 0 ? "반대 방향 ↶ [Q]" : "반대 방향 ↷ [Q]"; }
    this.orbitControls?.setAttribute("data-blocked", String(nav.orbitTooClose && !nav.anchor));
    if (this.orbitReadout) this.orbitReadout.textContent = nav.anchor ? "작살 고정 · 돌입 명령 대기" : nav.orbitTooClose ? this.orbitTooCloseMessage : nav.discovered ? (nav.solution.visible ? "하강문 시야 확보 · 직접 조준" : "하강문이 선체 뒤에 가려짐") : (nav.orbiting ? Math.round(nav.radius) + " m 유지 · 후방 하강문 탐색" : "선회 대기 · 함선 뒤를 살펴보세요");
    if (this.assaultCue) {
      this.assaultCue.hidden = !a.committed;
      this.assaultCue.querySelector("span").textContent = copy?.[2] || "";
      this.assaultCue.querySelector("strong").textContent = copy?.[0] || "";
    }
  }

  updateBoarding(deltaSeconds) {
    if (!this.assault.committed) {
      const shift = this.navigation.update(deltaSeconds, this.getView());
      // Autopilot follows the target; manual look offset stays latched, including during a drag.
      for (const value of [this.pointer, this.pointerTarget, this.padOrigin?.heading].filter(Boolean)) {
        value.x += shift.yaw / HELM.yawScale;
        value.y += shift.pitch / HELM.pitchScale;
      }
      if (!this.navigation.anchor) this.assault.distance = this.navigation.solution.distance;
    }
    this.assault.update(deltaSeconds);
    if (this.assault.committed) this.navigation.pull(this.assault.distance);
    if (this.mode !== this.assault.stage) this.setVoyageMode(this.assault.stage, ASSAULT_COPY[this.assault.stage][1]);
  }

  update(deltaSeconds) {
    this.sceneTime += deltaSeconds;
    const previousPosition = { ...this.navigation.position };
    this.cruiseElapsed += deltaSeconds;
    this.hudAccumulator += deltaSeconds;

    if (this.sceneTime >= this.nextCourseAt) this.chooseNewCourse();

    const keyboardTarget = this.getKeyboardTarget();
    if (keyboardTarget && !this.assault.committed) {
      const nudgeRate = this.isBoardingActive ? 0.62 : 1.05;
      this.pointerTarget.x += keyboardTarget.x * nudgeRate * deltaSeconds;
      this.pointerTarget.y = clamp(
        this.pointerTarget.y + keyboardTarget.y * nudgeRate * deltaSeconds,
        -3.8,
        3.8,
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

    const thrust = this.getThrust();
    this.navigation.move(deltaSeconds, this.getView(), thrust);
    // Ordinary movement comes from the camera's actual position. Only the
    // explicitly triggered tether charge adds a cosmetic star streak effect.
    this.starSpeedFactor = this.mode === "charge" ? 1 + this.assault.charge * 8 : 0;
    if (!this.reducedMotion) this.starTravel += deltaSeconds * 305 * this.starSpeedFactor;

    if (this.isSearching) {
      const { relativeX, relativeY } = this.getTrackingMetrics();
      const alignment = clamp(1 - Math.hypot(relativeX, relativeY) / 0.9, 0, 1);
      const launchRamp = clamp(this.cruiseElapsed / 4, 0.35, 1);
      this.searchProgress = Math.min(
        1,
        this.searchProgress + (thrust ? deltaSeconds : 0) * launchRamp * (
          VOYAGE_CONFIG.searchBaseRate + alignment * VOYAGE_CONFIG.searchAlignedRate
        ),
      );
      if (this.navigation.radius <= FLIGHT.surveyDistance) this.searchProgress = 1;
      this.updateMode();
    } else if (this.isBoardingActive && !this.encounterReady) {
      this.updateBoarding(deltaSeconds);
    }

    const p = this.navigation.position;
    this.journeyDistance += Math.hypot(p.x - previousPosition.x, p.y - previousPosition.y, p.z - previousPosition.z);

    if (this.hudAccumulator >= 0.12) {
      this.hudAccumulator = 0;
      this.updateHud();
    }
  }

  updateMode() {
    const previousMode = this.mode;
    if (this.searchProgress >= 1 && this.navigation.radius <= FLIGHT.surveyDistance) {
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
      this.announcement.textContent = "미확인 함선을 식별했습니다. 조준한 뒤 전진해 접근하십시오.";
    }
  }

  updateHud(force = false) {
    const progressPercent = Math.round((this.isSearching ? this.searchProgress : this.getBoardingProgress()) * 100);
    const distanceKm = this.navigation.radius / 1000;
    const bearingDegrees = Math.round(this.getTrackingMetrics().relativeX * 0.65 * 180 / Math.PI);
    this.updateThrustUi();
    const bearingText = bearingDegrees === 0
      ? "정면"
      : bearingDegrees > 0
        ? `우현 ${bearingDegrees}°`
        : `좌현 ${Math.abs(bearingDegrees)}°`;

    if (this.mode === "cruise") {
      if (this.stateLabel) this.stateLabel.textContent = this.navigation.speed ? "수동 항해 중" : "정지 · 입력 대기";
      if (this.distanceLabel) this.distanceLabel.textContent = "확인된 신호 없음";
    } else if (this.mode === "signal") {
      if (this.stateLabel) this.stateLabel.textContent = "희미한 열원 감지";
      if (this.distanceLabel) this.distanceLabel.textContent = `미확인 신호 · ${bearingText}`;
    } else if (this.mode === "approach") {
      if (this.stateLabel) this.stateLabel.textContent = this.navigation.speed ? "미확인 함선 접근" : "미확인 함선 · 정지 중";
      if (this.distanceLabel) this.distanceLabel.textContent = `${distanceKm.toFixed(1)} km · ${bearingText}`;
    } else if (this.isBoardingActive) {
      if (this.stateLabel) this.stateLabel.textContent = ASSAULT_COPY[this.mode][0];
      if (this.distanceLabel) this.distanceLabel.textContent = this.assault.committed ? ASSAULT_COPY[this.mode][2] : Math.round(this.navigation.radius) + " m 선회 반경 · " + (this.navigation.discovered ? "후방 하강문 식별" : "진입점 미발견");
    }

    if (this.progressBar) this.progressBar.style.width = `${progressPercent}%`;
    if (this.speedLabel) {
      this.speedLabel.textContent = `${(this.assault.committed ? this.assault.speed : this.navigation.speed).toFixed(1)} m/s`;
    }
    if (this.coordinateLabel) {
      const x = Math.round(this.navigation.position.x).toString().padStart(3, "0");
      const y = Math.round(this.navigation.position.z).toString().padStart(3, "0");
      this.coordinateLabel.textContent = `X ${x} · Y ${y}`;
    }
    if (this.isBoardingActive) {
      const a = this.assault;
      if (this.boardingDistanceType) this.boardingDistanceType.textContent = a.breach > 0 ? "BREACH DEPTH" : this.mode === "survey" ? "CENTRE" : "GAP";
      if (this.boardingDistanceLabel) this.boardingDistanceLabel.textContent = a.breach > 0 ? (a.breach * (ASSAULT_CONFIG.contactDistance - ASSAULT_CONFIG.seatedDistance)).toFixed(1) + " m" : this.mode === "survey" ? this.navigation.radius.toFixed(1) + " m" : a.distance.toFixed(a.distance < 100 ? 1 : 0) + " m";
      if (this.relativeSpeedLabel) this.relativeSpeedLabel.textContent = (a.committed ? a.speed : this.navigation.speed).toFixed(1) + " m/s";
      if (this.alignmentLabel) this.alignmentLabel.textContent = a.committed ? "견인 고정" : this.navigation.anchor ? "작살 고정" : this.navigation.solution.canFire ? "작살 유효" : this.navigation.discovered ? "조준 필요" : "탐색 중";
      if (this.breachLabel) this.breachLabel.textContent = a.breach > 0 ? Math.round(a.breach * 100) + "%" : "대기";
      if (this.boardingProgressBar) this.boardingProgressBar.style.width = progressPercent + "%";
      if (this.boardingPhaseLabel) this.boardingPhaseLabel.textContent = ASSAULT_COPY[this.mode][0];
      if (this.boardingObjective) this.boardingObjective.textContent = this.mode === "survey" && this.navigation.discovered ? "후방 하강문 발견. 선회를 멈추고 문을 조준해 작살을 발사하십시오." : ASSAULT_COPY[this.mode][1];
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
    const guidance = this.getTrackingMetrics();
    const actualRelativeX = guidance.relativeX;
    const actualRelativeY = guidance.relativeY;
    const enemyReveal = this.isBoardingActive
      ? 1
      : clamp(
        (this.searchProgress - VOYAGE_CONFIG.approachProgress) /
          (1 - VOYAGE_CONFIG.approachProgress),
        0,
        1,
      );

    this.visuals.draw({
      bearing: actual, guidance: guidance.guidance, steering: this.pointer,
      distance: this.isBoardingActive ? this.assault.distance : this.navigation.radius,
      navigation: this.navigation,
      reveal: enemyReveal, time: this.sceneTime, motion: !this.reducedMotion,
      travel: this.starTravel, assault: this.assault,
    });
    if (this.radar) {
      this.radar.style.setProperty("--radar-x", `${clamp(50 + actualRelativeX * 64, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-y", `${clamp(46 + actualRelativeY * 58, 12, 88).toFixed(1)}%`);
      this.radar.style.setProperty("--radar-opacity", clamp(this.searchProgress * 1.7, 0, 1).toFixed(3));
    }

  }

  render(allowMotion) {
    const steering = this.padDrag;

    const age = this.assault.impactAge;
    const impact = allowMotion && age >= 0 ? Math.exp(-age * 4.5) : 0;
    const cockpitVibration = allowMotion ? (Math.sin(this.sceneTime * 19) * Math.min(1, Math.abs(this.navigation.speed) / 22) * 0.16 + Math.sin(age * 67) * impact * 7) : 0;
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
    this.onBlur();
    this.audio.stop();
    this.stopLoop();
  }

  resume() {
    if (this.destroyed || this.settingsDialog?.open) return;
    this.manuallyPaused = false;
    this.visuals.resize();
    this.renderStill();
    this.startLoop();
  }

  forceContact() {
    if (this.destroyed || this.spaceScene?.hidden) return;

    this.searchProgress = 1;
    this.resetBoardingState();
    this.beginIntercept({ force: true });
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
    this.resetBoardingState();
    this.beginIntercept({ force: true });
    const view = this.navigation.forceRear();
    this.assault.forceReady(view);
    this.navigation.pull(this.assault.distance);
    this.pointer.x = this.pointerTarget.x = view.yaw / HELM.yawScale;
    this.pointer.y = this.pointerTarget.y = view.pitch / HELM.pitchScale;
    this.setVoyageMode("ready", ASSAULT_COPY.ready[1]);
    this.updateHud(true);
    this.renderStill();
  }

  getState() {
    const tracking = this.getTrackingMetrics();
    return {
      rendering: this.visuals.getState(),
      navigation: this.navigation.getState(),
      harpoonProgress: this.assault.harpoon,
      mode: this.mode,
      boardingStage: this.isBoardingActive ? this.mode : null,
      searchProgress: this.searchProgress,
      settingsOpen: Boolean(this.settingsDialog?.open), sfxEnabled: this.audio.enabled,
      encounterReady: this.encounterReady,
      journeyDistance: this.journeyDistance,
      thrust: this.getThrust(), speed: this.assault.committed ? this.assault.speed : this.navigation.speed,
      starTravel: this.starTravel,
      distanceMeters: this.isBoardingActive ? this.assault.distance : null,
      relativeSpeed: this.assault.committed ? this.assault.speed : this.navigation.speed,
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
    this.steeringPad?.focus({ preventScroll: true });
  }

  destroy() {
    if (this.destroyed) return;
    this.onBlur();
    this.destroyed = true;
    this.stopLoop();
    this.removeListeners();
    this.resumeAfterSettings = false;
    this.settingsDialog?.close();
    this.settingsButton?.setAttribute("aria-expanded", "false");
    this.visuals.dispose();
    this.audio.destroy();
    this.keys.clear();

  }
}
