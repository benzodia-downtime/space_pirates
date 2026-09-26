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
- Manual thrust cancels orbit and takes over from the current position. Focus loss, pointer cancellation, pause and new searches clear held input. After the harpoon attaches, forward/reverse and orbit are locked; the pad and arrow keys instead translate the ship sideways/up/down for ram alignment.
- After contact, **자동 선회 / O** starts or stops target-centred autopilot at the current target distance. Direction changes use the pad or arrow keys; the reverse button and Q shortcut are removed. Orbit angular speed is 0.095 rad/s (half the previous speed). The enemy centre stays in place for this first encounter, but its hull deliberately yaws in response; the cockpit actually travels around it. Below **120 m from the enemy centre**, orbit is unavailable (button and keyboard). An amber message asks you to reverse beyond that clearance.
- While orbiting, the pad and arrow keys steer **orbital travel**, not just the camera: up/down travels over/under the enemy, left/right changes the lateral direction, and diagonals choose an inclined orbit. Releasing or regripping retains that 3D orbital plane and distance; it never levels back to horizontal. The view tracks the target smoothly even across the poles. Stop orbiting to resume manual aiming at the ramp.
- The upper-right radar's red contact includes a pitch correction: **↑ 12°** means aim 12 degrees upward, **↓ 12°** downward, and **0°** vertically aligned. It follows the current view and position; labels flip inward at the radar rim and clear when a new search begins.
- Hull durability is separate from crew HP: 100 hull, 25 damage per salvo. Overlapping rounds from one fan can damage only once. Four physical foredeck lamps and edge damage tint replace an extra HUD panel. At zero hull, **다시 도전** at the bottom restores hull and restarts at 220 m. Pause/settings freeze AI and projectiles. A lodged harpoon immediately stops enemy yaw and all counterfire, clearing aim warnings and flying enemy rounds. The ceasefire lasts through tethering, charging, a jam and boarding; a failed approach that releases the cable allows normal defence again.
- Find the **rear drop-down cargo ramp**, between the two engines. Use the fixed cockpit crosshair and the actual 3D hull: there are no target circles, squares, or entry-marker overlays. The ramp is identified only after you see it.
- While orbiting or stopped, aim at the ramp and select **작살 발사 / Space / F**. There is no orbit-stop requirement. A ray must hit the visible ramp from a near-rear angle. Looking at the ship's centre from the front cannot succeed.
- Orbit continues while the harpoon flies. On impact, the cable anchors and automatically stops orbit at the current position; orbit cannot restart while anchored or pulling. A **separate** press of **견인 돌입 / Space** deploys the ram and rapidly reels the ship along the cable.
- During the 2.4-second charge, use the pad or arrow keys to put the actual door centre under the crosshair. Tether alignment offsets persist into the charge; releasing the pad does not auto-centre the ship. Corrections are limited to 14 m per axis. A centred impact (within 1.35 m) breaches immediately. A glancing impact (up to 5.5 m) costs 10 hull and jams: hold a corrected line for 0.35 seconds to free it. A full miss costs 20 hull, rebounds to an 80 m foredeck gap, releases the harpoon and allows another approach without resetting hull or discovery.
- Contact hit-stop → torn ramp → claw lock → sealing and pressure equalization stay in the cockpit. The tether retracts when the outer ramp ruptures.
- Select **적함 돌입** after the inner door opens. Open **설정 → 효과음 (SFX)** to turn procedural effects on/off. Settings pause navigation, release held controls and resume on close (or Escape). The sound preference is saved on this browser when storage is available.
- Win the unchanged top-down crew fight, collect supplies, and return to begin a new search.

One 3D world unit is one metre (100 Unreal units in crew combat). Orbit and tether distances use metres internally; the removed distance/status panels stay hidden. The initial contact is about 1.1 km away and is rendered from the start, independently of sensor identification. The camera's existing 18 km far plane stays in place; approaching changes the hull's apparent size through perspective, not an appearance threshold. Ordinary thrust slows inside 300 m, and a safety stop outside the hull prevents accidental penetration. Move forward/back to set the orbit distance; only the explicit harpoon assault can breach the hull. The defender alternates a 4-second slow yaw (0.04 rad/s) with a 6-second heading hold. Its bow cannon and raised dorsal turret share one firing cycle; the dorsal turret covers all 360 degrees of azimuth and elevates toward high targets. The ship's own hull/bridge can block a firing line, especially directly underneath. The selected gun charges amber for 1.8 seconds, locks a red world-space aim line for 1.2 seconds, then fires a non-homing bolt. Aiming selects the bow gun in its forward arc and the dorsal turret for side, rear or high targets; a red-locked shot keeps its original gun and aim point. Leaving range or entering hull cover during tracking cancels the charge, but cannot cancel an already locked shot.

