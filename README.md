# Space Pirates

Space Pirates is a minimal, browser-based ambient space scene: one lone spaceship drifts through a quiet starfield. It is built with plain HTML, CSS, and JavaScript, with no framework, game engine, build step, or runtime dependency.

## Run locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm start
```

Then open [http://localhost:4173](http://localhost:4173) in a browser. To use a different port, set the `PORT` environment variable before starting the server.

## Experience

There are no controls, objectives, combat systems, scores, or fail states. Space Pirates is designed as a passive visual: leave the page open and watch the ship drift through space. The scene adapts to the browser window.

## Project structure

```text
.
├── index.html      Page structure and scene elements
├── styles.css      Space, ship, and motion presentation
├── src/
│   └── main.js     Ambient animation and scene behavior
├── server.mjs      Dependency-free local static server
├── package.json    Project scripts and metadata
└── README.md       Project overview and usage
```

## Validate

Run the lightweight syntax checks:

```sh
npm test
```

`npm test` delegates to `npm run check` and checks both the local server and browser JavaScript with Node's built-in syntax checker.

