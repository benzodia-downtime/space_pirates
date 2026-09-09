(() => {
  "use strict";

  const STAR_DENSITY = 1 / 6400;
  const MIN_STARS = 72;
  const MAX_STARS = 230;
  const MAX_PIXEL_RATIO = 2;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const wrap = (value, size) => ((value % size) + size) % size;

  class Starfield {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas && typeof canvas.getContext === "function"
        ? canvas.getContext("2d", { alpha: true })
        : null;
      this.width = 0;
      this.height = 0;
      this.pixelRatio = 1;
      this.stars = [];
    }

    resize() {
      if (!this.canvas || !this.context) return;

      const bounds = this.canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width || this.canvas.clientWidth || window.innerWidth || 1);
      const height = Math.max(1, bounds.height || this.canvas.clientHeight || window.innerHeight || 1);
      const pixelRatio = clamp(window.devicePixelRatio || 1, 1, MAX_PIXEL_RATIO);
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
      this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.createStars();
    }

    createStars() {
      const count = Math.round(clamp(this.width * this.height * STAR_DENSITY, MIN_STARS, MAX_STARS));
      this.stars = Array.from({ length: count }, () => {
        const depth = 0.18 + Math.random() * 0.82;
        return {
          x: Math.random(),
          y: Math.random(),
          depth,
          radius: 0.35 + depth * depth * 1.45,
          alpha: 0.35 + Math.random() * 0.6,
          phase: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.35 + Math.random() * 1.4,
          tint: Math.random(),
        };
      });
    }

    draw(sceneTime, parallax, allowMotion) {
      const context = this.context;
      if (!context || !this.width || !this.height) return;

      context.clearRect(0, 0, this.width, this.height);

      for (const star of this.stars) {
        const travel = allowMotion ? sceneTime * (1.2 + star.depth * 3.8) : 0;
        const x = wrap(
          star.x * this.width - travel - parallax.x * star.depth * 12,
          this.width,
        );
        const y = wrap(
          star.y * this.height - parallax.y * star.depth * 7,
          this.height,
        );
        const twinkle = allowMotion
          ? 0.82 + Math.sin(sceneTime * star.twinkleSpeed + star.phase) * 0.18
          : 0.9;

        context.globalAlpha = star.alpha * twinkle;
        context.fillStyle = star.tint > 0.9
          ? "#b9e6ff"
          : star.tint < 0.08
            ? "#e3d8ff"
            : "#ffffff";

        if (star.radius < 0.85) {
          context.fillRect(x, y, star.radius, star.radius);
        } else {
          context.beginPath();
          context.arc(x, y, star.radius, 0, Math.PI * 2);
          context.fill();
        }
      }

      context.globalAlpha = 1;
    }

    clear() {
      if (this.context) {
        this.context.clearRect(0, 0, this.width, this.height);
      }
    }
  }

  class AmbientSpaceScene {
    constructor(ship, canvas) {
      this.ship = ship;
      this.starfield = new Starfield(canvas);
      this.engineGlows = ship
        ? Array.from(ship.querySelectorAll("[data-engine-glow], .engine-glow, .engine"))
        : [];

      this.pointer = { x: 0, y: 0 };
      this.pointerTarget = { x: 0, y: 0 };
      this.course = { x: 0, y: 0, roll: 0 };
      this.courseTarget = { x: 0, y: 0, roll: 0 };
      this.sceneTime = 0;
      this.nextCourseAt = 3 + Math.random() * 3;
      this.lastFrameTime = 0;
      this.frameId = 0;
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
      this.reducedMotion = Boolean(this.motionPreference && this.motionPreference.matches);

      this.originalShipTransform = ship ? ship.style.transform : "";
      this.originalEngineOpacity = this.engineGlows.map((engine) => engine.style.opacity);

      this.onFrame = this.onFrame.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.onPointerMove = this.onPointerMove.bind(this);
      this.onPointerReset = this.onPointerReset.bind(this);
      this.onTouchMove = this.onTouchMove.bind(this);
      this.onMotionPreferenceChange = this.onMotionPreferenceChange.bind(this);

      this.addListeners();
      this.starfield.resize();
      this.renderStill();
      this.startLoop();
    }

    get hasVisuals() {
      return Boolean(this.ship || this.starfield.context);
    }

    addListeners() {
      window.addEventListener("resize", this.onResize, { passive: true });
      document.addEventListener("visibilitychange", this.onVisibilityChange);

      if ("PointerEvent" in window) {
        window.addEventListener("pointermove", this.onPointerMove, { passive: true });
        window.addEventListener("pointercancel", this.onPointerReset, { passive: true });
        window.addEventListener("pointerup", this.onPointerReset, { passive: true });
        document.documentElement.addEventListener("pointerleave", this.onPointerReset, { passive: true });
      } else {
        window.addEventListener("mousemove", this.onPointerMove, { passive: true });
        window.addEventListener("touchmove", this.onTouchMove, { passive: true });
        window.addEventListener("touchend", this.onPointerReset, { passive: true });
        window.addEventListener("touchcancel", this.onPointerReset, { passive: true });
        document.documentElement.addEventListener("mouseleave", this.onPointerReset, { passive: true });
      }

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

      if ("PointerEvent" in window) {
        window.removeEventListener("pointermove", this.onPointerMove);
        window.removeEventListener("pointercancel", this.onPointerReset);
        window.removeEventListener("pointerup", this.onPointerReset);
        document.documentElement.removeEventListener("pointerleave", this.onPointerReset);
      } else {
        window.removeEventListener("mousemove", this.onPointerMove);
        window.removeEventListener("touchmove", this.onTouchMove);
        window.removeEventListener("touchend", this.onPointerReset);
        window.removeEventListener("touchcancel", this.onPointerReset);
        document.documentElement.removeEventListener("mouseleave", this.onPointerReset);
      }

      if (this.motionPreference) {
        if (typeof this.motionPreference.removeEventListener === "function") {
          this.motionPreference.removeEventListener("change", this.onMotionPreferenceChange);
        } else if (typeof this.motionPreference.removeListener === "function") {
          this.motionPreference.removeListener(this.onMotionPreferenceChange);
        }
      }
    }

    onPointerMove(event) {
      if (this.reducedMotion || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return;
      }

      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      this.pointerTarget.x = clamp((event.clientX / width) * 2 - 1, -1, 1);
      this.pointerTarget.y = clamp((event.clientY / height) * 2 - 1, -1, 1);
    }

    onTouchMove(event) {
      if (event.touches && event.touches[0]) {
        this.onPointerMove(event.touches[0]);
      }
    }

    onPointerReset(event) {
      if (!event || event.type === "pointerleave" || event.pointerType !== "mouse") {
        this.pointerTarget.x = 0;
        this.pointerTarget.y = 0;
      }
    }

    onResize() {
      this.starfield.resize();
      if (!this.frameId) this.renderStill();
    }

    onVisibilityChange() {
      if (document.hidden) {
        this.stopLoop();
      } else if (!this.manuallyPaused) {
        this.startLoop();
      }
    }

    onMotionPreferenceChange(event) {
      this.reducedMotion = event.matches;
      this.pointer.x = 0;
      this.pointer.y = 0;
      this.pointerTarget.x = 0;
      this.pointerTarget.y = 0;

      if (this.reducedMotion) {
        this.stopLoop();
        this.renderStill();
      } else if (!this.manuallyPaused && !document.hidden) {
        this.startLoop();
      }
    }

    chooseNewCourse() {
      this.courseTarget.x = (Math.random() - 0.5) * 18;
      this.courseTarget.y = (Math.random() - 0.5) * 11;
      this.courseTarget.roll = (Math.random() - 0.5) * 2.8;
      this.nextCourseAt = this.sceneTime + 4.5 + Math.random() * 6;
    }

    update(deltaSeconds) {
      this.sceneTime += deltaSeconds;

      if (this.sceneTime >= this.nextCourseAt) {
        this.chooseNewCourse();
      }

      const pointerEase = 1 - Math.exp(-deltaSeconds * 3.2);
      const courseEase = 1 - Math.exp(-deltaSeconds * 0.55);
      this.pointer.x += (this.pointerTarget.x - this.pointer.x) * pointerEase;
      this.pointer.y += (this.pointerTarget.y - this.pointer.y) * pointerEase;
      this.course.x += (this.courseTarget.x - this.course.x) * courseEase;
      this.course.y += (this.courseTarget.y - this.course.y) * courseEase;
      this.course.roll += (this.courseTarget.roll - this.course.roll) * courseEase;
    }

    render(allowMotion) {
      const time = allowMotion ? this.sceneTime : 0;
      const parallax = allowMotion ? this.pointer : { x: 0, y: 0 };
      this.starfield.draw(time, parallax, allowMotion);

      if (!this.ship) return;

      const floatX = allowMotion ? Math.sin(time * 0.37) * 5.5 : 0;
      const floatY = allowMotion ? Math.sin(time * 0.58 + 0.8) * 7.5 : 0;
      const floatRoll = allowMotion ? Math.sin(time * 0.31 + 1.1) * 0.6 : 0;
      const x = floatX + this.course.x + parallax.x * 12;
      const y = floatY + this.course.y + parallax.y * 8;
      const roll = floatRoll + this.course.roll + parallax.x * 0.7;
      const engineFlicker = allowMotion
        ? clamp(
          0.72 +
          Math.sin(time * 25) * 0.12 +
          Math.sin(time * 43 + 1.4) * 0.08 +
          Math.sin(time * 91 + 0.2) * 0.035,
          0.48,
          0.98,
        )
        : 0.72;

      this.ship.style.setProperty("--ship-x", `${x.toFixed(2)}px`);
      this.ship.style.setProperty("--ship-y", `${y.toFixed(2)}px`);
      this.ship.style.setProperty("--ship-roll", `${roll.toFixed(2)}deg`);
      this.ship.style.setProperty("--engine-flicker", engineFlicker.toFixed(3));
      this.ship.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${roll.toFixed(2)}deg)`;

      for (const engine of this.engineGlows) {
        engine.style.setProperty("--engine-flicker", engineFlicker.toFixed(3));
        engine.style.opacity = engineFlicker.toFixed(3);
      }
    }

    renderStill() {
      this.starfield.resize();
      this.render(false);
    }

    onFrame(timestamp) {
      this.frameId = 0;
      if (this.destroyed || this.manuallyPaused || this.reducedMotion || document.hidden) return;

      const deltaSeconds = this.lastFrameTime
        ? clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.05)
        : 0;
      this.lastFrameTime = timestamp;
      this.update(deltaSeconds);
      this.render(true);
      this.frameId = this.requestFrame(this.onFrame);
    }

    startLoop() {
      if (
        this.destroyed ||
        this.frameId ||
        this.manuallyPaused ||
        this.reducedMotion ||
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
      if (this.reducedMotion) {
        this.renderStill();
      } else {
        this.startLoop();
      }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.stopLoop();
      this.removeListeners();
      this.starfield.clear();

      if (this.ship) {
        this.ship.style.transform = this.originalShipTransform;
        this.ship.style.removeProperty("--ship-x");
        this.ship.style.removeProperty("--ship-y");
        this.ship.style.removeProperty("--ship-roll");
        this.ship.style.removeProperty("--engine-flicker");
      }

      this.engineGlows.forEach((engine, index) => {
        engine.style.opacity = this.originalEngineOpacity[index];
        engine.style.removeProperty("--engine-flicker");
      });
    }
  }

  function initialise() {
    const existingScene = window.SpacePiratesAmbient;
    if (existingScene && typeof existingScene.destroy === "function") {
      existingScene.destroy();
    }

    const ship = document.getElementById("spaceship");
    const canvas = document.getElementById("starfield");
    const scene = new AmbientSpaceScene(ship, canvas);

    window.SpacePiratesAmbient = {
      pause: () => scene.pause(),
      resume: () => scene.resume(),
      destroy: () => scene.destroy(),
      redraw: () => scene.onResize(),
      get paused() {
        return scene.manuallyPaused || scene.reducedMotion || document.hidden;
      },
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
