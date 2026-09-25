import * as THREE from "../vendor/three.module.js";

const clamp = THREE.MathUtils.clamp;
const smoothstep = THREE.MathUtils.smoothstep;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// One world unit is one metre. Distances are measured hatch-to-hatch.
// Hull, hatch, anchors, cables and bridge all share this world and depth buffer.
export class VoyageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.available = false;
    this.destroyed = false;
    this.errorPanel = document.getElementById("renderer-error");
    this.width = 0;
    this.height = 0;
    this.resources = new Set();
    this.scratch = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.matrix = new THREE.Matrix4();
    this.lastFrame = null;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      this.showError("이 기기에서 3D 화면을 시작하지 못했습니다. WebGL 2를 지원하는 최신 브라우저와 하드웨어 가속을 확인해 주세요.");
      return;
    }

    this.renderer.setClearColor(0x02050c, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.15, 18000);
    this.camera.position.set(0, 0, 6);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0x93bfec, 0x19202e, 1.6));
    const key = new THREE.DirectionalLight(0xffd8ac, 3.3);
    key.position.set(-35, 65, 70);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x5caaff, 2.3);
    rim.position.set(45, 8, -60);
    this.scene.add(rim);

    this.boxGeometry = this.keep(new THREE.BoxGeometry(1, 1, 1));
    this.cylinderGeometry = this.keep(new THREE.CylinderGeometry(1, 1, 1, 8));
    this.materials = {
      hull: this.material(0x354354),
      panel: this.material(0x536474),
      dark: this.material(0x101a25),
      trim: this.material(0xc48539),
      door: this.material(0x7b8991),
      cyan: this.keep(new THREE.MeshBasicMaterial({ color: 0x7cddf1 })),
      amber: this.keep(new THREE.MeshBasicMaterial({ color: 0xffbc66 })),
      red: this.keep(new THREE.MeshBasicMaterial({ color: 0xfa6653 })),
    };
    this.enemy = new THREE.Group();
    this.enemy.name = "hostile-salvage-frigate";
    this.scene.add(this.enemy);
    this.makeEnemy();
    this.makePlayer();
    this.makeRig();
    this.makeStars();
    this.available = true;
    document.getElementById("space-scene")?.setAttribute("data-renderer", "webgl");
    this.onContextLost = (event) => {
      event.preventDefault();
      this.available = false;
      this.showError("3D 그래픽 연결이 일시 중단되었습니다. 복구를 기다리거나 새로고침해 주세요.");
    };
    this.onContextRestored = () => {
      if (this.destroyed) return;
      this.available = true;
      if (this.errorPanel) this.errorPanel.hidden = true;
      this.onRestore?.();
    };
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.resize();
  }

  keep(resource) { this.resources.add(resource); return resource; }

  material(color) {
    return this.keep(new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.32, flatShading: true }));
  }

  mesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  }

  box(parent, material, position, scale) {
    return this.mesh(parent, this.boxGeometry, material, position, scale);
  }

  // Static plates are instanced by material: hundreds of details, only a few draw calls.
  batchBoxes(parent, records) {
    for (const material of new Set(records.map((record) => record.material))) {
      const boxes = records.filter((record) => record.material === material);
      const batch = new THREE.InstancedMesh(this.boxGeometry, material, boxes.length);
      boxes.forEach(({ position, scale }, index) => {
        this.matrix.makeScale(...scale).setPosition(...position);
        batch.setMatrixAt(index, this.matrix);
      });
      batch.instanceMatrix.needsUpdate = true;
      parent.add(batch);
    }
  }

  label(parent, text, position, width, color = "#b5c7d2") {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.font = "bold 52px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 256, 48);
    const texture = this.keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = this.keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    return this.mesh(parent, this.keep(new THREE.PlaneGeometry(width, width * 96 / 512)), material, position);
  }

  makeEnemy() {
    const m = this.materials;
    const outline = new THREE.Shape();
    [[-48, -7], [-54, -2], [-49, 6], [-34, 9], [24, 7], [52, 1], [39, -7]].forEach(([x, y], i) => {
      if (i === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
    });
    outline.closePath();
    // A genuine opening through the hull, not a door image pasted over a solid box.
    const hole = new THREE.Path();
    hole.moveTo(0.8, -3.2);
    hole.lineTo(0.8, 3.2);
    hole.lineTo(7.2, 3.2);
    hole.lineTo(7.2, -3.2);
    hole.closePath();
    outline.holes.push(hole);
    const hull = this.keep(new THREE.ExtrudeGeometry(outline, { depth: 18, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.35, bevelThickness: 0.35, curveSegments: 1 }));
    hull.translate(0, 0, -9);
    this.mesh(this.enemy, hull, m.hull);

    const boxes = [];
    const plate = (material, position, scale) => boxes.push({ material, position, scale });
    for (const z of [-9.45, 9.45]) {
      for (const x of [-39, -27, -15, 19, 31]) {
        for (const y of [-3.6, 3.3]) {
          plate(m.panel, [x, y, z], [10.8, 5.3, 0.65]);
          plate(m.dark, [x, y - 1.4, z + Math.sign(z) * 0.4], [8.5, 0.3, 0.12]);
          for (const dx of [-4.3, 4.3]) plate(m.trim, [x + dx, y + 1.7, z + Math.sign(z) * 0.4], [0.22, 0.55, 0.18]);
        }
      }
      plate(m.trim, [-7, 6.3, z], [69, 0.65, 0.9]);
      plate(m.dark, [-15, -6.5, z], [54, 1, 1.1]);
      for (let x = -39; x < -18; x += 2.2) plate(m.dark, [x, 0, z + Math.sign(z) * 0.7], [0.7, 2, 0.4]);
    }
    plate(m.dark, [-24, 10, 0], [28, 4, 11]);
    plate(m.panel, [-20, 12.3, 0], [17, 1, 9]);
    plate(m.cyan, [-20, 10.6, 5.6], [12, 0.45, 0.12]);
    plate(m.dark, [-29, 17, 0], [0.45, 9, 0.45]);
    plate(m.red, [-29, 21.6, 0], [0.7, 0.7, 0.7]);
    plate(m.trim, [35, 1, 9.8], [2, 9, 0.7]);
    plate(m.dark, [-40, -8, 0], [18, 3, 23]);
    for (const z of [-10.5, 10.5]) {
      const engine = this.mesh(this.enemy, this.cylinderGeometry, m.dark, [-44, -5, z], [4.1, 21, 4.1]);
      engine.rotation.z = Math.PI / 2;
      const nozzle = this.mesh(this.enemy, this.cylinderGeometry, m.trim, [-54.7, -5, z], [3.6, 1.1, 3.6]);
      nozzle.rotation.z = Math.PI / 2;
      const core = this.mesh(this.enemy, this.cylinderGeometry, m.cyan, [-55.35, -5, z], [2.75, 0.2, 2.75]);
      core.rotation.z = Math.PI / 2;
    }

    // Airlock centre (4, 0, 10.3), with a recessed chamber and sliding leaves.
    this.hatch = new THREE.Object3D();
    this.hatch.position.set(4, 0, 10.3);
    this.enemy.add(this.hatch);
    plate(m.dark, [4, 0, -3], [10, 9, 0.5]);
    plate(m.panel, [4, 0, -2.7], [3.6, 4.5, 0.25]);
    plate(m.amber, [4, 2.4, -2.4], [3, 0.16, 0.1]);
    plate(m.dark, [4, -2.2, 4.5], [6.2, 0.3, 14]);
    for (const x of [0.9, 7.1]) plate(m.dark, [x, 0, 4], [0.2, 6.2, 14]);
    for (const x of [0.35, 7.65]) plate(m.trim, [x, 0, 10], [0.85, 7.6, 1.8]);
    for (const y of [-3.65, 3.65]) plate(m.trim, [4, y, 10], [8.1, 0.85, 1.8]);
    for (const x of [0.3, 7.7]) plate(m.amber, [x, 0, 11], [0.16, 5.4, 0.08]);
    for (const z of [0, 3, 6]) plate(m.cyan, [4, 2.8, z], [4.2, 0.15, 0.35]);
    this.doors = [-1, 1].map((side) => this.box(this.enemy, m.door, [4 + side * 1.52, 0, 9.85], [2.98, 6.1, 0.35]));
    this.hatchLamp = this.box(this.enemy, m.red.clone(), [4, 3.8, 11], [2.4, 0.2, 0.12]);
    this.keep(this.hatchLamp.material);
    this.label(this.enemy, "AIRLOCK 02", [4, 5, 10.1], 9, "#ffcb85");
    this.label(this.enemy, "MARAUDER / R-07", [-18, 3.2, 10], 21);

    this.anchors = [-7, 15].map((x) => {
      const mount = new THREE.Object3D();
      mount.position.set(x, -1.7, 10.3);
      this.enemy.add(mount);
      plate(m.dark, [x, -1.7, 9.9], [2.8, 3.2, 1.3]);
      const ring = this.mesh(mount, this.keep(new THREE.TorusGeometry(0.8, 0.16, 4, 8)), m.amber);
      ring.position.z = 0.45;
      return mount;
    });
    this.batchBoxes(this.enemy, boxes);
  }

  makePlayer() {
    const m = this.materials;
    this.player = new THREE.Group();
    this.camera.add(this.player);
    // Visible foredeck is part of our vessel; the view never switches to an exterior camera.
    this.box(this.player, m.hull, [0, -3.8, -8], [13, 1.5, 17]);
    this.box(this.player, m.dark, [0, -2.7, -5], [5.8, 0.55, 11]);
    this.box(this.player, m.panel, [0, -2.4, -14], [6.2, 0.7, 3]);
    this.box(this.player, m.trim, [0, -2.03, -13.9], [6, 0.08, 0.4]);
    for (const x of [-5.5, 5.5]) {
      this.box(this.player, m.panel, [x, -2.5, -9], [1.3, 1.4, 10]);
      this.box(this.player, m.cyan, [x, -1.76, -9], [0.14, 0.1, 8]);
    }
    this.launchers = [-4.7, 4.7].map((x) => {
      const launcher = new THREE.Object3D();
      launcher.position.set(x, -1.8, -13);
      this.player.add(launcher);
      this.box(launcher, m.dark, [0, -0.35, 1.4], [1.5, 1, 4]);
      this.box(launcher, m.trim, [0, 0, 0], [0.9, 0.7, 0.65]);
      return launcher;
    });
    this.playerHatch = new THREE.Object3D();
    this.playerHatch.position.set(0, 0, -14);
    this.player.add(this.playerHatch);
    this.canopy = new THREE.Group();
    this.camera.add(this.canopy);
    this.canopyBeams = Array.from({ length: 3 }, () => this.box(this.canopy, m.dark));
    this.canopyLights = Array.from({ length: 2 }, () => this.box(this.canopy, m.trim));
  }

  makeRig() {
    this.cables = this.anchors.map(() => this.mesh(this.scene, this.cylinderGeometry, this.materials.cyan));
    this.bridge = new THREE.Group();
    this.scene.add(this.bridge);
    this.bridgeFloor = this.box(this.bridge, this.materials.panel, [0, -2, 0]);
    this.bridgeRoof = this.box(this.bridge, this.materials.dark, [0, 2, 0]);
    const glass = this.keep(new THREE.MeshStandardMaterial({ color: 0x265268, transparent: true, opacity: 0.27, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    this.bridgeWalls = [-2.3, 2.3].map((x) => this.box(this.bridge, glass, [x, 0, 0]));
    this.bridgeRails = [-2.15, 2.15].map((x) => this.box(this.bridge, this.materials.cyan, [x, -1.6, 0]));
    this.bridgeRibs = Array.from({ length: 8 }, () => {
      const rib = new THREE.Group();
      this.bridge.add(rib);
      for (const x of [-2.4, 2.4]) this.box(rib, this.materials.trim, [x, 0, 0], [0.16, 4.2, 0.2]);
      for (const y of [-2, 2]) this.box(rib, this.materials.trim, [0, y, 0], [4.9, 0.16, 0.2]);
      return rib;
    });
    this.collar = new THREE.Group();
    this.scene.add(this.collar);
    for (const x of [-2.7, 2.7]) this.box(this.collar, this.materials.door, [x, 0, 0], [0.45, 5.6, 0.75]);
    for (const y of [-2.6, 2.6]) this.box(this.collar, this.materials.door, [0, y, 0], [5.8, 0.45, 0.75]);
  }

  makeStars() {
    const positions = new Float32Array(950 * 3);
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (Math.random() - 0.5) * 18000;
      positions[i + 1] = (Math.random() - 0.5) * 12000;
      positions[i + 2] = -Math.random() * 14000;
      const light = 0.45 + Math.random() * 0.5;
      colors.set([light * 0.84, light * 0.93, light], i);
    }
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = this.keep(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85 }));
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
    this.starOrigins = positions.slice();
  }

  resize() {
    if (!this.available) return;
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const ratio = Math.min(window.devicePixelRatio || 1, width <= 720 ? 1.5 : 1.75);
    if (width === this.width && height === this.height && ratio === this.renderer.getPixelRatio()) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 74 : 58;
    // Optical centre and HUD reticle agree, leaving room for the lower console.
    this.camera.setViewOffset(width, height, 0, height * 0.1, width, height);
    this.camera.updateProjectionMatrix();
    const halfHeight = 2.6 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfWidth = halfHeight * width / height;
    const top = halfHeight * 0.77;
    const bottom = -halfHeight * 1.28;
    this.barBetween(this.canopyBeams[0], new THREE.Vector3(-halfWidth, top, -2.6), new THREE.Vector3(halfWidth, top, -2.6), 0.13);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const start = new THREE.Vector3(halfWidth * 0.87 * side, top, -2.6);
      const end = new THREE.Vector3(halfWidth * 1.04 * side, bottom, -2.6);
      this.barBetween(this.canopyBeams[i + 1], start, end, 0.13);
      start.z += 0.08;
      end.z += 0.08;
      this.barBetween(this.canopyLights[i], start, end, 0.018);
    }
  }

  barBetween(mesh, start, end, thickness, cylindrical = false) {
    const direction = this.scratch.subVectors(end, start);
    mesh.position.copy(start).addScaledVector(direction, 0.5);
    mesh.scale.set(thickness, Math.max(0.001, direction.length()), thickness);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.normalize());
    if (cylindrical) mesh.scale.x = mesh.scale.z = thickness;
  }

  project(position) {
    const projected = position.clone().project(this.camera);
    return { x: (projected.x + 1) * 50, y: (1 - projected.y) * 50, visible: projected.z > -1 && projected.z < 1 };
  }

  draw(frame) {
    if (!this.available) return null;
    this.lastFrame = frame;
    const { bearing, guidance, steering, distance, reveal, time, motion, anchors, bridgeProgress, pressureProgress } = frame;
    // Heading stays where the player set it; release never recentres the camera.
    this.camera.rotation.set(-steering.y * 0.48 * 0.65, -steering.x * 0.68 * 0.65, 0);
    const range = distance + 14;
    this.target.set(Math.tan(bearing.x * 0.65), -Math.tan(bearing.y * 0.65), -1).normalize().multiplyScalar(range).add(this.camera.position);
    const broadside = 1 - smoothstep(distance, 65, 650);
    this.enemy.rotation.set(0.06 * (1 - broadside), 0.62 * (1 - broadside), motion ? Math.sin(time * 0.7) * frame.rotationError * 0.002 : 0);
    // Translate the hull around its actual hatch so the HUD distance is the docking gap.
    this.enemy.position.copy(this.target).sub(this.hatch.position.clone().applyEuler(this.enemy.rotation));
    this.enemy.visible = reveal > 0;
    const opening = smoothstep(pressureProgress, 0.78, 1);
    this.doors.forEach((door, i) => { door.position.x = 4 + (i === 0 ? -1 : 1) * (1.52 + opening * 3.1); });
    this.hatchLamp.material.color.setHex(pressureProgress >= 1 ? 0x71f2c3 : 0xff9260);
    this.scene.updateMatrixWorld(true);

    this.cables.forEach((cable, i) => {
      cable.visible = i < anchors;
      if (!cable.visible) return;
      const start = this.launchers[i].getWorldPosition(new THREE.Vector3());
      const end = this.anchors[i].getWorldPosition(new THREE.Vector3());
      this.barBetween(cable, start, end, 0.055, true);
    });
    const start = this.playerHatch.getWorldPosition(new THREE.Vector3());
    const end = this.hatch.getWorldPosition(new THREE.Vector3());
    const direction = end.clone().sub(start);
    const length = Math.max(0.01, direction.length() * bridgeProgress);
    this.bridge.visible = bridgeProgress > 0;
    this.collar.visible = bridgeProgress > 0;
    this.bridge.position.copy(start);
    // A shortest-arc rotation flips unpredictably when +Z approaches -Z.
    // Build an upright basis instead, keeping the bridge floor level with the hatch.
    this.matrix.lookAt(end, start, Y_AXIS);
    this.bridge.quaternion.setFromRotationMatrix(this.matrix);
    for (const [mesh, width, height] of [[this.bridgeFloor, 4.8, 0.3], [this.bridgeRoof, 4.8, 0.22], ...this.bridgeWalls.map((wall) => [wall, 0.12, 4]), ...this.bridgeRails.map((rail) => [rail, 0.08, 0.1])]) {
      mesh.scale.set(width, height, length);
      mesh.position.z = length / 2;
    }
    this.bridgeRibs.forEach((rib, i) => { rib.position.z = length * i / (this.bridgeRibs.length - 1); });
    this.collar.position.copy(start).addScaledVector(direction, bridgeProgress);
    this.collar.quaternion.copy(this.enemy.quaternion);

    const positions = this.stars.geometry.attributes.position;
    for (let i = 2; i < positions.array.length; i += 3) {
      positions.array[i] = -(((-this.starOrigins[i] - frame.travel) % 14000 + 14000) % 14000);
    }
    positions.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    const lead = new THREE.Vector3(Math.tan(guidance.x * 0.65), -Math.tan(guidance.y * 0.65), -1).normalize().multiplyScalar(range).add(this.camera.position);
    return { contact: this.project(end), intercept: this.project(lead) };
  }

  showError(message) {
    if (!this.errorPanel) return;
    this.errorPanel.hidden = false;
    this.errorPanel.querySelector("p").textContent = message;
  }

  getState() {
    if (!this.renderer || !this.lastFrame) return { type: "unavailable", available: false };
    return {
      type: "webgl2", available: this.available, units: "metres", shipVisible: this.enemy.visible,
      triangles: this.renderer.info.render.triangles, drawCalls: this.renderer.info.render.calls,
      pixelRatio: this.renderer.getPixelRatio(), cameraPosition: this.camera.position.toArray(),
      cameraRotation: this.camera.rotation.toArray().slice(0, 3),
      hatch: this.hatch.getWorldPosition(new THREE.Vector3()).toArray(),
      anchorPoints: this.anchors.map((anchor) => anchor.getWorldPosition(new THREE.Vector3()).toArray()),
      bridgeEnd: this.collar.position.toArray(), bridgeVisible: this.bridge.visible,
      bridgeUp: new THREE.Vector3(0, 1, 0).applyQuaternion(this.bridge.quaternion).toArray(),
    };
  }

  dispose() {
    this.destroyed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    for (const resource of this.resources) resource.dispose();
    this.scene?.traverse((object) => { if (object.isInstancedMesh) object.dispose(); });
    this.renderer?.dispose();
    this.available = false;
  }
}
