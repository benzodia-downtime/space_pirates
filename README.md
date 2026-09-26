# Space Pirates

Space Pirates is an engine-free browser game prototype built with plain HTML, CSS, and JavaScript. Pilot the Nautilus through deep space, discover hostile ships, board them, defeat their crew, and return with recovered supplies. Voyage graphics use Three.js/WebGL 2; the game rules and interface remain plain JavaScript, with no full game engine.

## Run locally

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm ci
npm start
```

Then open [http://localhost:4173](http://localhost:4173) in a browser. To use a different port, set the `PORT` environment variable before starting the server.

## Cockpit engagement presentation

New searches start stationary at 540 m with the enemy presented three-quarter-on. The normal 440 m identification threshold, flight speeds, weapon damage and boarding requirements are unchanged. Freight modules, warm window bays, maintenance doors, railings and engine exhaust give the hull scale as you pass it.

All three turrets open physical shutters, light their charging rails, recoil and cool down. Amber tracking still becomes a red, frozen firing solution. Real rounds have a bright core and a longer luminous wake. A closest pass between 6 and 22 m produces one directional canopy reflection and stereo rush per salvo; approaching rounds and hits do not produce a dodge cue. This feedback does not move the camera, change aim or grant invulnerability.

Rear hits bend the struck plate and emit metal chips/sparks. Scars persist; the sixth hit still strips the outer armor and exposes the harpoon mount. Non-vulnerable hull hits leave scorch marks but do not weaken the rear armor. Scars and particles are bounded and instanced. Reduced motion removes the transient glints, wakes, recoil and fragments while preserving readable physical telegraphs and damage. SFX remains gesture-unlocked and controlled by Settings.

Verification: `node --test tests/*.test.mjs`, `node scripts/verify-engagement.mjs`, `node scripts/verify-defense.mjs`, `node scripts/verify-siege.mjs`, and `node scripts/verify-boarding.mjs` against a running local build. The engagement check also accepts a deployed base URL and captures desktop/mobile arrival, charge, incoming round, near miss, armor impact and hull-pass screenshots.

## Controls and game loop

- **Mobile:** left pad up/down moves forward/reverse and left/right strafes in the current view; drag the empty right half of the screen to turn. On desktop, drag the empty view with the mouse. Looking never translates the ship, and releasing/regripping never resets heading.
- **PC:** W/S or Up/Down forward/reverse, A/D or Left/Right strafe. There is no independent vertical strafe; Space/Ctrl no longer move the ship. Pitch the view and advance to change altitude. Shift performs a short dodge, T toggles view tracking, O toggles optional orbit, and F triggers the contextual harpoon/pull/board action. Space is no longer a weapon/action shortcut. Focused buttons keep native Space/Enter accessibility.
- **회피 / Shift:** boost in the current movement direction (right if idle), 110 m/s for 0.22 seconds with a 1.2-second cooldown. Direction is latched at activation, diagonal inputs are normalized, and there is **no invulnerability**. Ordinary lateral thrust is 32 m/s. A second thumb can trigger dodge/harpoon while the left pad remains held; touch actions run on pointer-down without a duplicate compatibility click.
- **시선 추적 / T:** once a contact is identified, centre the view on its hull and keep that bearing during manual translation. It never moves the ship, engages orbit, discovers a hidden ramp, or aims at a weak point. Right-side dragging adjusts a persistent manual aim offset. Switching tracking off preserves the exact current view.
- Start stationary. Push the pad up / **W / Up** to move forward and down / **S / Down** to reverse along the current heading. Separate thrust buttons have been removed. Releasing stops immediately; no momentum or automatic cruise. Opposite inputs cancel. The left pad supports simultaneous right-thumb looking, firing or dodging.
- Contacts are identified automatically as you navigate. There is no manual sensor pulse or scan shortcut. Approach distance changes only with actual movement; waiting cannot pull a ship closer.
- Manual thrust cancels orbit and takes over from the current position. Focus loss, pointer cancellation, pause and new searches clear held input. After the harpoon attaches, forward/reverse and orbit are locked; pad left/right and A/D translate sideways for ram alignment; view dragging remains available until impact so vertical aim errors cannot leave the ship stuck. Pad forward/reverse stays locked by the cable.
- After contact, **자동 선회 / O** starts or stops target-centred autopilot at the current target distance. Movement input overrides orbit from the current position; the reverse button and Q shortcut are removed. Orbit angular speed is 0.095 rad/s (half the previous speed). The enemy also physically orbits the player; the cockpit and enemy have independent world-space movement. Below **120 m from the enemy centre**, orbit is unavailable (button and keyboard). An amber message asks you to reverse beyond that clearance.
- Autopilot is an optional exploration aid, not the default combat control. Its view follows the hull; right-side dragging can adjust aim while orbit continues. The left pad, movement keys or dodge stop orbit and immediately hand control back to manual flight. Restarting orbit preserves the new position and distance.
- The upper-right radar's red contact includes a pitch correction: **↑ 12°** means aim 12 degrees upward, **↓ 12°** downward, and **0°** vertically aligned. It follows the current view and position; labels flip inward at the radar rim and clear when a new search begins.
- Hull durability is separate from crew HP: 100 hull, 25 damage per salvo. Overlapping rounds from one fan can damage only once. Four physical foredeck lamps and edge damage tint replace an extra HUD panel. At zero hull, **다시 도전** at the bottom restores hull and restarts at 440 m. Pause/settings freeze AI and projectiles. A lodged harpoon stops enemy orbit/yaw and prevents new attacks. An amber-charging or red-locked gun finishes exactly its current salvo at its last aim point, and already-fired rounds continue flying and dealing damage. No further attack starts while tethered or boarding; releasing a failed tether restores normal defence.
- Find the **rear drop-down cargo ramp**, between the two engines, recessed inside a raised deck frame and sealed with six brass-colored plates. Use the fixed cockpit crosshair and the actual 3D hull: there are no target circles, squares, or entry-marker overlays. The rear structure is identified only after you see it.
- **포격 / R / right mouse button:** hold to fire the visible ship cannon along the crosshair. Mobile movement and firing work with separate fingers. Three rounds per magazine, 0.45 seconds between rounds, automatic 3.5-second reload, 320 m/s unguided projectiles, 220 m range. Each valid rear-armor hit deals 20 damage against 120 armor: six hits / two magazines. Front, side and deck-frame hits ricochet; rounds cannot pass through the hull. Cracks, impact scars and detached plates replace an armor-health HUD.
- Armor damage persists through retreat, evasion, orbit and failed rams. Destroying the outer plates exposes cyan-lit inner anchor rails, but **does not stop enemy fire or open the inner ramp**. The first cannon hit can also provoke an unidentified ship. A new search/retry restores armor and the player magazine.
- Only after the armor is gone, while orbiting or stopped, aim at the inner ramp and select **작살 발사 / F**. There is no orbit-stop requirement. A ray must hit the visible inner ramp from a near-rear angle, without clipping the surrounding deck frame. Looking at the ship's centre from the front cannot succeed. Harpoon attachment suppresses new attacks but cannot cancel a prepared salvo; the separate ram tears the remaining inner ramp.
- Orbit continues while the harpoon flies. On impact, the cable anchors and automatically stops orbit at the current position; orbit cannot restart while anchored or pulling. A **separate** press of **견인 돌입 / F** deploys the ram and rapidly reels the ship along the cable.
- During the 2.4-second charge, use pad left/right or A/D plus view dragging to put the actual door centre under the crosshair. Tether alignment offsets persist into the charge; releasing the pad does not auto-centre the ship. Lateral corrections are limited to 14 m; no vertical translation is bound. A centred impact (within 1.35 m) breaches immediately. A glancing impact (up to 5.5 m) costs 10 hull and jams: hold a corrected line for 0.35 seconds to free it. A full miss costs 20 hull, rebounds to an 80 m foredeck gap, releases the harpoon and allows another approach without resetting hull or discovery.
- Contact hit-stop → torn ramp → claw lock → sealing and pressure equalization stay in the cockpit. The tether retracts when the outer ramp ruptures.
- Select **조종석에서 일어나기** after the inner door opens. The forward breach is below the helm. Walk down the companionway into the lower airlock, across the sealed bridge and into the enemy hold. Open **설정 → 효과음 (SFX)** to turn procedural effects on/off.
- Killing the guard does not end boarding. Approach the fallen body and press **E / 시신 수색** to carry its supplies. Walk back while alive and pull the physical **분리 레버** in your lower airlock to bank supplies and disconnect. The bridge retracts and the fixed ship-side hatch closes; you stay on foot downstairs. Walk upstairs to the right-hand pilot seat and press **E / 조종석에 앉기** to switch to the cockpit view. You may retreat without killing anyone or taking loot.

One 3D world unit is one metre (100 Unreal units in crew combat). Orbit and tether distances use metres internally; the removed distance/status panels stay hidden. The initial contact is 540 m away and is rendered from the start, independently of sensor identification. The camera's existing 18 km far plane stays in place; approaching changes the hull's apparent size through perspective, not an appearance threshold. Ordinary thrust slows inside 300 m, and a safety stop outside the hull prevents accidental penetration. Move forward/back to set the orbit distance; only the explicit harpoon assault can breach the hull. The defender alternates a 4-second slow yaw (0.04 rad/s) with a 6-second heading hold. Detection/engagement remains at 440 m; active turrets can track and fire out to 1,200 m (previously 600 m). Enemy rounds last 6 seconds at 220 m/s so they physically reach that range. The enemy orbits the player horizontally at up to 0.035 rad/s, capped at 12 m/s, preserving current separation rather than forcing a fixed radius. Forward movement still closes the gap, and the enemy does not automatically face the player, leaving its rear accessible. The player cannon keeps its 220 m range. Its bow cannon, raised dorsal turret and new raised stern turret share one firing cycle; the dorsal turret covers all 360 degrees of azimuth and elevates toward high targets. The ship's own hull/bridge can block a firing line, especially directly underneath. The selected gun charges amber for 1.8 seconds, locks a red world-space aim line for 1.2 seconds, then fires a non-homing bolt. Aiming selects the bow gun in its forward arc, the stern gun in its rear arc, and the dorsal turret for side or high targets; a red-locked shot keeps its original gun and aim point. Leaving range or entering hull cover during tracking cancels the charge, but cannot cancel an already locked shot.

Reduced motion removes collision shake, flash, star streaks and debris, but not player-requested orbital navigation. Sound needs a user gesture. Pause, a hidden tab or GPU interruption freezes simulation time. Pointer cancellation/window blur release input without resetting the view. A new search clears the tether, discovery and damage state.

All voyage information panels, metrics, progress bars and large assault banners are removed. Only the pitch radar remains at the upper right. Compact view-tracking, dodge, orbit and harpoon → tether-pull → board actions share a bottom control dock with the four-direction movement pad and settings. The dock stays within the bottom 35% of the tested screens. Mobile screens use two compact rows; short landscape places its clearance notice between the lower-row controls. The too-close orbit warning is the only transient notice, inside the bottom dock. Safe-area insets protect controls around notches, and touch targets remain at least 44 px.

Mobile rendering caps pixel density and uses shared/instanced geometry. A WebGL 2 browser is required; unsupported/interrupted graphics show a recovery message.

Dependencies are pinned in `package-lock.json`. The build copies Three.js and its MIT license into `dist/vendor/`, so the deployed game has no third-party CDN dependency.

## TPS boarding combat

The ready breach lets the player leave the elevated cockpit and walk continuously through their own ship, down a 4 m companionway, through the lower airlock and an 8 m bridge into the hostile hold. Both human crew members are original articulated low-poly models with procedural idle breathing, blended walking/running/crouching, aiming, recoil, reload, hit reactions and a timed fall. No external character download or paid asset is required. This is a first TPS prototype, not a full Gears-style wall-attachment/cover system.

- PC: WASD/arrows move relative to the view, hold right mouse and drag to aim, hold left mouse or F to fire, R reloads, C toggles crouch, Shift runs, Escape pauses. Right aim and left fire work simultaneously. Buttons also support keyboard activation.
- Mobile: left pad moves, right-side drag turns the view, hold **사격** to fire. **정밀 조준** narrows the shoulder camera; **몸 낮추기** lowers the crew member behind low cargo. Independent touch pointers allow movement, looking and shooting together.
- Player health 100, enemy health 50, damage 10 for both, range 20 m. Rifle magazine 8, shot interval 0.24 s, reload 1.6 s. Damage requires a real crosshair/muzzle line of sight, never automatic exchanges. The enemy moves/flanks between shots, shows an amber aim line, then locks a red line before firing; moving after lock can evade it.
- Cargo physically blocks movement and shots. Crouching behind low cover protects the player; camera-boom collision prevents looking through walls. The shoulder offset adapts to narrow portrait screens. Viewport buttons stay at least 44 px. The existing SFX preference also controls rifle sounds; reduced motion removes flash and camera recoil.
- Pause, background tabs and focus loss clear held inputs and freeze combat. There is no instant withdrawal menu or automatic victory after killing the guard. **E** or the contextual mobile button searches the corpse once for fuel ×2 / ammunition ×1 / medical ×1. Carried loot banks once on completed disconnection, not again on seating. The lever retracts the bridge, then closes the fixed hatch; movement, bullets and the shoulder camera cannot cross the closed hatch. Waiting never teleports the player: walk back upstairs and explicitly sit at the pilot seat to resume piloting.
- Empty-handed withdrawal with a living enemy is also a success. Crew death is defeat: carried loot is lost, previously banked cargo is retained, and the player automatically returns to the cockpit. The breach remains connected; leaving the helm again restores player HP to 100 without recreating the enemy or duplicating looted corpses. The voyage renderer is paused while walking aboard.

Run `npm run test:boarding` with the local server for desktop/mobile real-input tests: upper helm, stairs, both bridge thresholds, crew joints, movement/look, mouse/touch chords, five-hit kill without auto-victory, corpse loot, physical return/disconnect, empty retreat, death/helm respawn, pause and five viewport layouts. Screenshots are saved under ignored `qa-output/tps-*.png` and `qa-output/extraction-*.png`. Supply the deployed URL as the script's first argument to verify the live build. Original pixel sprites remain in `assets/` as unused source artwork.

## Project structure

- `src/main.js`: voyage/boarding scene integration
- `src/boarding-layout.js`: shared connected deck heights, openings, walls and physical lever location
- `src/boarding-combat.js`: deterministic 3D crew movement, shooting, cover and enemy AI
- `src/boarding-controller.js`: PC/touch input, HUD, pause, victory/loot/return
- `src/boarding-renderer.js`: cargo room, shoulder camera, shadows and gun effects
- `src/crew-rig.js`: original articulated human models and procedural animations
- `src/voyage.js`: relative steering, search, orbit/assault UI and lifecycle
- `src/enemy-defense.js`: player-centred enemy orbit, slow defensive yaw, telegraphed cannon, swept projectile hits and hull damage
- `src/player-cannon.js`: player magazine/reload, unguided rounds and shared rear armor/deck collision geometry
- `src/navigation.js`: world-space orbit, visibility/harpoon hit tests, relative helm math
- `src/assault.js`: deterministic harpoon / tether-pull / breach state machine
- `src/voyage-renderer.js`: 3D hull and rear ramp, cable, ram, claws and passage
- `src/assault-audio.js`: gesture-unlocked procedural ship-interior effects
- `scripts/build-static.mjs`: static deployment build
- `scripts/verify-3d.mjs`: browser regression tests
- `tests/assault.test.mjs`: deterministic sequence tests
- `tests/navigation.test.mjs`: orbit, occlusion, aiming, relative-drag regression tests

## Validate

`npm test` builds the deployment into `dist/`, checks syntax, and runs the assault, navigation, enemy-defense, player-cannon and TPS boarding tests.

With the local server running, use `npm run test:e2e` for the full orbit, discovery, harpoon, ram, boarding, combat and loot loop. Use `npm run test:e2e -- --mobile` for real touch-drag input and high-density mobile rendering. Both runs check the settings modal (pause/resume, keyboard focus, mobile touch targets and saved SFX preference), removal of the sensor-pulse shortcut, stationary startup, forward/reverse/release, pointer cancellation, autopilot takeover, pad re-gripping, occluded targets, manual takeover, firing during orbit, impact-time stop, separate shot/pull input, cruise/survey/too-close/docked panel overlap, aim-centre clearance and touch targets at seven desktop/tablet/portrait/landscape sizes, passage attachment, helm locking, paused charge, persistent steering, reduced motion and graphics recovery. Use `node scripts/verify-3d.mjs --layout-only` for the quick HUD-only matrix. Screenshots go to ignored `qa-output/`.

Browser tests require Node.js 20+ and use installed Microsoft Edge on Windows. On other platforms, run `npx playwright install chromium` first. Pass a URL or set `QA_URL` to test the build or deployed site, for example `node scripts/verify-3d.mjs http://localhost:4173/dist/ --mobile`.

Use `node scripts/verify-siege.mjs` for desktop/mobile real cannon input, two-magazine armor destruction, reverse/reload persistence, queued counterfire after attachment, ram completion, simultaneous touch movement/fire, input release, pause/reset, reduced motion and seven viewport layouts. It places a sealed enemy behind the fixture; no armor damage or weapon result is injected. Screenshots compare intact, cracked, exposed and boarded states. Pass the live URL as its first argument to verify deployment.

Use `node scripts/verify-defense.mjs` to verify desktop/mobile cannon telegraphs, real touch/keyboard evasions, hit/miss, defeat/retry and paused AI. `node scripts/verify-orbit3d.mjs` covers separate movement/look controls, tracking, cooldown, real two-finger dodge and simultaneous move/look, manual autopilot takeover, and firing a harpoon while orbiting.

The selected weapon alternates a focused shot with a nine-round horizontal fan. Their visible amber/red rays preview the firing pattern; pitching the view and moving/dodging forward out of its plane clears the fan. Hull yaw pauses while the shot is locked and during the 3.5-second reload, creating an opening to gain the stern. `verify-defense.mjs` also covers rendered fan rays, visible roof-turret rotation and actual hits from both sides/rear/above, post-harpoon queued salvos/no new attacks and touch alignment, clean/glancing/missed rams, pad recovery from a jam, rebound/retry, and compact layouts for the new states.
