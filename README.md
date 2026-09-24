# Space Pirates

Space Pirates is an engine-free browser game prototype built with plain HTML, CSS, and JavaScript. Pilot the Nautilus through deep space, scan for hostile ships, board them, defeat their crew, and return with recovered supplies. It has no framework or runtime dependency.

## Run locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm start
```

Then open [http://localhost:4173](http://localhost:4173) in a browser. To use a different port, set the `PORT` environment variable before starting the server.

## Controls and game loop

- Set a persistent course with the on-screen control pad, `WASD`, or the arrow keys.
- Use **SCAN** or the space bar to accelerate long-range contact detection.
- When a hostile ship is identified, select **전투 시작** to enter the top-down crew battle.
- Win the boarding action, collect the enemy ship's supplies, and return to begin a new search.

The voyage uses an engine-free perspective starfield framed by a first-person cockpit. The interface adapts to desktop and mobile screens and supports reduced-motion preferences.

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
│   └── voyage.js   Perspective flight, controls, scanning, and encounters
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
