import * as THREE from '../vendor/three.module.js';

// Original articulated low-poly human. Every limb is a joint hierarchy rather
// than a billboard; locomotion, weapon actions and reactions blend continuously.
export class CrewRig {
  constructor(host,enemy=false) {
    this.root=new THREE.Group();this.root.name=enemy?'hostile-human':'player-human';host.scene.add(this.root);
    const skin=host.material(enemy?0xb77753:0xc59572,.9),suit=host.material(enemy?0x3b2827:0x162838),armor=host.material(enemy?0x95432f:0x286279),dark=host.material(0x111a23),metal=host.material(0x617280),glow=host.material(enemy?0xff6b42:0x70ebed,.5,true);
    const box=(parent,m,w,h,d,x,y,z)=>host.box(parent,m,w,h,d,x,y,z);
    const joint=(parent,x,y,z)=>{const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);return g;};
    this.hips=joint(this.root,0,.91,0);
    box(this.hips,suit,.5,.23,.3,0,0,0);box(this.hips,dark,.58,.08,.35,0,.09,0);
    for(const x of [-.23,.23])box(this.hips,metal,.12,.16,.11,x,.01,-.2);
    this.spine=joint(this.hips,0,.16,0);
    box(this.spine,suit,.57,.49,.32,0,.2,0);
    box(this.spine,armor,.63,.36,.16,0,.28,-.2);
    box(this.spine,metal,.43,.055,.04,0,.32,-.295);
    box(this.spine,glow,.12,.025,.025,-.17,.23,-.292);
    box(this.spine,dark,.4,.42,.22,0,.24,.24); // Backpack silhouette.
    for(const x of [-.14,.14])box(this.spine,metal,.075,.28,.05,x,.22,.37);
    box(this.spine,skin,.15,.15,.15,0,.54,0);
    this.head=joint(this.spine,0,.63,-.015);
    const skull=new THREE.Mesh(host.keep(new THREE.SphereGeometry(.195,8,7)),skin);skull.scale.set(.85,1.12,.91);this.head.add(skull);skull.castShadow=true;
    box(this.head,dark,.31,.1,.29,0,.165,.012); // Cropped hair, exposed human face.
    box(this.head,skin,.06,.075,.075,0,-.01,-.185);
    for(const x of [-.074,.074])box(this.head,dark,.037,.023,.025,x,.055,-.176);
    for(const x of [-.175,.175])box(this.head,skin,.035,.085,.07,x,0,0);
    box(this.head,dark,.09,.12,.1,-.2,0,.02);box(this.head,glow,.018,.06,.06,-.251,0,0);
    this.arms=[];
    for(const side of [-1,1]) {
      const shoulder=joint(this.spine,side*.37,.4,0),elbow=joint(shoulder,0,-.28,0);
      box(shoulder,armor,.26,.24,.3,0,-.07,0);box(shoulder,suit,.17,.29,.18,0,-.19,0);
      box(elbow,metal,.16,.17,.18,0,-.075,0);box(elbow,suit,.13,.25,.14,0,-.18,0);
      box(elbow,dark,.15,.13,.17,0,-.31,0);this.arms.push({shoulder,elbow});
    }
    this.weapon=joint(this.spine,.25,.29,-.38);
    box(this.weapon,dark,.15,.16,.69,0,0,-.05);box(this.weapon,metal,.16,.095,.35,0,.035,-.14);
    box(this.weapon,dark,.085,.08,.27,0,0,-.5);box(this.weapon,dark,.1,.21,.14,0,-.14,-.04);
    box(this.weapon,glow,.028,.026,.23,.081,.023,-.2);
    this.flash=new THREE.Mesh(host.keep(new THREE.ConeGeometry(.085,.27,5)),host.material(0xffdb94,.4,true));
    this.flash.rotation.x=-Math.PI/2;this.flash.position.set(0,0,-.68);this.weapon.add(this.flash);
    this.legs=[];
    for(const side of [-1,1]) {
      const hip=joint(this.hips,side*.18,-.08,0),knee=joint(hip,0,-.4,0);
      box(hip,suit,.24,.4,.26,0,-.19,0);box(hip,armor,.16,.23,.08,side*.035,-.19,-.16);
      box(knee,armor,.23,.18,.19,0,-.035,-.04);box(knee,suit,.19,.32,.2,0,-.2,0);
      box(knee,dark,.25,.15,.4,0,-.38,-.065);this.legs.push({hip,knee});
    }
    this.blend=0;this.crouch=0;this.death=0;this.host=host;
    const pieces=[];this.root.traverse(o=>{if(o.isMesh&&o.geometry===host.boxGeometry)pieces.push(o);});this.instances=host.batch(pieces);
  }
  update(actor,time,viewPitch=0,reduced=false) {
    this.root.position.set(actor.x,0,actor.z);this.root.rotation.set(0,-actor.yaw,0);
    const dt=Math.min(.05,Math.max(0,time-(this.lastTime??time))),weight=1-Math.exp(-16*dt);this.lastTime=time;
    if(time===0){this.crouch=actor.crouch?1:0;this.blend=0;}
    this.crouch+=((actor.crouch?1:0)-this.crouch)*weight;
    this.blend+=(Math.min(1,actor.speed/2)-this.blend)*weight;
    const moving=this.blend,cycle=actor.travel*3.6,bob=Math.sin(cycle*2)*.025*moving;
    const crouch=this.crouch,death=Math.min(1,actor.deathAge/.7),ease=death*death*(3-2*death);
    this.hips.position.y=.91-crouch*.49+bob*(reduced?.3:1);
    this.hips.rotation.z=actor.health<=0?-ease*1.5:Math.sin(cycle)*.025*moving;
    if(actor.health<=0)this.hips.position.y=.91-ease*.62;
    const recoil=Math.max(0,1-actor.shotAge/.16),hit=Math.max(0,1-actor.hitAge/.22);
    this.spine.rotation.set(-crouch*.65+viewPitch*.35+hit*.17+recoil*.06,Math.sin(time*1.8)*.012,0);
    this.head.rotation.set(-viewPitch*.3,Math.sin(time*.8)*.02,hit*.13);
    for(const [i,leg] of this.legs.entries()) {
      const wave=Math.sin(cycle+i*Math.PI)*moving;
      leg.hip.rotation.x=wave*.55-crouch*.85;
      leg.knee.rotation.x=Math.max(0,-wave)*.7+crouch*1.8;
    }
    for(const [i,arm] of this.arms.entries()) {
      arm.shoulder.rotation.set(1.08-viewPitch*.7-recoil*.11, i===0?-.3:.06,i===0?-.25:.14);
      arm.elbow.rotation.x=.65;
    }
    if(actor.state==='reload'){this.arms[0].shoulder.rotation.x=.4;this.arms[0].elbow.rotation.x=1.4+Math.sin(time*15)*.2;}
    this.weapon.rotation.x=-viewPitch;this.weapon.position.z=-.38+recoil*.075;
    this.flash.visible=actor.shotAge<.065&&actor.health>0&&!reduced;
    if(actor.health<=0){this.arms[0].shoulder.rotation.x=-.4;this.arms[1].shoulder.rotation.x=-.2;this.weapon.rotation.z=ease*.8;}
    else this.weapon.rotation.z=0;
    this.root.updateMatrixWorld(true);
    this.host.syncBatch(this.instances);
  }
  getState(){return {type:'articulated-human',joints:14,head:this.head.getWorldPosition(new THREE.Vector3()).toArray(),leftLeg:this.legs[0].hip.rotation.x,rightLeg:this.legs[1].hip.rotation.x,spine:this.spine.rotation.x,muzzleVisible:this.flash.visible};}
}
