import { VoyageScene } from "./voyage.js?v=engagement-1";
import { BoardingController } from "./boarding-controller.js?v=helm-return-1";
import { CREW } from "./boarding-combat.js?v=helm-return-1";

(() => {
  "use strict";

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
    const battle = new BoardingController(scene);

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
      exit: () => battle.exit(),
      reset: () => battle.reset(),
      getCargo: () => ({ ...battle.cargo }),
      destroy: () => battle.destroy(),
      config: CREW,
      getState: () => battle.getState(),
      pause: () => battle.togglePause(true),
      resume: () => battle.togglePause(false),
      stopLoop: () => battle.stopLoop(),
      update: (dt) => battle.update(dt),
      redraw: () => battle.render(),
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise, { once: true });
  } else {
    initialise();
  }
})();
