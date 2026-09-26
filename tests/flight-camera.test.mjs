import test from 'node:test';
import assert from 'node:assert/strict';
import {flightCameraFrame} from '../src/flight-camera.js';
import {OrbitNavigation,lookAt} from '../src/navigation.js';
import {PlayerCannon,traceCannon} from '../src/player-cannon.js';
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const norm=v=>Math.hypot(v.x,v.y,v.z);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('Chase camera is behind and above the physical ship for every heading, including orbital poles',()=>{
  for(const portrait of [false,true])for(const yaw of [0,1.2,-2.4,6.7])for(const pitch of [0,.7,-1.57,1.57,2.4]) {
    const nav=new OrbitNavigation(),view={yaw,pitch},before=JSON.stringify(nav);
    const pose=flightCameraFrame(nav,view,{portrait}),offset=sub(pose.position,pose.ship);
    near(dot(offset,pose.forward),portrait?-65:-52);near(dot(offset,pose.up),portrait?14:12);
    near(norm(pose.forward),1);near(dot(pose.forward,pose.up),0);
    assert.deepEqual(pose.ship,nav.position);assert.equal(JSON.stringify(nav),before);
  }
});
test('Camera crosshair looks at the same vulnerable surface the physical muzzle targets',()=>{
  for(const yaw of [0,.8,-2])for(const portrait of [false,true]) {
    const nav=new OrbitNavigation();nav.begin({x:0,y:0});nav.setEnemyYaw(yaw);
    const view=nav.forceRear(true,false),before=JSON.stringify(nav),pose=flightCameraFrame(nav,view,{portrait});
    const hit=traceCannon(nav,nav.position,pose.target);
    assert.ok(hit);assert.equal(hit.kind,'armor');
    const gun=new PlayerCannon();gun.fire(nav,view);
    const toTarget=sub(pose.target,gun.bolts[0].position);
    near(dot(toTarget,gun.bolts[0].direction)/norm(toTarget),1);
    assert.equal(JSON.stringify(nav),before,'Moving the camera cannot translate or retarget the ship');
    for(let i=0;i<50;i++)gun.update(.02,nav);assert.equal(nav.armorHealth,100);
  }
});
test('Camera boom stops outside the enemy hull instead of looking through it',()=>{
  const nav=new OrbitNavigation();nav.begin({x:0,y:0});nav.setEnemyYaw(0);nav.position=nav.world({x:0,y:0,z:70});
  const pose=flightCameraFrame(nav,{yaw:Math.PI,pitch:0},{portrait:true});
  assert.ok(norm(sub(pose.position,pose.ship))<Math.hypot(52,12)-1);
  assert.equal(traceCannon(nav,pose.ship,pose.position),null);
});
test('Dock framing is external while the lower hatch keeps its original world connection',()=>{
  const nav=new OrbitNavigation();nav.begin({x:0,y:0});const view=nav.forceRear();
  const flat=flightCameraFrame(nav,view),dock=flightCameraFrame(nav,view,{dock:1,breach:1});
  near(dot(sub(dock.ship,nav.position),dock.up),4);
  near(dot(sub(dock.position,dock.ship),dock.forward),-64);
  near(norm(sub(dock.ship,flat.ship)),4);
  assert.ok(norm(sub(dock.position,dock.ship))>50);
  // A lower hatch -4 m from the raised helm cancels the 4 m docking lift.
  const hatch={x:dock.ship.x-dock.up.x*4+dock.forward.x*14,y:dock.ship.y-dock.up.y*4+dock.forward.y*14,z:dock.ship.z-dock.up.z*4+dock.forward.z*14};
  near(dot(sub(hatch,nav.position),dock.up),0);near(dot(sub(hatch,nav.position),dock.forward),14);
  assert.ok(lookAt(nav.position,nav.door));
});
