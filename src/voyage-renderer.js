import * as THREE from "../vendor/three.module.js";

const smoothstep = THREE.MathUtils.smoothstep;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// One unit is one metre. The approach distance is from our foredeck collar to the enemy bow.
// The ram, destructible forward bulkhead and sealed passage share one 3D world.
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
    this.enemy.name = "hostile-frontal-frigate";
    this.enemy.rotation.order = "YXZ";
    this.scene.add(this.enemy);
    this.makeEnemy();
    this.makePlayer();
    this.makeRig();
    this.makeRam();
    this.makeStars();
    this.available = true;
    document.getElementById("space-scene")?.setAttribute("data-renderer", "webgl");
    this.onContextLost = (event) => {
      event.preventDefault();
      this.available = false;
      this.onLost?.();
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
    [[-16, -6], [-11, -10], [11, -10], [16, -6], [16, 6], [10, 10], [-10, 10], [-16, 6]].forEach(([x, y], i) => {
      if (i === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
    });
    outline.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-3.7, -3.7); hole.lineTo(-3.7, 3.7);
    hole.lineTo(3.7, 3.7); hole.lineTo(3.7, -3.7); hole.closePath();
    outline.holes.push(hole);
    const hull = this.keep(new THREE.ExtrudeGeometry(outline, { depth: 80, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.45, bevelThickness: 0.5, curveSegments: 1 }));
    hull.translate(0, 0, -50);
    this.mesh(this.enemy, hull, m.hull);
    const boxes = [];
    const plate = (material, position, scale) => boxes.push({ material, position, scale });

    // Recognisable bow: bevelled cheeks, recessed central armour, bridge above and engines aft.
    for (const side of [-1, 1]) {
      plate(m.panel, [side * 10.1, 0, 30.7], [10.5, 11.5, 1.4]);
      plate(m.dark, [side * 11, -1.5, 31.5], [6.5, 2.4, 0.25]);
      plate(m.trim, [side * 13.6, 1, 31.55], [0.7, 8.6, 0.3]);
      plate(m.red, [side * 9, 4.5, 31.55], [4.4, 0.28, 0.18]);
      for (const y of [-4.6, 4.6]) plate(m.trim, [side * 6, y, 31.5], [0.32, 0.6, 0.2]);
      plate(m.dark, [side * 19, -2, -15], [7, 10, 48]);
      plate(m.panel, [side * 19, -1.5, 8.5], [6, 8.5, 2]);
      plate(m.cyan, [side * 19, 3.1, -11], [0.25, 0.15, 35]);
      plate(m.hull, [side * 16, -3, -22], [12, 2, 14]);
      for (const z of [-36, -20, -4, 12]) {
        plate(m.panel, [side * 16.5, 0, z], [0.7, 8, 13]);
        plate(m.trim, [side * 17, 2.8, z], [0.25, 0.3, 10]);
      }
      const nozzle = this.mesh(this.enemy, this.cylinderGeometry, m.trim, [side * 19, -2, -40], [3.2, 1.4, 3.2]);
      nozzle.rotation.x = Math.PI / 2;
    }
    plate(m.dark, [0, 11, -17], [15, 4.5, 25]);
    plate(m.panel, [0, 13.5, -17], [13, 0.8, 22]);
    plate(m.cyan, [0, 11.2, -4.3], [11, 0.5, 0.16]);
    plate(m.dark, [0, 18, -24], [0.35, 9, 0.35]);
    plate(m.red, [0, 22.6, -24], [0.55, 0.55, 0.55]);
    plate(m.trim, [0, 7.2, 30.8], [15, 0.6, 0.55]);
    plate(m.dark, [0, -7, 30.8], [17, 1.5, 1]);

    this.hatch = new THREE.Object3D(); // The destructible forward bulkhead, not an existing side airlock.
    this.hatch.position.set(0, 0, 31);
    this.enemy.add(this.hatch);
    this.passageEnd = new THREE.Object3D();
    this.passageEnd.position.set(0, 0, 25);
    this.enemy.add(this.passageEnd);
    this.label(this.enemy, "FORWARD ARMOR / 07", [0, 5.4, 31.7], 12, "#b6c7cd");

    this.armour = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const panel = new THREE.Group();
      panel.userData = { sideX: x, sideY: y };
      this.enemy.add(panel);
      this.box(panel, m.door, [0, 0, 0], [3.66, 3.66, 0.65]);
      this.box(panel, m.dark, [0, -y * 0.7, 0.36], [2.7, 0.25, 0.08]);
      this.box(panel, m.trim, [x * 1.2, y * 1.2, 0.37], [0.18, 0.45, 0.08]);
      this.armour.push(panel);
    }
    // Chamber behind the broken outer plate; the inner door stays shut until pressure is safe.
    plate(m.dark, [0, 0, 4], [10, 10, 0.5]);
    plate(m.panel, [0, -2.25, 18], [7.2, 0.4, 27]);
    for (const x of [-3.5, 3.5]) plate(m.dark, [x, 0, 18], [0.3, 7.2, 27]);
    plate(m.dark, [0, 3.5, 18], [7.2, 0.3, 27]);
    for (const z of [9, 14, 19, 24, 29]) {
      plate(m.cyan, [0, 3.3, z], [5.3, 0.15, 0.35]);
      plate(m.trim, [-3.35, 0.5, z], [0.12, 5.5, 0.18]);
      plate(m.trim, [3.35, 0.5, z], [0.12, 5.5, 0.18]);
    }
    this.doors = [-1, 1].map(side => {
      const door = this.box(this.enemy, m.panel, [side * 1.72, 0.5, 19], [3.4, 5.8, 0.35]);
      this.box(door, m.trim, [0, 0, 0.6], [0.8, 0.07, 0.1]);
      return door;
    });
    this.hatchLamp = this.box(this.enemy, m.red.clone(), [0, 3.4, 19.3], [3, 0.15, 0.15]);
    this.keep(this.hatchLamp.material);
    this.label(this.enemy, "DECK 01", [0, 1.3, 4.4], 4, "#80c6d7");
    this.batchBoxes(this.enemy, boxes);

    this.debris = new THREE.InstancedMesh(this.boxGeometry, m.door, 28);
    this.enemy.add(this.debris);
    this.debris.frustumCulled = false;
    this.debrisTransform = new THREE.Object3D();
    this.debrisVelocities = Array.from({ length: 28 }, (_, i) => {
      const angle = i * 2.39996;
      return new THREE.Vector3(Math.cos(angle) * (7 + i % 4), Math.sin(angle) * (6 + i % 3), 5 + i % 7);
    });
    this.impactLight = new THREE.PointLight(0xffb264, 0, 65, 2);
    this.impactLight.position.set(0, 0, 35);
    this.enemy.add(this.impactLight);
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
    this.playerHatch = new THREE.Object3D();
    this.playerHatch.position.set(0, 0, -14);
    this.player.add(this.playerHatch);
    this.canopy = new THREE.Group();
    this.camera.add(this.canopy);
    this.canopyBeams = Array.from({ length: 3 }, () => this.box(this.canopy, m.dark));
    this.canopyLights = Array.from({ length: 2 }, () => this.box(this.canopy, m.trim));
  }

  makeRig() {
    this.bridge = new THREE.Group();
    this.scene.add(this.bridge);
    this.bridgeFloor = this.box(this.bridge, this.materials.panel, [0, -2, 0]);
    this.bridgeRoof = this.box(this.bridge, this.materials.dark, [0, 2, 0]);
    const glass = this.keep(new THREE.MeshStandardMaterial({ color: 0x265268, transparent: true, opacity: 0.27, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    this.bridgeWalls = [-2.3, 2.3].map((x) => this.box(this.bridge, glass, [x, 0, 0]));
    this.bridgeRails = [-2.15, 2.15].map((x) => this.box(this.bridge, this.materials.cyan, [x, -1.6, 0]));
    this.bridgeRibs = Array.from({ length: 4 }, () => {
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

  makeRam() {
    const m = this.materials;
    this.ramHead = new THREE.Group();
    this.player.add(this.ramHead);
    const outline = new THREE.Shape();
    [[-4.1, -2.8], [-2.8, -4.1], [2.8, -4.1], [4.1, -2.8], [4.1, 2.8], [2.8, 4.1], [-2.8, 4.1], [-4.1, 2.8]].forEach(([x,y],i) => i ? outline.lineTo(x,y) : outline.moveTo(x,y));
    outline.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-2.65,-2.65); hole.lineTo(-2.65,2.65); hole.lineTo(2.65,2.65); hole.lineTo(2.65,-2.65); hole.closePath();
    outline.holes.push(hole);
    const head = this.keep(new THREE.ExtrudeGeometry(outline, { depth: 1.1, bevelEnabled: true, bevelSegments: 1, bevelThickness: 0.16, bevelSize: 0.16 }));
    this.mesh(this.ramHead, head, m.dark);
    for (const x of [-2.9, 2.9]) this.box(this.ramHead, m.amber, [x,0,1.3], [0.12,5.6,0.1]);
    for (const y of [-2.9, 2.9]) this.box(this.ramHead, m.amber, [0,y,1.3], [5.6,0.12,0.1]);
    const spikeGeometry = this.keep(new THREE.ConeGeometry(0.6, 2.7, 4));
    for (const x of [-3.1, 3.1]) for (const y of [-3.1, 3.1]) {
      const spike = this.mesh(this.ramHead, spikeGeometry, m.door, [x,y,-1.2]);
      spike.rotation.x = -Math.PI / 2;
      this.box(this.ramHead, m.amber, [x,y,1.18], [0.4,0.4,0.1]);
    }
    this.ramPistons = [-1,1].map(side => this.box(this.player,m.dark,[side*3.4,-2.8,-13],[0.8,0.8,1]));
    this.claws = [];
    // Hinged claws fold back over the torn bow and secure the embedded ram.
    for (const side of [-1,1]) for (const height of [-1,1]) {
      const claw = new THREE.Group();
      claw.position.set(side*2.45,height*2.6,32.5);
      claw.userData = {side, height};
      this.enemy.add(claw);
      this.box(claw,m.trim,[side*0.9,0,0],[2.1,0.45,0.65]);
      this.box(claw,m.door,[side*1.9,0,0.55],[0.6,0.7,1.7]);
      this.claws.push(claw);
    }
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
    const streakGeometry = this.keep(new THREE.BufferGeometry());
    streakGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions.length * 2), 3));
    this.streaks = new THREE.LineSegments(streakGeometry, this.keep(new THREE.LineBasicMaterial({ color: 0x9ec4e5, transparent: true, opacity: 0.38 })));
    this.scene.add(this.streaks);
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
    const { bearing, guidance, steering, distance, reveal, time, motion, assault: a } = frame;
    const shock = motion && a.impactAge >= 0 ? Math.exp(-a.impactAge * 4.5) : 0;
    const chargeMotion = motion && a.stage === "charge" ? a.charge : 0;
    this.camera.position.set(Math.sin(a.impactAge*71)*shock*0.06, Math.sin(a.impactAge*53)*shock*0.1, 6 + shock*0.48 - chargeMotion*0.2);
    this.camera.rotation.set(-steering.y*0.48*0.65 + Math.sin(a.impactAge*49)*shock*0.016, -steering.x*0.68*0.65, Math.sin(a.impactAge*63)*shock*0.012);
    const heading = new THREE.Euler(-bearing.y*0.65, -bearing.x*0.65, 0, "YXZ");
    const range = distance + 14;
    this.target.set(0,0,-1).applyEuler(heading).multiplyScalar(range).add(new THREE.Vector3(0,0,6));
    this.enemy.rotation.copy(heading);
    if (!a.committed) this.enemy.rotateY(Math.sin(time*0.3)*0.09*smoothstep(distance,170,1000));
    this.enemy.position.copy(this.target).sub(this.hatch.position.clone().applyEuler(this.enemy.rotation));
    this.enemy.visible = reveal > 0;
    const opening = smoothstep(a.pressure, 0.7, 1);
    this.doors.forEach((door,i) => { door.position.x = (i === 0 ? -1 : 1) * (1.72 + opening*3.5); });
    this.hatchLamp.material.color.setHex(a.pressure >= 1 ? 0x71f2c3 : 0xff9260);
    for (const panel of this.armour) {
      const { sideX: x, sideY: y } = panel.userData;
      panel.position.set(x*(1.85 + a.breach*3.2),y*(1.85+a.breach*3.1),31.4+a.breach*1.5);
      panel.rotation.set(y*a.breach*0.72,-x*a.breach*0.8,x*y*a.breach*0.22);
    }
    this.ramHead.visible = a.ram > 0;
    this.ramHead.position.set(0,-6.8*(1-a.ram),-14-a.ram*4);
    this.ramPistons.forEach(piston => { piston.visible = a.ram > 0; piston.scale.z = 3+a.ram*5; piston.position.z = -11.5-a.ram*2.5; });
    this.claws.forEach(claw => {
      claw.visible = a.clamps > 0;
      claw.rotation.z = claw.userData.side*claw.userData.height*(1-a.clamps)*1.3;
      claw.scale.setScalar(0.65+a.clamps*0.35);
    });
    this.debris.visible = motion && a.impactAge >= 0.13 && a.impactAge < 1.7;
    if (this.debris.visible) {
      const age = Math.max(0,a.impactAge-0.13);
      this.debrisVelocities.forEach((velocity,i) => {
        const transform = this.debrisTransform;
        transform.position.copy(velocity).multiplyScalar(age).add(new THREE.Vector3(0,0,31.5));
        transform.rotation.set(age*(i%4+1),age*(i%3-1),age*i*0.11);
        const size = (0.14+(i%5)*0.045)*Math.max(0.05,1-age/1.6);
        transform.scale.set(size*2,size,size*0.6);
        transform.updateMatrix();
        this.debris.setMatrixAt(i,transform.matrix);
      });
      this.debris.instanceMatrix.needsUpdate = true;
    }
    this.impactLight.intensity = shock*150;
    this.scene.updateMatrixWorld(true);
    const bridgeProgress = a.seal;
    const start = this.playerHatch.getWorldPosition(new THREE.Vector3());
    const end = this.passageEnd.getWorldPosition(new THREE.Vector3());
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
    this.streaks.visible = chargeMotion > 0.1;
    if (this.streaks.visible) {
      const streak = this.streaks.geometry.attributes.position;
      for (let i = 0; i < positions.array.length; i += 3) {
        streak.array.set(positions.array.subarray(i,i+3),i*2);
        streak.array.set([positions.array[i],positions.array[i+1],positions.array[i+2]+140+chargeMotion*420],i*2+3);
      }
      streak.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    const lead = new THREE.Vector3(Math.tan(guidance.x * 0.65), -Math.tan(guidance.y * 0.65), -1).normalize().multiplyScalar(range).add(this.camera.position);
    return { contact: this.project(this.hatch.getWorldPosition(new THREE.Vector3())), intercept: this.project(lead) };
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
      bowFacing: new THREE.Vector3(0,0,1).applyQuaternion(this.enemy.quaternion).toArray(),
      passageEnd: this.passageEnd.getWorldPosition(new THREE.Vector3()).toArray(),
      armourBreached: this.lastFrame.assault.breach >= 1, ramVisible: this.ramHead.visible,
      clawsVisible: this.claws.every(claw => claw.visible), debrisVisible: this.debris.visible,
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
