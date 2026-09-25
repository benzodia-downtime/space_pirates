# Space Pirates

Space Pirates is an engine-free browser game prototype built with plain HTML, CSS, and JavaScript. Pilot the Nautilus through deep space, discover hostile ships, board them, defeat their crew, and return with recovered supplies. Voyage graphics use Three.js/WebGL 2; the game rules and interface remain plain JavaScript, with no full game engine.

## Run locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm ci
npm start
```

Then open [http://localhost:4173](http://localhost:4173) in a browser. To use a different port, set the `PORT` environment variable before starting the server.

## Controls and game loop

- Drag the steering pad to turn **relative to the current view**. Releasing or touching it again never resets your heading. A/D and the arrow keys also steer. **W/S now control translation, not pitch.**
- Start stationary. Hold **W / 전진** to move forward and **S / 후진** to reverse along the current heading. Releasing stops immediately; no momentum or automatic cruise. Opposite inputs cancel. Mobile buttons support simultaneous steering with another finger.
- Contacts are identified automatically as you navigate. There is no manual sensor pulse or scan shortcut. Approach distance changes only with actual movement; waiting cannot pull a ship closer.
- Manual thrust cancels orbit and takes over from the current position. Focus loss, pointer cancellation, pause and new searches clear held input. Movement is locked after the harpoon attaches.
- After contact, **자동 선회 / O** starts or stops target-centred autopilot at the current target distance. **반대 방향 / Q** reverses the orbit. The enemy remains fixed; the cockpit actually travels around it. Below **120 m from the enemy centre**, orbit is unavailable (button and keyboard). An amber message asks you to reverse beyond that clearance.
- The upper-right radar's red contact includes a pitch correction: **↑ 12°** means aim 12 degrees upward, **↓ 12°** downward, and **0°** vertically aligned. It follows the current view and position; labels flip inward at the radar rim and clear when a new search begins.
- Find the **rear drop-down cargo ramp**, between the two engines. Use the fixed cockpit crosshair and the actual 3D hull: there are no target circles, squares, or entry-marker overlays. The ramp is identified only after you see it.
- Stop orbiting, aim at the ramp, then select **작살 발사 / Space / F**. A ray must hit the visible ramp from a near-rear angle. Looking at the ship's centre from the front cannot succeed.
- The harpoon flies, anchors and holds position. A **separate** press of **견인 돌입 / Space** deploys the ram and rapidly reels the ship along the cable.
- Contact hit-stop → torn ramp → claw lock → sealing and pressure equalization stay in the cockpit. The tether retracts when the outer ramp ruptures.
- Select **적함 돌입** after the inner door opens. Open **설정 → 효과음 (SFX)** to turn procedural effects on/off. Settings pause navigation, release held controls and resume on close (or Escape). The sound preference is saved on this browser when storage is available.
- Win the unchanged top-down crew fight, collect supplies, and return to begin a new search.

One 3D world unit is one metre (100 Unreal units in crew combat). During exploration the HUD shows orbit radius, then the foredeck-to-anchor gap during tethered assault. The initial contact is about 1.1 km away and is rendered from the start, independently of sensor identification. The camera's existing 18 km far plane stays in place; approaching changes the hull's apparent size through perspective, not an appearance threshold. Ordinary thrust slows inside 300 m, and a safety stop outside the hull prevents accidental penetration. Move forward/back to set the orbit distance; only the explicit harpoon assault can breach the hull. Enemy evasive movement is not implemented.

Reduced motion removes collision shake, flash, star streaks and debris, but not player-requested orbital navigation. Sound needs a user gesture. Pause, a hidden tab or GPU interruption freezes simulation time. Pointer cancellation/window blur release input without resetting the view. A new search clears the tether, discovery and damage state.

All voyage information panels, metrics, progress bars and large assault banners are removed. Only the pitch radar remains at the upper right. Compact orbit/direction and harpoon → tether-pull → board actions share a bottom control dock with steering, thrust and settings. The dock stays within the bottom 35% of all tested screens throughout every assault stage. Portrait screens use two compact button rows; landscape uses one row. The too-close orbit warning is the only transient notice, inside the bottom dock. Safe-area insets protect controls around notches, and touch targets remain at least 44 px.\n\nMobile rendering caps pixel density and uses shared/instanced geometry. A WebGL 2 browser is required; unsupported/interrupted graphics show a recovery message.

Dependencies are pinned in `package-lock.json`. The build copies Three.js and its MIT license into `dist/vendor/`, so the deployed game has no third-party CDN dependency.

## Project structure

- `src/main.js`: crew combat and scene integration
- `src/voyage.js`: relative steering, search, orbit/assault UI and lifecycle
- `src/navigation.js`: fixed-world orbit, visibility/harpoon hit tests, relative helm math
- `src/assault.js`: deterministic harpoon / tether-pull / breach state machine
- `src/voyage-renderer.js`: 3D hull and rear ramp, cable, ram, claws and passage
- `src/assault-audio.js`: gesture-unlocked procedural ship-interior effects
- `scripts/build-static.mjs`: static deployment build
- `scripts/verify-3d.mjs`: browser regression tests
- `tests/assault.test.mjs`: deterministic sequence tests
- `tests/navigation.test.mjs`: orbit, occlusion, aiming, relative-drag regression tests

## Validate

`npm test` builds the deployment into `dist/`, checks syntax, and runs the assault and navigation tests.

With the local server running, use `npm run test:e2e` for the full orbit, discovery, harpoon, ram, boarding, combat and loot loop. Use `npm run test:e2e -- --mobile` for real touch-drag input and high-density mobile rendering. Both runs check the settings modal (pause/resume, keyboard focus, mobile touch targets and saved SFX preference), removal of the sensor-pulse shortcut, stationary startup, forward/reverse/release, pointer cancellation, autopilot takeover, pad re-gripping, occluded targets, direction reversal, separate shot/pull input, cruise/survey/too-close/docked panel overlap, aim-centre clearance and touch targets at seven desktop/tablet/portrait/landscape sizes, passage attachment, helm locking, paused charge, persistent steering, reduced motion and graphics recovery. Use `node scripts/verify-3d.mjs --layout-only` for the quick HUD-only matrix. Screenshots go to ignored `qa-output/`.

Browser tests require Node.js 20+ and use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` first. Pass a URL or set `QA_URL` to test the build or deployed site, for example `node scripts/verify-3d.mjs http://localhost:4173/dist/ --mobile`.
