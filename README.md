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
- Track the projected intercept marker, match the hostile ship's speed and rotation, then fire the port and starboard magnetic harpoons.
- Hold the target near the reticle while the winches pull both ships together, deploy the pressurized boarding bridge, and select **적함 돌입** once its airlock opens.
- Win the boarding action, collect the enemy ship's supplies, and return to begin a new search.

The voyage is a real perspective 3D scene viewed from inside the cockpit. A low-poly hostile frigate turns broadside during approach; its side airlock and two magnetic anchors are actual hull-local attachment points. Cables connect those anchors to our foredeck launchers. A telescoping, upright boarding passage meets the airlock, then the doors slide open after pressure equalization. Crew combat remains the existing top-down 2D encounter.

One 3D world unit is one metre (equivalent to 100 Unreal units in the crew-combat rules). The docking readout describes the hatch-to-hatch gap, not the ship-centre distance. Mobile rendering caps pixel density, instances repeated hull plates, and avoids shadows/post-processing. A WebGL 2-capable browser is required; unsupported or interrupted graphics contexts show an explicit recovery message. Reduced motion, latched steering and pause/resume are retained.

Dependencies are pinned in `package-lock.json`. The build copies Three.js and its MIT license into `dist/vendor/`, so the deployed game does not depend on a third-party CDN.

## Project structure

```text
.
├── index.html      Voyage, encounter, and battle structure
├── styles.css      Shared space and ship presentation
├── voyage.css      Navigation HUD, controls, and cockpit-view styling
├── battle.css      Top-down crew battle styling
├── assets/         Player and enemy crew sprites
├── src/
│   ├── main.js     Battle logic and scene integration
│   ├── voyage.js   Flight controls, scanning, and boarding state machine
│   └── voyage-renderer.js  3D ships, cockpit, anchors, bridge and projection
├── scripts/
│   └── build-static.mjs  Static deployment build
├── server.mjs      Dependency-free local static server
├── package.json    Project scripts and metadata
└── README.md       Project overview and usage
```

## Validate

Build the static deployment and run the syntax checks:

```sh
npm test
```

`npm test` runs `npm run build` and `npm run check`. The generated deployment is written to `dist/`.

With the local server running, use `npm run test:e2e` to drive the full boarding and loot loop in a headless browser. It also checks desktop/portrait/landscape controls, bridge attachment and orientation, persistent steering, pause, reduced motion, context restoration, and the unsupported-WebGL message. Screenshots go to ignored `qa-output/`. This developer test needs Node.js 20+ and uses installed Microsoft Edge on Windows; elsewhere run `npx playwright install chromium` first. Set `QA_URL` to test the built site or deployed address instead.
