import * as THREE from '../vendor/three.module.js';

// A salvaged boarding tug, built around a clear lower-deck passage rather than
// a fighter's pointed nose. Weapon, hatch and ram anchors belong to the renderer
// and stay in their original physical coordinate frame.
export function buildBoardingShip(r) {
  const hull=r.playerHull,m=r.materials;
  const steel=r.material(0x475154),patch=r.material(0x859088),rust=r.material(0x824b3c);
  const hazard=r.material(0xc99737),metal=r.material(0x9fa9a7),glass=r.material(0x123142);
  r.boardingHazard=hazard;r.boardingMetal=metal;
  const boxes=[],box=(material,position,scale)=>boxes.push({material,position,scale});
  const outline=new THREE.Shape();
  [[-7.6,-13.5],[-4.8,-13.5],[-4.8,-6.8],[4.8,-6.8],[4.8,-13.5],[7.6,-13.5],[7.6,8.5],[5.8,10.5],[-5.8,10.5],[-7.6,8.5]].forEach(([x,z],i)=>i?outline.lineTo(x,z):outline.moveTo(x,z));
  outline.closePath();
  const keel=r.keep(new THREE.ExtrudeGeometry(outline,{depth:3,steps:1,bevelEnabled:true,bevelSegments:1,bevelSize:.3,bevelThickness:.25,curveSegments:1}));
  keel.rotateX(Math.PI/2);keel.translate(0,-.6,0);r.mesh(hull,keel,steel);

  // Offset armored wheelhouse leaves the centreline machinery and airlock clear.
  box(patch,[-1.85,1.05,3],[4.7,3.4,6.8]);
  box(m.dark,[-1.85,2.1,-.48],[4.2,1.05,.2]);
  box(glass,[-1.85,2.1,-.6],[3.5,.65,.13]);
  box(steel,[-1.85,2.9,3],[5.1,.45,7.2]);
  box(rust,[-1.85,.9,6.48],[4.3,2.1,.25]);
  box(m.dark,[-1.85,.9,6.65],[3.6,1.5,.1]);
  r.label(hull,'NO CLAIM / 07',[-1.85,1.05,6.72],3.3,'#e1cdb1');
  r.label(hull,'BREACH TUG',[-1.85,.48,6.73],2.7,'#d4a65d');
  for(const x of [-3,-1.85,-.7])box(m.dark,[x,2.1,-.69],[.12,.8,.14]);
  box(rust,[3.1,.2,4.3],[3.8,1.7,6.5]);
  for(const z of [2,3,4,5,6])box(m.dark,[3.1,1.15,z],[3.2,.14,.22]);
  for(const x of [2.35,3.9]) {
    const tank=r.mesh(hull,r.cylinderGeometry,metal,[x,2.05,3.8],[.55,5,.55]);tank.rotation.x=Math.PI/2;
    for(const z of [2.1,5.4])box(steel,[x,2.05,z],[1.3,1.4,.24]);
  }

  // Two blunt structural spars carry the cutter collar. No wings or tail fins.
  for(const side of [-1,1]) {
    const x=side*6.05;
    box(side<0?rust:hazard,[x,.5,-6.2],[2.6,2.1,13.2]);
    box(m.dark,[x,1.66,-6.2],[1.8,.25,11]);
    for(const z of [-11.5,-8.2,-4.9,-1.6]) {
      box(metal,[x,1.85,z],[2.75,.28,.55]);
      box(patch,[side*7.43,-1.7,z],[.22,2.6,2.4]);
      for(const y of [-2.6,-.8])box(m.dark,[side*7.58,y,z],[.1,.18,1.8]);
    }
    const piston=r.mesh(hull,r.cylinderGeometry,metal,[side*5.75,2.03,-6.7],[.27,11.6,.27]);piston.rotation.x=Math.PI/2;
    // Raised loading gantry breaks the silhouette above the wheelhouse. The
    // lower cutter is visibly supported by structural arms, not glued to a nose.
    box(steel,[side*6.05,3.65,-8.8],[1.1,1.4,8.2]);
    box(hazard,[side*6.05,4.4,-8.8],[1.2,.18,8.5]);
    for(const z of [-11.8,-5.8])box(metal,[side*6.05,2.6,z],[.6,2.3,.6]);
    const brace=r.box(hull,steel);
    r.barBetween(brace,new THREE.Vector3(side*6.05,3.5,-12.4),new THREE.Vector3(side*4.4,-3.7,-13.1),.65);
    box(hazard,[x,-.6,-13.55],[2.8,3.8,.6]);
    for(let i=0;i<4;i++) {
      const stripe=r.box(hull,m.dark,[x-.92+i*.6,-.6,-13.88],[.28,3.4,.06]);stripe.rotation.z=.24;
    }
    // Repaired outer shell, welded ribs, grab rails and mismatched plates.
    box(m.dark,[side*7.2,-.3,6],[2.1,4.6,8.2]);
    box(steel,[side*6.3,-.15,5.8],[3.6,4.5,8.5]);
    for(const z of [3,5.8,8.6])box(side<0?patch:rust,[side*6.3,2.18,z],[3.4,.2,2.4]);
    for(const z of [2,5,8])box(metal,[side*8.15,-.8,z],[.13,3.4,.26]);
    box(hazard,[side*6.3,-1.1,10.35],[3.8,4.8,.45]);
    box(m.cyan,[side*7.6,1,8.6],[.15,.18,.75]);
  }
  // Raised cargo lashings and asymmetrical service boxes read as improvised kit.
  box(patch,[-5,1.65,8],[1.6,1.4,2.4]);box(hazard,[-5,2.4,8],[.25,.12,2.5]);
  for(const z of [-4,-2,0])box(m.dark,[0,-.38,z],[7,.16,.18]);
  box(hazard,[0,-.25,-5.9],[6.7,.18,.6]);
  for(let i=0;i<7;i++)box(m.dark,[-2.7+i*.9,-.13,-5.9],[.42,.12,.64]);
  box(steel,[0,3.7,-12.4],[12.4,1.3,.85]);
  for(let i=0;i<10;i++)box(i%2?m.dark:hazard,[-5.4+i*1.2,4.42,-12.4],[.78,.15,.95]);
  r.batchBoxes(hull,boxes);

  // An actual cable drum sits above the port harpoon track.
  r.harpoonWinch=new THREE.Group();r.harpoonWinch.position.set(-5.75,2.25,-3.2);hull.add(r.harpoonWinch);
  const drum=r.mesh(r.harpoonWinch,r.cylinderGeometry,m.dark,[0,0,0],[1.28,2.15,1.28]);drum.rotation.z=Math.PI/2;
  for(const x of [-1.2,1.2]) {
    const flange=r.mesh(r.harpoonWinch,r.cylinderGeometry,hazard,[x,0,0],[1.55,.2,1.55]);flange.rotation.z=Math.PI/2;
    for(const sign of [-1,1])r.box(r.harpoonWinch,metal,[x+.13,0,sign*.78],[.12,.3,1.4]);
  }
  const coilGeometry=r.keep(new THREE.TorusGeometry(1.3,.075,4,16));
  for(let i=0;i<8;i++) {
    const coil=r.mesh(r.harpoonWinch,coilGeometry,metal,[-.9+i*.26,0,0]);coil.rotation.y=Math.PI/2;
  }
  for(const x of [-7.2,-4.3])r.box(hull,steel,[x,1.4,-3.2],[.3,2.6,3.4]);
  const cablePath=[[-5.75,2.9,-4.5],[-5.75,2.9,-9],[-4.5,1,-11],[-4.5,-1.5,-12]];
  for(let i=1;i<cablePath.length;i++) {
    const cable=r.mesh(hull,r.cylinderGeometry,metal);
    r.barBetween(cable,new THREE.Vector3(...cablePath[i-1]),new THREE.Vector3(...cablePath[i]),.13,true);
  }

  // A real hollow lower passage terminates at the unchanged playerHatch anchor.
  r.boardingTunnel=new THREE.Group();r.boardingTunnel.name='lower-breach-airlock';r.player.add(r.boardingTunnel);
  const tunnel=[];const wall=(material,position,scale)=>tunnel.push({material,position,scale});
  for(const x of [-2.9,2.9])wall(steel,[x,-4,-3],[.45,5.1,21]);
  for(const y of [-6.5,-1.5])wall(steel,[0,y,-3],[6.25,.4,21]);
  wall(m.dark,[0,-4,7.4],[5.4,4.6,.3]);
  for(const z of [-12,-8,-4,0,4])wall(m.amber,[0,-1.76,z],[4.8,.1,.15]);
  r.batchBoxes(r.boardingTunnel,tunnel);
  r.entryDoors=[-1,1].map(side=>{
    const door=r.box(r.boardingTunnel,m.panel,[side*1.32,-4,-13.65+side*.025],[2.68,4.55,.22]);
    door.userData.side=side;return door;
  });

  const exhaust=r.keep(new THREE.MeshBasicMaterial({color:0x68d9ff,transparent:true,opacity:.42,depthWrite:false,blending:THREE.AdditiveBlending}));
  const jetGeometry=r.keep(new THREE.ConeGeometry(1.1,8,8));
  r.playerEngines=[];r.playerManeuverJets=[];
  for(const side of [-1,1]) {
    const x=side*6.3;
    const ring=r.mesh(hull,r.cylinderGeometry,m.dark,[x,-1.1,11],[1.7,.7,1.7]);ring.rotation.x=Math.PI/2;
    const core=r.mesh(hull,r.cylinderGeometry,m.cyan,[x,-1.1,11.5],[.87,.2,.87]);core.rotation.x=Math.PI/2;
    const plume=r.mesh(hull,jetGeometry,exhaust,[x,-1.1,16]);plume.rotation.x=Math.PI/2;r.playerEngines.push({x,plume});
    const lateral=r.mesh(hull,jetGeometry,exhaust,[-side*8,-1,3],[.25,.35,.25]);
    lateral.rotation.z=side*Math.PI/2;lateral.userData.side=side;r.playerManeuverJets.push(lateral);
    const reverse=r.mesh(hull,jetGeometry,exhaust,[side*6,-1,-14],[.2,.3,.2]);
    reverse.rotation.x=-Math.PI/2;reverse.userData.reverse=true;r.playerManeuverJets.push(reverse);
  }
}