Reduced motion removes collision shake, flash, star streaks and debris, but not player-requested orbital navigation. Sound needs a user gesture. Pause, a hidden tab or GPU interruption freezes simulation time. Pointer cancellation/window blur release input without resetting the view. A new search clears the tether, discovery and damage state.

All voyage information panels, metrics, progress bars and large assault banners are removed. Only the pitch radar remains at the upper right. Compact orbit and harpoon → tether-pull → board actions share a bottom control dock with steering, thrust and settings. The dock stays within the bottom 35% of all tested screens throughout every assault stage. Portrait screens use two compact button rows; landscape uses one row. The too-close orbit warning is the only transient notice, inside the bottom dock. Safe-area insets protect controls around notches, and touch targets remain at least 44 px.

Mobile rendering caps pixel density and uses shared/instanced geometry. A WebGL 2 browser is required; unsupported/interrupted graphics show a recovery message.

Dependencies are pinned in `package-lock.json`. The build copies Three.js and its MIT license into `dist/vendor/`, so the deployed game has no third-party CDN dependency.

## Project structure

- `src/main.js`: crew combat and scene integration
- `src/voyage.js`: relative steering, search, orbit/assault UI and lifecycle
- `src/enemy-defense.js`: slow defensive yaw, telegraphed cannon, swept projectile hits and hull damage
- `src/navigation.js`: world-space orbit, visibility/harpoon hit tests, relative helm math
- `src/assault.js`: deterministic harpoon / tether-pull / breach state machine
- `src/voyage-renderer.js`: 3D hull and rear ramp, cable, ram, claws and passage
- `src/assault-audio.js`: gesture-unlocked procedural ship-interior effects
- `scripts/build-static.mjs`: static deployment build
- `scripts/verify-3d.mjs`: browser regression tests
- `tests/assault.test.mjs`: deterministic sequence tests
- `tests/navigation.test.mjs`: orbit, occlusion, aiming, relative-drag regression tests

## Validate

`npm test` builds the deployment into `dist/`, checks syntax, and runs the assault and navigation tests.

With the local server running, use `npm run test:e2e` for the full orbit, discovery, harpoon, ram, boarding, combat and loot loop. Use `npm run test:e2e -- --mobile` for real touch-drag input and high-density mobile rendering. Both runs check the settings modal (pause/resume, keyboard focus, mobile touch targets and saved SFX preference), removal of the sensor-pulse shortcut, stationary startup, forward/reverse/release, pointer cancellation, autopilot takeover, pad re-gripping, occluded targets, pad direction changes, firing during orbit, impact-time stop, separate shot/pull input, cruise/survey/too-close/docked panel overlap, aim-centre clearance and touch targets at seven desktop/tablet/portrait/landscape sizes, passage attachment, helm locking, paused charge, persistent steering, reduced motion and graphics recovery. Use `node scripts/verify-3d.mjs --layout-only` for the quick HUD-only matrix. Screenshots go to ignored `qa-output/`.

Browser tests require Node.js 20+ and use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` first. Pass a URL or set `QA_URL` to test the build or deployed site, for example `node scripts/verify-3d.mjs http://localhost:4173/dist/ --mobile`.

Use `node scripts/verify-defense.mjs` to verify desktop/mobile cannon telegraphs, real touch/keyboard evasions, hit/miss, defeat/retry and paused AI. `node scripts/verify-orbit3d.mjs` covers 3D pad steering and firing a harpoon while orbiting.

The selected weapon alternates a focused shot with a nine-round horizontal fan. Their visible amber/red rays preview the firing pattern; moving above or below the fan clears all its rounds. Hull yaw pauses while the shot is locked and during the 3.5-second reload, creating an opening to gain the stern. `verify-defense.mjs` also covers rendered fan rays, visible roof-turret rotation and actual hits from both sides/rear/above, post-harpoon ceasefire and touch alignment, clean/glancing/missed rams, pad recovery from a jam, rebound/retry, and compact layouts for the new states.
