import { VoyageRenderer } from "./voyage-renderer.js?v=breachgun-1";
import { AssaultSequence, ASSAULT_COPY } from "./assault.js?v=breachgun-1";
import { AssaultAudio } from "./assault-audio.js?v=breachgun-1";
import { EnemyDefense } from "./enemy-defense.js?v=breachgun-1";
import { PlayerCannon } from "./player-cannon.js?v=breachgun-1";

import { OrbitNavigation, HELM, FLIGHT, ORBIT, relativeHelm, lookAt, pitchOffsetDegrees } from "./navigation.js?v=breachgun-1";

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
    this.announcement = document.getElementById("voyage-announcement");
    this.radar = document.getElementById("voyage-radar");
    this.radarBlip = document.getElementById("radar-blip");
    this.radarPitch = document.getElementById("radar-pitch");
    this.boardingAction = document.getElementById("boarding-action");
    this.boardingActionLabel = document.getElementById("boarding-action-label");
    this.steeringPad = document.getElementById("steering-pad");
    this.steeringKnob = document.getElementById("steering-knob");
    this.lookZone = document.getElementById("look-zone");
    this.trackButton = document.getElementById("track-button");
    this.dodgeButton = document.getElementById("dodge-button");
    this.cannonButton = document.getElementById("cannon-button");
    this.cannon = new PlayerCannon();
    this.cannonPointers = new Set(); this.cannonKeyButton = false; this.mouseGunHeld = false;
    this.onCannonDown = event => {
      if (!this.canShoot) return;
      this.audio.unlock(); this.cannonPointers.add(event.pointerId);
      this.fireCannon();
      this.cannonButton.setPointerCapture(event.pointerId); event.preventDefault(); this.updateHud();
    };
    this.onCannonLost = event => this.endCannonPointer(event.pointerId);
    this.onCannonClick = event => {
      if (event.detail === 0) this.fireCannon();
    };
    this.lookPointer = null;
    this.lookTracking = false;
    this.onLookDown = this.onLookDown.bind(this);
    this.onLookLost = event => { if (this.lookPointer?.id === event.pointerId) {this.mouseGunHeld=false;this.releaseLook();} };
    this.onPadLost = event => { if (this.activePointerId === event.pointerId) this.releasePad(); };
    this.onTrack = event => { if (!this.isTouchClick(event)) this.toggleTracking(); };
    this.onDodge = event => { if (!this.isTouchClick(event)) this.dodge(); };
    this.assault = new AssaultSequence();
    this.enemyDefense = new EnemyDefense();
    this.navigation = new OrbitNavigation();
    this.orbitControls = document.getElementById("orbit-controls");
    this.orbitButton = document.getElementById("orbit-button");
    this.orbitReadout = document.getElementById("orbit-readout");
    this.onOrbit = event => { if (!this.isTouchClick(event)) this.toggleOrbit(); };
    this.thrustButtons = [...document.querySelectorAll("[data-thrust]")];
    this.thrustPointers = new Map();
    this.thrustKeyButton = 0;
    this.onThrustContext = event => event.preventDefault();
    this.onThrustDown = this.onThrustDown.bind(this);
    this.onThrustLost = event => this.endThrustPointer(event.pointerId);
    this.onBlur = () => { this.keys.clear(); this.releasePad(); this.releaseLook(); this.clearThrust(); this.clearCannon(); this.navigation.cancelDodge(); };
    this.padOrigin = null; this.padDrag = { x: 0, y: 0 };
    this.audio = new AssaultAudio();
    this.soundButton = document.getElementById("sound-button");
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
    this.touchActions = new Map([[this.orbitButton, this.onOrbit], [this.trackButton, this.onTrack], [this.dodgeButton, this.onDodge], [this.boardingAction, this.onBoardingAction]]);
    this.touchActivated = new WeakMap();
    this.onTouchAction = event => {
      if (event.pointerType === "mouse" || event.currentTarget.disabled) return;
      // A second thumb is not the primary pointer; browsers need not synthesize a click.
      event.preventDefault();
      this.touchActivated.set(event.currentTarget, performance.now());
      this.touchActions.get(event.currentTarget)();
    };

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
  get helmLocked() { return this.assault.committed && !this.assault.canCorrect; }

  addListeners() {
    this.cannonButton?.addEventListener('pointerdown',this.onCannonDown);
    this.cannonButton?.addEventListener('lostpointercapture',this.onCannonLost);
    this.cannonButton?.addEventListener('click',this.onCannonClick);
    this.cannonButton?.addEventListener('contextmenu',this.onThrustContext);
    for (const button of this.touchActions.keys()) button?.addEventListener("pointerdown", this.onTouchAction);
    this.lookZone?.addEventListener("pointerdown", this.onLookDown);
    this.lookZone?.addEventListener("lostpointercapture", this.onLookLost);
    this.lookZone?.addEventListener("contextmenu", this.onThrustContext);
    this.steeringPad?.addEventListener("lostpointercapture", this.onPadLost);
    this.trackButton?.addEventListener("click", this.onTrack);
    this.dodgeButton?.addEventListener("click", this.onDodge);
    for (const button of this.thrustButtons) {
      button.addEventListener("pointerdown", this.onThrustDown);
      button.addEventListener("lostpointercapture", this.onThrustLost);
      button.addEventListener("contextmenu", this.onThrustContext);
    }
    this.orbitButton?.addEventListener("click", this.onOrbit);
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
    this.cannonButton?.removeEventListener('pointerdown',this.onCannonDown);
    this.cannonButton?.removeEventListener('lostpointercapture',this.onCannonLost);
    this.cannonButton?.removeEventListener('click',this.onCannonClick);
    this.cannonButton?.removeEventListener('contextmenu',this.onThrustContext);
    for (const button of this.touchActions.keys()) button?.removeEventListener("pointerdown", this.onTouchAction);
    this.lookZone?.removeEventListener("pointerdown", this.onLookDown);
    this.lookZone?.removeEventListener("lostpointercapture", this.onLookLost);
    this.lookZone?.removeEventListener("contextmenu", this.onThrustContext);
    this.steeringPad?.removeEventListener("lostpointercapture", this.onPadLost);
    this.trackButton?.removeEventListener("click", this.onTrack);
    this.dodgeButton?.removeEventListener("click", this.onDodge);
    for (const button of this.thrustButtons) {
      button.removeEventListener("pointerdown", this.onThrustDown);
      button.removeEventListener("lostpointercapture", this.onThrustLost);
      button.removeEventListener("contextmenu", this.onThrustContext);
    }
    this.orbitButton?.removeEventListener("click", this.onOrbit);
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
    if (this.manuallyPaused || this.destroyed || this.helmLocked || this.enemyDefense.defeated) return;
    this.audio.unlock();
    if (this.activePointerId !== null && this.activePointerId !== event.pointerId) return;
    this.activePointerId = event.pointerId;
    this.steeringPad?.focus({ preventScroll: true });
    this.steeringPad?.setPointerCapture?.(event.pointerId);
    this.padOrigin = { clientX: event.clientX, clientY: event.clientY };
    this.padDrag = { x: 0, y: 0 };
    event.preventDefault();
  }

  onPointerMove(event) {
    if(event.pointerType==='mouse' && this.lookPointer?.id===event.pointerId) {
      const held=Boolean(event.buttons&2) && this.canShoot;
      if(held && !this.mouseGunHeld)this.fireCannon();
      this.mouseGunHeld=held;
    }
    if (this.manuallyPaused || this.destroyed || this.helmLocked || this.enemyDefense.defeated) return;
    if (this.lookPointer?.id === event.pointerId && !this.navigation.anchor) {
      this.pointerTarget = relativeHelm(this.pointer, event.clientX - this.lookPointer.x, event.clientY - this.lookPointer.y);
      this.pointer = { ...this.pointerTarget };
      this.lookPointer.x = event.clientX; this.lookPointer.y = event.clientY;
      return;
    }
    if (this.activePointerId !== event.pointerId) return;
    this.updateTargetFromPad(event.clientX, event.clientY);
  }

  updateTargetFromPad(clientX, clientY) {
    if (!this.padOrigin) return;
    const dx = clientX - this.padOrigin.clientX, dy = clientY - this.padOrigin.clientY;
    this.padDrag = { x: clamp(dx / 35, -1, 1), y: clamp(dy / 35, -1, 1) };
  }

  onLookDown(event) {
    if (this.manuallyPaused || this.destroyed || this.navigation.anchor || this.enemyDefense.defeated || this.lookPointer || !this.visuals.available) return;
    this.audio.unlock();
    this.lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if(event.pointerType==='mouse' && (event.buttons&2) && this.canShoot) {this.mouseGunHeld=true;this.fireCannon();}
    this.steeringPad?.focus({ preventScroll: true });
    // Desktop moves/up are observed on window already. Capture can be dropped by
    // a right-button chord even while left remains held; only touch needs it.
    if(event.pointerType!=='mouse')this.lookZone.setPointerCapture(event.pointerId);
    this.pointerTarget = { ...this.pointer };
    event.preventDefault();
  }

  releaseLook() {
    const id = this.lookPointer?.id;
    this.lookPointer = null;
    if (id !== undefined && this.lookZone?.hasPointerCapture(id)) this.lookZone.releasePointerCapture(id);
  }

  releasePad() {
    const id = this.activePointerId;
    this.activePointerId = null; this.padOrigin = null; this.padDrag = { x: 0, y: 0 };
    if (id !== null && this.steeringPad?.hasPointerCapture?.(id)) this.steeringPad.releasePointerCapture(id);
  }

  onPointerEnd(event) {
    if(event.pointerType==='mouse')this.mouseGunHeld=false;
    this.endCannonPointer(event.pointerId);
    this.endThrustPointer(event.pointerId);
    if (this.activePointerId === event.pointerId) this.releasePad();
    if (this.lookPointer?.id === event.pointerId) this.releaseLook();
  }

  onThrustDown(event) {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.navigation.anchor || this.enemyDefense.defeated || !this.visuals.available) return;
    this.audio.unlock();
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
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.navigation.anchor || this.enemyDefense.defeated || !this.visuals.available) return 0;
    const inputs = [...this.thrustPointers.values()].map(input => input.direction);
    const forward = this.keys.has("w") || inputs.includes(1) || this.thrustKeyButton === 1;
    const reverse = this.keys.has("s") || inputs.includes(-1) || this.thrustKeyButton === -1;
    return Number(forward) - Number(reverse);
  }

  updateThrustUi() {
    const thrust = this.getThrust();
    const locked = Boolean(this.navigation.anchor) || this.enemyDefense.defeated;
    for (const button of this.thrustButtons) {
      button.disabled = locked;
      button.classList.toggle("is-held", thrust === Number(button.dataset.thrust));
    }
  }

  getView() { return { yaw: this.pointer.x * HELM.yawScale, pitch: this.pointer.y * HELM.pitchScale }; }

  get canShoot() {return !this.manuallyPaused && !this.destroyed && !this.spaceScene?.hidden && this.visuals.available && !this.enemyDefense.defeated && this.navigation.placed && !this.navigation.anchor && !this.navigation.harpoonTarget && !this.assault.committed;}
  get shooting() {return this.canShoot && (this.keys.has('r') || this.cannonPointers.size>0 || this.cannonKeyButton || this.mouseGunHeld);}
  fireCannon() {
    if(!this.canShoot || !this.cannon.fire(this.navigation,this.getView()))return false;
    this.audio.unlock();this.audio.play('player-fire');this.updateHud();return true;
  }
  endCannonPointer(id) {
    this.cannonPointers.delete(id);
    if(this.cannonButton?.hasPointerCapture(id))this.cannonButton.releasePointerCapture(id);
  }
  clearCannon() {
    this.cannonKeyButton=false;this.mouseGunHeld=false;this.keys.delete('r');
    for(const id of [...this.cannonPointers])this.endCannonPointer(id);
  }

  isTouchClick(event) {
    if (!event || event.detail === 0) return false; // Native keyboard activation is still a click.
    return event.pointerType === "touch" || event.pointerType === "pen" || performance.now() - (this.touchActivated.get(event.currentTarget) ?? -Infinity) < 800;
  }

  getMovement() {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.helmLocked || this.enemyDefense.defeated || !this.visuals.available) return { x: 0, y: 0, z: 0 };
    const keyboard = this.getKeyboardTarget() || { x: 0, y: 0 };
    const pad = Math.hypot(this.padDrag.x, this.padDrag.y) >= .12 ? this.padDrag : { x: 0, y: 0 };
    const x = clamp(keyboard.x + pad.x, -1, 1), y = clamp(-keyboard.y - pad.y, -1, 1);
    return { x, y, z: this.getThrust() };
  }

  get canTrack() { return this.navigation.placed && (this.navigation.active || this.searchProgress >= VOYAGE_CONFIG.signalProgress) && !this.navigation.anchor && !this.enemyDefense.defeated; }

  toggleTracking() {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || !this.canTrack) return;
    this.lookTracking = !this.lookTracking;
    this.releaseLook();
    if (this.lookTracking) {
      // Centre of hull only: never discover or auto-aim at the cargo ramp.
      const bearing = lookAt(this.navigation.position, this.navigation.enemyPosition, this.getView());
      this.pointerTarget = { x: bearing.yaw / HELM.yawScale, y: bearing.pitch / HELM.pitchScale };
    } else this.pointerTarget = { ...this.pointer };
    this.updateHud();
  }

  shiftView(shift) {
    for (const value of [this.pointer, this.pointerTarget]) {
      value.x += shift.yaw / HELM.yawScale;
      value.y += shift.pitch / HELM.pitchScale;
    }
  }

  dodge() {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.helmLocked || this.enemyDefense.defeated || !this.visuals.available) return;
    if (this.navigation.startDodge(this.getView(), this.getMovement())) this.audio.unlock();
    this.updateHud();
  }

  toggleOrbit() {
    if (this.manuallyPaused || this.destroyed || this.spaceScene?.hidden || this.enemyDefense.defeated) return;
    this.audio.unlock();
    if (this.navigation.toggleOrbit()) {
      this.releasePad();
      this.keys.clear(); this.clearThrust();
      if (this.announcement) this.announcement.textContent = this.navigation.orbiting ? "자동 선회 시작. 이동 패드나 이동 키를 누르면 수동 비행으로 전환됩니다. 오른쪽 드래그로 조준할 수 있습니다." : "선회 정지. 현재 위치와 시선을 유지합니다.";
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
    if (this.enemyDefense.defeated) {
      if ((event.code === "Space" || event.key === "Enter") && !event.repeat) { event.preventDefault(); this.handleBoardingAction(); }
      return;
    }
    if (event.target?.dataset?.thrust && (event.code === "Space" || event.key === "Enter")) {
      event.preventDefault();
      if (!this.navigation.anchor) this.thrustKeyButton = Number(event.target.dataset.thrust);
      return;
    }
    if (event.code === 'KeyR' || (event.target===this.cannonButton && isNativeButtonAction)) {
      event.preventDefault();
      if(this.canShoot && (!event.repeat || this.keys.has('r') || this.cannonKeyButton)) {
        this.audio.unlock();
        if(event.code==='KeyR')this.keys.add('r');else this.cannonKeyButton=true;
        if(!event.repeat)this.fireCannon();
      }
      return;
    }
    if (!event.repeat && event.code === "KeyO") { this.toggleOrbit(); event.preventDefault(); return; }
    if (!event.repeat && event.code === "KeyT") { this.toggleTracking(); event.preventDefault(); return; }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      if (!event.repeat) this.dodge();
      event.preventDefault(); return;
    }
    if (event.code === "KeyF") {
      event.preventDefault();
      if (!event.repeat) {
        if (this.encounterReady) this.battleButton?.click();
        else this.handleBoardingAction();
      }
      return;
    }
    if (isNativeButtonAction) {
      if (event.repeat) event.preventDefault();
      return;
    }
    const key = this.movementKey(event);
    if (["w", "a", "s", "d", "space", "control", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      if (!event.repeat) this.audio.unlock();
      if (!this.helmLocked && (!event.repeat || this.keys.has(key))) this.keys.add(key);
      event.preventDefault();
    }
  }

  movementKey(event) {
    if (event.code === "Space") return "space";
    if (event.code === "ControlLeft" || event.code === "ControlRight") return "control";
    return /^Key[WASDR]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  }

  onKeyUp(event) {
    const key = this.movementKey(event);
    this.keys.delete(key);
    if (event.code === "Space" || event.key === "Enter") this.thrustKeyButton = 0;
    if (event.code === "Space" || event.key === "Enter") {this.cannonKeyButton=false;if(event.target===this.cannonButton)event.preventDefault();}
    this.updateThrustUi();
  }

  getKeyboardTarget() {
    const x = Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft"));
    const y = Number(this.keys.has("control") || this.keys.has("arrowdown")) - Number(this.keys.has("space") || this.keys.has("arrowup"));
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
    this.clearCannon(); this.cannon.reset();
    this.assault.reset();
    this.enemyDefense.reset();
    this.keys.clear(); this.clearThrust();
    this.navigation.reset();
    this.releasePad();
    this.releaseLook(); this.lookTracking = false;
    if (this.orbitControls) this.orbitControls.hidden = true;
    if (this.orbitReadout) { this.orbitReadout.hidden = true; this.orbitReadout.textContent = ""; }
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
    if (this.boardingAction) this.boardingAction.hidden = false;
    if (this.battleButton) { this.battleButton.hidden = true; this.battleButton.disabled = true; }
    this.setVoyageMode("survey", "적함에 접근했습니다. 후방 갑판 장갑을 포격해 작살 고정면을 노출시키십시오.");
    this.updateHud(true);
  }

  getActualBearing() {
    if (!this.navigation.placed) return { ...this.contactBearing };
    const view = lookAt(this.navigation.position, this.navigation.target, this.getView());
    return { x: view.yaw / 0.65, y: view.pitch / 0.65 };
  }

  getGuidanceBearing() { return this.getActualBearing(); }

  getTrackingMetrics() {
    const guidance = this.getGuidanceBearing();
    const angle = guidance.x * 0.65 - this.pointer.x * HELM.yawScale;
    const relativeX = Math.atan2(Math.sin(angle), Math.cos(angle)) / 0.65;
    const relativeY = guidance.y - this.pointer.y * 0.48;
    const error = Math.hypot(relativeX, relativeY);
    const pitchDegrees = pitchOffsetDegrees(this.getView().pitch, guidance.y * 0.65);
    return { guidance, relativeX, relativeY, pitchDegrees, error, quality: clamp(1 - error / 0.58, 0, 1) };
  }

  handleBoardingAction(event) {
    if (this.isTouchClick(event)) return;
    if (this.destroyed || this.manuallyPaused || !this.visuals.available || this.spaceScene?.hidden) return;
    if (this.enemyDefense.defeated) {
      this.forceContact();
      this.navigation.radius = FLIGHT.surveyDistance;
      this.navigation.updatePosition();
      const view = lookAt(this.navigation.position, this.navigation.enemyPosition);
      this.pointer = { x: view.yaw / HELM.yawScale, y: view.pitch / HELM.pitchScale };
      this.pointerTarget = { ...this.pointer };
      this.renderStill();
      return;
    }
    if (this.assault.stage === "survey") {
      const solution = this.navigation.launch(this.getView());
      if (!solution || !this.assault.fireHarpoon(solution)) return;
      this.audio.unlock();
      this.releasePad(); this.keys.clear(); this.clearThrust();
      this.clearCannon(); this.cannon.bolts=[];
    } else {
      if (!this.assault.canCommit()) return;
      this.audio.unlock();
      if (!this.assault.commit()) return;
      this.navigation.stopOrbit();
      this.keys.clear(); this.releasePad();
      const bearing = this.assault.attackBearing;
      const delta = bearing.yaw - this.getView().yaw;
      this.pointerTarget.x = this.pointer.x + Math.atan2(Math.sin(delta), Math.cos(delta)) / HELM.yawScale;
      this.pointerTarget.y = bearing.pitch / HELM.pitchScale;
    }
    this.setVoyageMode(this.assault.stage, ASSAULT_COPY[this.assault.stage][1]);
    this.updateHud(true);
  }

  updateBoardingControls() {
    if (this.enemyDefense.defeated) {
      this.orbitControls.hidden = this.orbitReadout.hidden = this.battleButton.hidden = true;
      this.boardingAction.hidden = false; this.boardingAction.disabled = false;
      this.boardingActionLabel.textContent = "다시 도전";
      this.boardingAction.setAttribute("aria-label", "함선 기동 불능. 다시 도전");
      this.boardingAction.setAttribute("title", "함선을 복구하고 적함 앞에서 다시 도전");
      this.steeringPad?.setAttribute("aria-disabled", "true");
      return;
    }
    if (!this.isBoardingActive) return;
    const nav = this.navigation, a = this.assault;
    const fire = a.stage === "survey" && nav.solution.canFire;
    const pull = a.canCommit();
    if (this.battleButton) { this.battleButton.hidden = !this.encounterReady; this.battleButton.disabled = !this.encounterReady; }
    if (this.boardingAction) {
      this.boardingAction.hidden = this.encounterReady;
      this.boardingAction.disabled = !(fire || pull);
    }
    // Only compact actions are visible; detailed guidance stays in accessible labels/tooltips.
    const label = a.stage==='jammed' ? "걸림 · 패드로 정렬" : a.stage==='charge' ? "문 중앙에 맞추기" : a.stage==='rebound' ? "이탈 중…" : pull ? "견인 돌입" : a.committed ? "돌입 중…" : a.stage === "harpoon" ? "작살 비행 중…" : nav.armorHealth>0 ? "작살 · 장갑 폐쇄" : "작살 발사";
    const hint = a.canCorrect ? "이동 패드 또는 A/D·Space/Ctrl로 기체를 옮겨 문 중앙에 맞추세요." + (pull ? " F로 견인 돌입." : "") : fire ? "F · 노출된 문에 작살 발사" : a.committed ? "강습 완료까지 대기" : nav.armorHealth>0 ? "R / 우클릭 / 포격 버튼으로 후방의 황동색 장갑을 파괴하세요" : "오른쪽 화면 드래그로 노출된 후방 문 중앙을 조준하세요";
    if (this.boardingActionLabel) this.boardingActionLabel.textContent = label;
    this.boardingAction?.setAttribute("aria-label", label + ". " + hint);
    this.boardingAction?.setAttribute("title", hint);
    this.steeringPad?.setAttribute("aria-disabled", String(this.helmLocked));
    this.spaceScene?.setAttribute("data-helm-locked", String(this.helmLocked));
    if (this.orbitControls) this.orbitControls.hidden = Boolean(nav.anchor) || a.committed;
    if (this.orbitButton) {
      this.orbitButton.disabled = !nav.orbiting && !nav.canOrbit;
      this.orbitButton.setAttribute("aria-pressed", String(nav.orbiting));
      this.orbitButton.textContent = nav.orbiting ? "선회 정지" : "자동 선회";
    }
    // Keep the requested clearance warning, but no permanent status panel.
    const tooClose = nav.orbitTooClose && !nav.anchor;
    if (this.orbitReadout) {
      this.orbitReadout.hidden = !tooClose;
      this.orbitReadout.textContent = tooClose ? this.orbitTooCloseMessage : "";
    }
  }

  updateBoarding(deltaSeconds) {
    if (!this.assault.committed) {
      const shift = this.navigation.update(deltaSeconds, this.getView());
      // Autopilot follows the target; manual look offset stays latched, including during a drag.
      this.shiftView(shift);
      if (this.assault.stage === "survey") this.assault.distance = this.navigation.solution.distance;
    }
    if(this.navigation.anchor) {
      this.navigation.pull(this.assault.committed?this.assault.distance:this.navigation.tetherDistance);
      this.assault.landingError=this.navigation.landingError(this.getView());
    }
    const previousStage=this.assault.stage, couldCorrect=this.assault.canCorrect;
    const wasFlying = this.assault.stage === "harpoon";
    this.assault.update(deltaSeconds);
    if (wasFlying && this.assault.stage === "tethered") {
      this.assault.lockTether(this.navigation.attach(this.getView()));
      this.keys.clear(); this.releasePad(); this.clearThrust();
      this.releaseLook(); this.lookTracking = false;
      this.clearCannon(); this.cannon.bolts=[];
    }
    if (this.assault.committed) this.navigation.pull(this.assault.distance);
    if(previousStage==='charge' && ['jammed','rebound'].includes(this.assault.stage)) {
      this.enemyDefense.damage(this.assault.stage==='jammed'?10:20);
      this.audio.play('enemy-hit');
    }
    if(couldCorrect && !this.assault.canCorrect) {this.keys.clear();this.releasePad();}
    if(this.assault.stage==='retry') {
      this.navigation.releaseTether();this.assault.begin();
      this.navigation.inspect(this.getView());
    }
    if (this.mode !== this.assault.stage) this.setVoyageMode(this.assault.stage, ASSAULT_COPY[this.assault.stage][1]);
  }

  update(deltaSeconds) {
    if (this.manuallyPaused || this.destroyed) return;
    this.sceneTime += deltaSeconds;
    if (this.enemyDefense.defeated) { this.enemyDefense.update(deltaSeconds, this.navigation); return; }
    const previousPosition = { ...this.navigation.position };
    this.cruiseElapsed += deltaSeconds;
    this.hudAccumulator += deltaSeconds;

    if (this.sceneTime >= this.nextCourseAt) this.chooseNewCourse();

    const movement = this.getMovement();
    if (this.assault.canCorrect) {
      const magnitude = Math.max(1, Math.hypot(movement.x, movement.y));
      this.navigation.correct(this.navigation.correction.x + movement.x / magnitude * 8 * deltaSeconds, this.navigation.correction.y + movement.y / magnitude * 8 * deltaSeconds);
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
    const trackBefore = this.lookTracking && !this.navigation.anchor ? lookAt(this.navigation.position, this.navigation.enemyPosition, this.getView()) : null;
    this.navigation.move(deltaSeconds, this.getView(), thrust, movement);
    if (trackBefore) {
      const after = lookAt(this.navigation.position, this.navigation.enemyPosition, trackBefore);
      this.shiftView({ yaw: after.yaw - trackBefore.yaw, pitch: after.pitch - trackBefore.pitch });
    }
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
        this.searchProgress + (this.navigation.speed ? deltaSeconds : 0) * launchRamp * (
          VOYAGE_CONFIG.searchBaseRate + alignment * VOYAGE_CONFIG.searchAlignedRate
        ),
      );
      if (this.navigation.radius <= FLIGHT.surveyDistance) this.searchProgress = 1;
      this.updateMode();
    } else if (this.isBoardingActive && !this.encounterReady) {
      this.updateBoarding(deltaSeconds);
    }

    const cannonEvents=this.cannon.update(deltaSeconds,this.navigation,{view:this.getView(),trigger:this.shooting,enabled:this.canShoot});
    for(const event of cannonEvents) {
      this.audio.play(event);
      if(event==='armor-break' && this.announcement)this.announcement.textContent='후방 장갑 파괴. 노출된 내부 고정면에 작살을 꽂으십시오. 적은 아직 포격 중입니다.';
    }
    if(!this.navigation.active && cannonEvents.some(event=>event!=='player-fire')) {this.searchProgress=1;this.beginIntercept();}
    const breached=['impact','clamp','seal','pressurize','ready'].includes(this.assault.stage);
    const defenseEvents = this.enemyDefense.update(deltaSeconds, this.navigation, {breached});
    for (const event of defenseEvents) {
      this.audio.play(event);
      if (event === "enemy-lock" && this.announcement) this.announcement.textContent = this.enemyDefense.pattern==='fan' ? "적 수평 확산 포격. 위나 아래로 회피하십시오." : "적 포격 조준 고정. 진행 방향을 바꿔 회피하십시오.";
      if (event === "enemy-hit" && this.announcement) this.announcement.textContent = `피격. 함선 내구도 ${this.enemyDefense.hull}.`;
    }
    if(this.enemyDefense.defeated && this.mode!=='defeated') {
        this.navigation.stopOrbit(); this.navigation.active = false;
        this.navigation.harpoonTarget = this.navigation.harpoonLocalTarget = null;
        this.assault.reset(); this.keys.clear(); this.releasePad(); this.clearThrust();
        this.releaseLook(); this.lookTracking = false; this.navigation.cancelDodge();
        this.clearCannon(); this.cannon.bolts=[];
        this.setVoyageMode("defeated", "함선 기동 불능. 하단의 다시 도전 버튼으로 재출격할 수 있습니다.");
    }
    if (this.isBoardingActive && !this.navigation.anchor) this.navigation.inspect(this.getView());

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
    if(this.cannonButton) {
      this.cannonButton.disabled=!this.canShoot;
      this.cannonButton.classList.toggle('is-held',this.shooting);
      this.cannonButton.textContent=this.cannon.reloadTime>0?`장전 ${this.cannon.reloadTime.toFixed(1)}`:`포격 · ${this.cannon.rounds}`;
    }
    if (this.trackButton) {
      this.trackButton.disabled = !this.canTrack;
      this.trackButton.setAttribute("aria-pressed", String(this.lookTracking));
      this.trackButton.textContent = this.lookTracking ? "시선 추적 ON" : "시선 추적";
    }
    if (this.dodgeButton) {
      const cooldown = this.navigation.dodgeCooldown;
      this.dodgeButton.disabled = cooldown > 0 || Boolean(this.navigation.anchor) || this.helmLocked || this.enemyDefense.defeated;
      this.dodgeButton.textContent = cooldown > 0 ? `회피 ${cooldown.toFixed(1)}` : "회피";
    }
    this.updateThrustUi();
    this.updateBoardingControls();
    if (force) this.updateContactVisuals();
  }

  updateContactVisuals() {
    const actual = this.getActualBearing();
    const guidance = this.getTrackingMetrics();
    const actualRelativeX = guidance.relativeX;
    const actualRelativeY = guidance.relativeY;
    this.visuals.draw({
      bearing: actual, guidance: guidance.guidance, steering: this.pointer,
      distance: this.isBoardingActive ? this.assault.distance : this.navigation.radius,
      navigation: this.navigation,
      time: this.sceneTime, motion: !this.reducedMotion,
      travel: this.starTravel, assault: this.assault,
      defense: this.enemyDefense,
      cannon: this.cannon,
    });
    if (this.radar) {
      const dx = actualRelativeX * 64, dy = -4 + actualRelativeY * 58;
      const edgeScale = Math.min(1, 40 / (Math.hypot(dx, dy) || 1));
      const markerX = 50 + dx * edgeScale, markerY = 50 + dy * edgeScale;
      this.radar.style.setProperty("--radar-x", `${markerX.toFixed(1)}%`);
      this.radar.style.setProperty("--radar-y", `${markerY.toFixed(1)}%`);
      this.radar.style.setProperty("--radar-opacity", Math.max(0.85, clamp(this.searchProgress * 1.7, 0, 1)).toFixed(3));
      const pitch = Math.round(guidance.pitchDegrees) || 0;
      const label = pitch > 0 ? `↑ ${pitch}°` : pitch < 0 ? `↓ ${-pitch}°` : "0°";
      const hasContact = this.searchProgress > 0;
      if (this.radarBlip) {
        this.radarBlip.hidden = !hasContact;
        // Flip the callout inward so even an off-screen contact stays readable at the rim.
        this.radarBlip.dataset.labelLeft = String(markerX > 50);
        this.radarBlip.dataset.labelAbove = String(markerY > 60);
      }
      if (this.radarPitch && this.radarPitch.textContent !== label) this.radarPitch.textContent = label;
      this.radar.setAttribute("aria-label", hasContact ? `적함 피치 차이: ${pitch > 0 ? "위로" : pitch < 0 ? "아래로" : "일치"} ${Math.abs(pitch)}도` : "레이더: 감지된 적함 없음");
    }

  }

  render(allowMotion) {
    const steering = this.padDrag;

    const age = this.assault.impactAge;
    const impact = allowMotion && age >= 0 ? Math.exp(-age * 4.5) : 0;
    const cockpitVibration = allowMotion ? (Math.sin(this.sceneTime * 19) * Math.min(1, Math.abs(this.navigation.speed) / 22) * 0.16 + Math.sin(age * 67) * impact * 7) : 0;
    this.spaceScene?.style.setProperty("--impact-flash", (allowMotion && age >= 0 ? Math.exp(-age * 11) * 0.28 : 0).toFixed(3));
    const damage = this.enemyDefense;
    const damageFlash = allowMotion && damage.hitAge >= 0 ? Math.exp(-damage.hitAge * 5) * .65 : 0;
    this.spaceScene?.style.setProperty("--damage-opacity", Math.max(damageFlash, damage.defeated ? .7 : (1 - damage.hull / 100) * .18).toFixed(3));

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
      enemyDefense: this.enemyDefense.getState(),
      cannon: this.cannon.getState(), shooting:this.shooting,
      harpoonProgress: this.assault.harpoon,
      mode: this.mode,
      boardingStage: this.isBoardingActive ? this.mode : null,
      searchProgress: this.searchProgress,
      settingsOpen: Boolean(this.settingsDialog?.open), sfxEnabled: this.audio.enabled,
      lookTracking: this.lookTracking, movement: this.getMovement(),
      encounterReady: this.encounterReady,
      journeyDistance: this.journeyDistance,
      thrust: this.getThrust(), speed: this.assault.committed ? this.assault.speed : this.navigation.speed,
      starTravel: this.starTravel,
      distanceMeters: this.isBoardingActive ? this.assault.distance : null,
      relativeSpeed: this.assault.committed ? this.assault.speed : this.navigation.speed,
      alignment: tracking.quality,
      radarPitchDegrees: tracking.pitchDegrees,
      steeringLocked: this.helmLocked,
      canCorrect: this.assault.canCorrect, landingError: this.assault.landingError, collision: this.assault.collision,
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
