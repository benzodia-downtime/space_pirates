# Space Pirates

Space Pirates is an engine-free browser game prototype built with plain HTML, CSS, and JavaScript. Pilot the Nautilus through deep space, scan for hostile ships, board them, defeat their crew, and return with recovered supplies. Voyage graphics use Three.js/WebGL 2; the game rules and interface remain plain JavaScript, with no full game engine.

## Run locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm ci
npm start
```

Then open [http://localhost:4173](http://localhost:4173) in a browser. To use a different port, set the `PORT` environment variable before starting the server.

## Controls and game loop

- Set a persistent course with the on-screen control pad, `WASD`, or the arrow keys.
- Use **SCAN** or the space bar to accelerate long-range contact detection.
- Approach the enemy bow and hold its forward bulkhead in the central reticle.
- At 90 m, maintain alignment until **강습 돌입** is enabled, then click it (or press Space) to commit. Nothing rams automatically.
- The helm locks for ram deployment → accelerating frontal charge → contact hit-stop and penetration → claw lock → sealing and pressure equalization. The entire sequence stays in the cockpit.
- Select **적함 돌입** after the inner door opens. Use **SFX ON/OFF** to toggle the procedural ship-interior sounds.
- Win the boarding action, collect the enemy ship's supplies, and return to begin a new search.

The voyage is a real perspective 3D scene. The enemy presents its bow, not a side airlock. A hollow breaching ram tears apart the forward armour panels, seats inside the opening, and deploys mechanical claws. A short sealed passage connects our foredeck to a point inside the damaged hull. Only this local entry point is destroyed; the ship remains available to board and loot. Crew combat remains top-down 2D.

One 3D world unit is one metre (equivalent to 100 Unreal units in crew combat). The range readout describes the foredeck-to-bow gap and switches to penetration depth after contact. Mobile rendering caps pixel density and uses simple shared/instanced geometry. A WebGL 2 browser is required; unsupported/interrupted graphics show a recovery message.

Reduced motion removes collision shake, flash, star streaks and flying debris while preserving the readable stage sequence. Audio starts only after a user gesture and stops on pause, hidden tabs, GPU interruption or mute. Simulation-time cutscenes cannot advance while paused or hidden; steering stays latched before commitment and unlocks on the next search.

Dependencies are pinned in `package-lock.json`. The build copies Three.js and its MIT license into `dist/vendor/`, so the deployed game has no third-party CDN dependency.

## Project structure

- `src/main.js`: crew combat and scene integration
- `src/voyage.js`: persistent steering, search, assault UI and lifecycle
- `src/assault.js`: deterministic frontal-assault state machine
- `src/voyage-renderer.js`: 3D bow, breakable armour, ram, claws and passage
- `src/assault-audio.js`: gesture-unlocked procedural ship-interior effects
- `scripts/build-static.mjs`: static deployment build
- `scripts/verify-3d.mjs`: browser regression tests
- `tests/assault.test.mjs`: deterministic sequence tests

## Validate

`npm test` builds the deployment into `dist/`, checks syntax, and runs the assault-state tests.

With the local server running, use `npm run test:e2e` for the full approach, ram, boarding, combat and loot loop. Use `npm run test:e2e -- --mobile` for touch input and high-density mobile rendering. Both runs check desktop/portrait/landscape layouts, passage attachment, helm locking, paused charge, persistent steering, reduced motion and graphics recovery. Screenshots go to ignored `qa-output/`.

Browser tests require Node.js 20+ and use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` first. Pass a URL or set `QA_URL` to test the build or deployed site, for example `node scripts/verify-3d.mjs http://localhost:4173/dist/ --mobile`.
