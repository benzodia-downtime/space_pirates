import { VoyageScene } from "./voyage.js?v=breachgun-1";

(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const BATTLE_CONFIG = Object.freeze({
    unrealUnitsPerMeter: 100,
    worldWidthUnits: 6000,
    worldHeightUnits: 3600,
    attackRangeUnits: 2000,
    walkSpeedUnitsPerSecond: 400,
    projectileSpeedUnitsPerSecond: 5000,
    fireCadenceMilliseconds: 1000,
    introMilliseconds: 700,
  });

  const ENCOUNTER_LOOT = Object.freeze({
    fuelCells: 2,
    ammoCrates: 1,
    medicalSupplies: 1,
  });

  class BattleController {
    constructor(ambientScene) {
      this.ambientScene = ambientScene;
      this.spaceScene = document.getElementById("space-scene");
      this.level = document.getElementById("battle-level");
      this.field = document.getElementById("battlefield");
      this.startButton = document.getElementById("battle-start");
      this.startButtonStatus = this.startButton?.querySelector("span");
      this.resultActionButton = document.getElementById("battle-result-action");
      this.returnButton = document.getElementById("battle-return");
      this.phaseLabel = document.getElementById("battle-phase");
      this.distanceLabel = document.getElementById("battle-distance");
      this.meterPixelsLabel = document.getElementById("meter-pixels");
      this.rangePixelsLabel = document.getElementById("range-pixels");
      this.projectileLayer = document.getElementById("projectile-layer");
      this.result = document.getElementById("battle-result");
      this.resultEyebrow = document.getElementById("battle-result-eyebrow");
      this.resultTitle = document.getElementById("battle-result-title");
      this.resultCopy = document.getElementById("battle-result-copy");
      this.lootManifest = document.getElementById("battle-loot");

      this.units = {
        player: {
          id: "player",
          element: document.getElementById("player-combatant"),
          healthBar: document.getElementById("player-health-bar"),
          healthTrack: document.getElementById("player-health-track"),
          healthText: document.getElementById("player-health-text"),
          startPositionUnits: { x: 800, y: 2900 },
          positionUnits: { x: 800, y: 2900 },
          maxHealth: 100,
          health: 100,
          attack: 10,
          color: "#61eaf4",
        },
        enemy: {
          id: "enemy",
          element: document.getElementById("enemy-combatant"),
          healthBar: document.getElementById("enemy-health-bar"),
          healthTrack: document.getElementById("enemy-health-track"),
          healthText: document.getElementById("enemy-health-text"),
          startPositionUnits: { x: 5200, y: 700 },
          positionUnits: { x: 5200, y: 700 },
          maxHealth: 50,
          health: 50,
          attack: 10,
          color: "#ff5577",
        },
      };

      this.phase = "idle";
      this.volley = 0;
      this.frameId = 0;
      this.lastFrameTime = 0;
      this.suspendedPhase = null;
      this.playerWon = false;
      this.lootRecovered = false;
      this.cargo = {
        fuelCells: 0,
        ammoCrates: 0,
        medicalSupplies: 0,
      };
      this.timers = new Set();
      this.renderScalePixelsPerUnit = 1;

      this.onStart = this.start.bind(this);
      this.onResultAction = this.handleResultAction.bind(this);
      this.onReturn = this.returnToSpace.bind(this);
      this.onResize = this.render.bind(this);
      this.onFrame = this.onFrame.bind(this);
      this.onVisibilityChange = this.handleVisibilityChange.bind(this);

      this.ready = Boolean(
        this.spaceScene &&
        this.level &&
        this.field &&
        this.startButton &&
        this.resultActionButton &&
        this.units.player.element &&
        this.units.enemy.element,
      );

      if (!this.ready) return;

      this.startButton.addEventListener("click", this.onStart);
      this.resultActionButton?.addEventListener("click", this.onResultAction);
      this.returnButton?.addEventListener("click", this.onReturn);
      window.addEventListener("resize", this.onResize, { passive: true });
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.resetBattle();
    }

    schedule(callback, delay) {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        callback();
      }, delay);
      this.timers.add(timer);
      return timer;
    }

    clearActivity() {
      if (this.frameId) {
        window.cancelAnimationFrame(this.frameId);
        this.frameId = 0;
      }
      for (const timer of this.timers) window.clearTimeout(timer);
      this.timers.clear();
      this.projectileLayer?.replaceChildren();
      this.lastFrameTime = 0;
    }

    setUnitState(unit, state) {
      if (unit.element) unit.element.dataset.state = state;
    }

    setPhase(text) {
      if (this.phaseLabel) this.phaseLabel.textContent = text;
    }

    resetBattle() {
      this.clearActivity();
      this.phase = "idle";
      this.volley = 0;
      this.suspendedPhase = null;
      this.playerWon = false;
      this.lootRecovered = false;

      for (const unit of Object.values(this.units)) {
        unit.positionUnits = { ...unit.startPositionUnits };
        unit.health = unit.maxHealth;
        this.setUnitState(unit, "idle");
      }

      if (this.result) {
        this.result.hidden = true;
        delete this.result.dataset.outcome;
        delete this.result.dataset.state;
      }
      if (this.lootManifest) {
        this.lootManifest.hidden = true;
        for (const item of this.lootManifest.children) delete item.dataset.collected;
      }
      if (this.returnButton) this.returnButton.disabled = false;
      this.setPhase("교전 대기");
      this.updateHud();
      this.render();
    }

    start() {
      const canRetryDefeat = !this.level.hidden && this.phase === "result" && !this.playerWon;
      if (
        !this.ready ||
        (!this.level.hidden && !canRetryDefeat) ||
        (this.ambientScene && !this.ambientScene.encounterReady)
      ) {
        return;
      }

      this.spaceScene.hidden = true;
      this.level.hidden = false;
      this.startButton.disabled = true;
      this.ambientScene?.pause();
      this.resetBattle();
      this.setPhase("후방 하강문 돌파구로 진입");
      this.level.focus({ preventScroll: true });
      this.schedule(() => this.beginWalk(), BATTLE_CONFIG.introMilliseconds);
    }

    reset() {
      if (!this.ready || (this.ambientScene && !this.ambientScene.encounterReady)) return;
      if (this.level.hidden) {
        this.start();
        return;
      }

      this.startButton.disabled = true;
      this.ambientScene?.pause();
      this.resetBattle();
      this.setPhase("후방 하강문 돌파구로 진입");
      this.level.focus({ preventScroll: true });
      this.schedule(() => this.beginWalk(), BATTLE_CONFIG.introMilliseconds);
    }

    handleVisibilityChange() {
      if (!this.ready || this.level.hidden || this.phase === "result") return;

      if (document.hidden) {
        this.suspendedPhase = this.phase;
        this.clearActivity();
        this.setUnitState(this.units.player, "idle");
        this.setUnitState(this.units.enemy, "idle");
        this.setPhase("전투 일시 정지");
        return;
      }

      const suspendedPhase = this.suspendedPhase;
      this.suspendedPhase = null;
      if (suspendedPhase === "walk") {
        this.beginWalk();
      } else if (suspendedPhase === "attack") {
        this.phase = "attack";
        this.setPhase("20m 사정거리 확보");
        this.schedule(() => this.exchangeFire(), 350);
      } else if (suspendedPhase === "idle") {
        this.phase = "idle";
        this.setPhase("후방 하강문 돌파구로 진입");
        this.schedule(() => this.beginWalk(), BATTLE_CONFIG.introMilliseconds);
      }
    }

    beginWalk() {
      if (this.level.hidden) return;
      this.phase = "walk";
      this.setPhase("사정거리까지 접근 중");
      this.setUnitState(this.units.player, "walk");
      this.setUnitState(this.units.enemy, "walk");
      this.lastFrameTime = 0;
      this.frameId = window.requestAnimationFrame(this.onFrame);
    }

    onFrame(timestamp) {
      this.frameId = 0;
      if (this.phase !== "walk" || this.level.hidden) return;

      const deltaSeconds = this.lastFrameTime
        ? clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.05)
        : 0;
      this.lastFrameTime = timestamp;

      const player = this.units.player;
      const enemy = this.units.enemy;
      const deltaX = enemy.positionUnits.x - player.positionUnits.x;
      const deltaY = enemy.positionUnits.y - player.positionUnits.y;
      const distance = Math.hypot(deltaX, deltaY);
      const excessDistance = Math.max(0, distance - BATTLE_CONFIG.attackRangeUnits);
      if (excessDistance <= 0.5) {
        this.render();
        this.beginAttack();
        return;
      }

      const hasDirection = distance > 0.000001;
      const directionX = hasDirection ? deltaX / distance : 1;
      const directionY = hasDirection ? deltaY / distance : 0;
      const movement = Math.min(
        BATTLE_CONFIG.walkSpeedUnitsPerSecond * deltaSeconds,
        excessDistance / 2,
      );

      player.positionUnits.x += directionX * movement;
      player.positionUnits.y += directionY * movement;
      enemy.positionUnits.x -= directionX * movement;
      enemy.positionUnits.y -= directionY * movement;

      const remainingDistance = distance - movement * 2;
      if (remainingDistance <= BATTLE_CONFIG.attackRangeUnits + 0.5) {
        const midpointX = (player.positionUnits.x + enemy.positionUnits.x) / 2;
        const midpointY = (player.positionUnits.y + enemy.positionUnits.y) / 2;
        const halfRange = BATTLE_CONFIG.attackRangeUnits / 2;
        player.positionUnits.x = midpointX - directionX * halfRange;
        player.positionUnits.y = midpointY - directionY * halfRange;
        enemy.positionUnits.x = midpointX + directionX * halfRange;
        enemy.positionUnits.y = midpointY + directionY * halfRange;
        this.render();
        this.beginAttack();
        return;
      }

      this.render();
      this.frameId = window.requestAnimationFrame(this.onFrame);
    }

    beginAttack() {
      this.phase = "attack";
      this.setUnitState(this.units.player, "idle");
      this.setUnitState(this.units.enemy, "idle");
      this.setPhase("20m 사정거리 확보");
      this.schedule(() => this.exchangeFire(), 350);
    }

    exchangeFire() {
      if (this.phase !== "attack") return;

      const player = this.units.player;
      const enemy = this.units.enemy;
      const playerCanFire = player.health > 0;
      const enemyCanFire = enemy.health > 0;
      if (!playerCanFire || !enemyCanFire) {
        this.finishBattle();
        return;
      }

      this.volley += 1;
      this.setPhase(`교전 중 · 일제사격 ${this.volley}`);
      this.setUnitState(player, "attack");
      this.setUnitState(enemy, "attack");

      const flightDuration = Math.max(
        this.fireProjectile(player, enemy),
        this.fireProjectile(enemy, player),
      );

      this.schedule(() => {
        if (this.phase !== "attack") return;

        player.health = clamp(player.health - enemy.attack, 0, player.maxHealth);
        enemy.health = clamp(enemy.health - player.attack, 0, enemy.maxHealth);
        this.updateHud();

        if (player.health <= 0 || enemy.health <= 0) {
          this.finishBattle();
          return;
        }

        this.setUnitState(player, "idle");
        this.setUnitState(enemy, "idle");
        const recovery = Math.max(260, BATTLE_CONFIG.fireCadenceMilliseconds - flightDuration);
        this.schedule(() => this.exchangeFire(), recovery);
      }, flightDuration);
    }

    fireProjectile(source, target) {
      if (!this.projectileLayer || !this.field) return 1;

      const fieldBounds = this.field.getBoundingClientRect();
      const sourceSprite = source.element?.querySelector(".combatant__sprite-frame");
      const targetSprite = target.element?.querySelector(".combatant__sprite-frame");
      const sourceBounds = sourceSprite?.getBoundingClientRect();
      const targetBounds = targetSprite?.getBoundingClientRect();
      if (!sourceBounds || !targetBounds) return 1;

      const sourceCenterX = sourceBounds.left + sourceBounds.width / 2 - fieldBounds.left;
      const sourceCenterY = sourceBounds.top + sourceBounds.height / 2 - fieldBounds.top;
      const targetCenterX = targetBounds.left + targetBounds.width / 2 - fieldBounds.left;
      const targetCenterY = targetBounds.top + targetBounds.height / 2 - fieldBounds.top;
      const centerDeltaX = targetCenterX - sourceCenterX;
      const centerDeltaY = targetCenterY - sourceCenterY;
      const screenDistance = Math.hypot(centerDeltaX, centerDeltaY);
      const directionX = screenDistance > 0 ? centerDeltaX / screenDistance : 1;
      const directionY = screenDistance > 0 ? centerDeltaY / screenDistance : 0;
      const startX = sourceCenterX + directionX * 22;
      const startY = sourceCenterY + directionY * 22;
      const endX = targetCenterX - directionX * 18;
      const endY = targetCenterY - directionY * 18;
      const travelX = endX - startX;
      const travelY = endY - startY;
      const angle = Math.atan2(travelY, travelX) * 180 / Math.PI;
      const travelPixels = Math.hypot(travelX, travelY);
      const projectileSpeedPixelsPerSecond =
        BATTLE_CONFIG.projectileSpeedUnitsPerSecond * this.renderScalePixelsPerUnit;
      const duration = Math.max(
        120,
        Math.round((travelPixels / Math.max(0.001, projectileSpeedPixelsPerSecond)) * 1000),
      );

      const projectile = document.createElement("span");
      projectile.className = "projectile";
      projectile.style.left = `${startX.toFixed(1)}px`;
      projectile.style.top = `${(startY - 1.5).toFixed(1)}px`;
      projectile.style.setProperty("--projectile-color", source.color);
      projectile.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      this.projectileLayer.append(projectile);

      if (typeof projectile.animate === "function") {
        const animation = projectile.animate(
          [
            { transform: `translate3d(0, 0, 0) rotate(${angle.toFixed(2)}deg)`, opacity: 1 },
            { transform: `translate3d(${travelX.toFixed(1)}px, ${travelY.toFixed(1)}px, 0) rotate(${angle.toFixed(2)}deg)`, opacity: 1 },
          ],
          { duration, easing: "linear", fill: "forwards" },
        );
        animation.finished.then(() => projectile.remove()).catch(() => projectile.remove());
      } else {
        this.schedule(() => projectile.remove(), duration);
      }

      return duration;
    }

    finishBattle() {
      this.phase = "result";
      const playerWon = this.units.player.health > 0 && this.units.enemy.health <= 0;
      this.playerWon = playerWon;
      this.lootRecovered = false;

      this.setUnitState(this.units.player, this.units.player.health > 0 ? "idle" : "down");
      this.setUnitState(this.units.enemy, this.units.enemy.health > 0 ? "idle" : "down");
      this.setPhase(playerWon ? "적 승무원 제압" : "플레이어 승무원 전투 불능");

      if (this.result) this.result.dataset.outcome = playerWon ? "victory" : "defeat";
      if (this.resultEyebrow) {
        this.resultEyebrow.textContent = playerWon ? "BOARDING COMPLETE" : "BOARDING FAILED";
      }
      if (this.resultTitle) this.resultTitle.textContent = playerWon ? "적함 제압" : "패배";
      if (this.resultCopy) {
        this.resultCopy.textContent = playerWon
          ? `적 승무원을 모두 제압했습니다. 적함은 남겨두고 내부 물자만 회수합니다. 남은 체력 ${this.units.player.health}.`
          : "플레이어 승무원이 쓰러졌습니다.";
      }
      if (this.lootManifest) this.lootManifest.hidden = !playerWon;
      if (this.resultActionButton) {
        this.resultActionButton.textContent = playerWon ? "전리품 모두 회수" : "다시 전투";
      }
      if (this.returnButton) this.returnButton.disabled = playerWon;
      if (this.result) this.result.hidden = false;
      this.resultActionButton?.focus({ preventScroll: true });
    }

    handleResultAction() {
      if (this.phase !== "result") return;

      if (!this.playerWon) {
        this.start();
        return;
      }

      if (!this.lootRecovered) {
        this.recoverLoot();
        return;
      }

      this.returnToSpace();
    }

    recoverLoot() {
      if (!this.playerWon || this.lootRecovered) return;
      this.lootRecovered = true;
      for (const [item, quantity] of Object.entries(ENCOUNTER_LOOT)) {
        this.cargo[item] += quantity;
      }
      this.setPhase("적함 물자 회수 완료");

      if (this.result) this.result.dataset.state = "recovered";
      if (this.resultEyebrow) this.resultEyebrow.textContent = "CARGO SECURED";
      if (this.resultTitle) this.resultTitle.textContent = "회수 완료";
      if (this.resultCopy) {
        this.resultCopy.textContent = "연료 전지, 탄약 상자, 의료 물자를 챙겼습니다. 적함을 떠나 아군 함선으로 복귀합니다.";
      }
      if (this.lootManifest) {
        for (const item of this.lootManifest.children) item.dataset.collected = "true";
      }
      if (this.resultActionButton) this.resultActionButton.textContent = "아군 함선으로 귀환";
      if (this.returnButton) this.returnButton.disabled = false;
    }

    updateHud() {
      for (const unit of Object.values(this.units)) {
        const percentage = (unit.health / unit.maxHealth) * 100;
        if (unit.healthBar) unit.healthBar.style.width = `${percentage}%`;
        if (unit.healthText) unit.healthText.textContent = `${unit.health} / ${unit.maxHealth} HP`;
        if (unit.healthTrack) unit.healthTrack.setAttribute("aria-valuenow", String(unit.health));
      }
    }

    render() {
      if (!this.field) return;

      const fieldWidth = this.field.clientWidth;
      const fieldHeight = this.field.clientHeight;
      const usableWidth = Math.max(1, fieldWidth);
      const usableHeight = Math.max(1, fieldHeight);
      const pixelsPerUnit = Math.min(
        usableWidth / BATTLE_CONFIG.worldWidthUnits,
        usableHeight / BATTLE_CONFIG.worldHeightUnits,
      );
      this.renderScalePixelsPerUnit = pixelsPerUnit;
      const pixelsPerMeter = pixelsPerUnit * BATTLE_CONFIG.unrealUnitsPerMeter;
      const arenaWidth = BATTLE_CONFIG.worldWidthUnits * pixelsPerUnit;
      const arenaHeight = BATTLE_CONFIG.worldHeightUnits * pixelsPerUnit;
      const originX = (fieldWidth - arenaWidth) / 2;
      const originY = (fieldHeight - arenaHeight) / 2;

      this.field.style.setProperty("--arena-left", `${originX.toFixed(2)}px`);
      this.field.style.setProperty("--arena-top", `${originY.toFixed(2)}px`);
      this.field.style.setProperty("--arena-width", `${arenaWidth.toFixed(2)}px`);
      this.field.style.setProperty("--arena-height", `${arenaHeight.toFixed(2)}px`);

      for (const unit of Object.values(this.units)) {
        const target = unit.id === "player" ? this.units.enemy : this.units.player;
        const x = originX + unit.positionUnits.x * pixelsPerUnit;
        const y = originY + unit.positionUnits.y * pixelsPerUnit;
        const facingAngle = Math.atan2(
          target.positionUnits.y - unit.positionUnits.y,
          target.positionUnits.x - unit.positionUnits.x,
        ) * 180 / Math.PI + 90;
        unit.element?.style.setProperty("--position-x", `${x.toFixed(2)}px`);
        unit.element?.style.setProperty("--position-y", `${y.toFixed(2)}px`);
        unit.element?.style.setProperty("--facing-angle", `${facingAngle.toFixed(2)}deg`);
      }

      const distanceUnits = Math.hypot(
        this.units.enemy.positionUnits.x - this.units.player.positionUnits.x,
        this.units.enemy.positionUnits.y - this.units.player.positionUnits.y,
      );
      const distanceMeters = distanceUnits / BATTLE_CONFIG.unrealUnitsPerMeter;
      if (this.distanceLabel) this.distanceLabel.textContent = `${distanceMeters.toFixed(1)} m`;
      if (this.meterPixelsLabel) this.meterPixelsLabel.textContent = `${pixelsPerMeter.toFixed(1)} px`;
      if (this.rangePixelsLabel) {
        this.rangePixelsLabel.textContent = `${(pixelsPerMeter * 20).toFixed(0)} px`;
      }
    }

    returnToSpace() {
      if (!this.ready || this.level.hidden) return;
      const returnedWithLoot = this.playerWon && this.lootRecovered;
      this.clearActivity();
      this.level.hidden = true;
      this.spaceScene.hidden = false;
      this.startButton.disabled = false;
      if (returnedWithLoot) {
        if (this.startButtonStatus) this.startButtonStatus.textContent = "물자 회수 완료";

      }
      this.suspendedPhase = null;
      this.ambientScene?.resolveEncounter({ lootRecovered: returnedWithLoot });
      this.ambientScene?.resume();
      if (this.startButton.hidden) {
        this.ambientScene?.focusControls();
      } else {
        this.startButton.focus({ preventScroll: true });
      }
    }

    destroy() {
      this.clearActivity();
      this.startButton?.removeEventListener("click", this.onStart);
      this.resultActionButton?.removeEventListener("click", this.onResultAction);
      this.returnButton?.removeEventListener("click", this.onReturn);
      window.removeEventListener("resize", this.onResize);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  function initialise() {
    const existingBattle = window.SpacePiratesBattle;
    if (existingBattle && typeof existingBattle.destroy === "function") {
      existingBattle.destroy();
    }

    const existingScene = window.SpacePiratesAmbient;
    if (existingScene && typeof existingScene.destroy === "function") {
      existingScene.destroy();
    }

    const canvas = document.getElementById("starfield");
    const scene = new VoyageScene(canvas);
    const battle = new BattleController(scene);

    window.SpacePiratesAmbient = {
      pause: () => scene.pause(),
      resume: () => scene.resume(),
      destroy: () => scene.destroy(),
      redraw: () => scene.onResize(),
      forceContact: () => scene.forceContact(),
      forceEncounter: (options) => scene.forceEncounter(options),
      getState: () => scene.getState(),
      get paused() {
        return scene.manuallyPaused || document.hidden;
      },
    };

    window.SpacePiratesBattle = {
      start: () => battle.start(),
      exit: () => battle.returnToSpace(),
      reset: () => battle.reset(),
      getCargo: () => ({ ...battle.cargo }),
      destroy: () => battle.destroy(),
      config: BATTLE_CONFIG,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
