import {SIEGE,traceCannon} from './player-cannon.js?v=engagement-1';

const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
// Navigation remains the ship's physical helm, NOT the following camera.
// Aim at the same world-space ray used by cannon and harpoon rules. A raised
// camera must not make the fixed crosshair advertise a different hit point.
export function flightCameraFrame(nav,view,{portrait=false,compact=false,dock=0,breach=0}={}) {
  const sy=Math.sin(view.yaw),cy=Math.cos(view.yaw),sp=Math.sin(view.pitch),cp=Math.cos(view.pitch);
  const forward={x:sy*cp,y:-sp,z:-cy*cp},up={x:sy*sp,y:cp,z:-cy*sp},right={x:cy,y:0,z:sy};
  const ship=add(nav.position,up,4*breach);
  const distance=portrait||compact?65:52,height=portrait?14:compact?9:12;
  let position=add(add(add(ship,forward,-distance-dock*12),up,height+dock*8),right,dock*22);
  const obstruction=traceCannon(nav,ship,position);
  if(obstruction) {
    const boom={x:position.x-ship.x,y:position.y-ship.y,z:position.z-ship.z};
    position=add(ship,boom,Math.max(0,obstruction.t-3/Math.hypot(boom.x,boom.y,boom.z)));
  }
  const far=add(nav.position,forward,SIEGE.range);
  const target=traceCannon(nav,nav.position,far)?.position||far;
  return {position,target,ship,up,forward};
}
