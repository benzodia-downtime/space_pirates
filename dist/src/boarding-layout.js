// Connected decks, in metres. The cockpit is one storey above the breach.
export const INTERIOR = Object.freeze({bridgeStart:15,bridgeEnd:23,stairStart:28,stairEnd:36,upperDeck:4,spawn:{x:0,y:4,z:40},lever:{x:3,y:1.1,z:25.8}});
export const DECKS = Object.freeze([
  {name:'enemy',minX:-9,maxX:9,minZ:-15,maxZ:15},
  {name:'bridge',minX:-2.2,maxX:2.2,minZ:15,maxZ:23},
  {name:'airlock',minX:-4,maxX:4,minZ:23,maxZ:28},
  {name:'stairs',minX:-2,maxX:2,minZ:28,maxZ:36},
  {name:'cockpit',minX:-5,maxX:5,minZ:36,maxZ:44},
]);
export const WALLS = Object.freeze([
  {x:-9.2,z:0,w:.4,d:30,h:5.6},{x:9.2,z:0,w:.4,d:30,h:5.6},
  {x:0,z:-15.2,w:18.4,d:.4,h:5.6},
  {x:-5.6,z:15.2,w:6.8,d:.4,h:5.6},{x:5.6,z:15.2,w:6.8,d:.4,h:5.6},
  {x:0,z:15.2,w:4.4,d:.4,h:1.8,y:3.8},
  {x:-2.4,z:19,w:.4,d:8,h:3.8},{x:2.4,z:19,w:.4,d:8,h:3.8},
  {x:-3.1,z:22.8,w:1.8,d:.4,h:4},{x:3.1,z:22.8,w:1.8,d:.4,h:4},
  {x:-4.2,z:25.5,w:.4,d:5,h:4},{x:4.2,z:25.5,w:.4,d:5,h:4},
  {x:-3,z:28.2,w:2,d:.4,h:4},{x:3,z:28.2,w:2,d:.4,h:4},
  {x:-2.2,z:32,w:.4,d:8,h:8},{x:2.2,z:32,w:.4,d:8,h:8},
  {x:-3.5,z:35.8,w:3,d:.4,h:4,y:4},{x:3.5,z:35.8,w:3,d:.4,h:4,y:4},
  {x:-5.2,z:40,w:.4,d:8,h:4,y:4},{x:5.2,z:40,w:.4,d:8,h:4,y:4},
  {x:0,z:44.2,w:10.4,d:.4,h:4,y:4},
]);
export const deckHeight=z=>Math.max(0,Math.min(4,(z-28)*.5));
export const zoneAt=(x,z)=>DECKS.find(d=>x>=d.minX&&x<=d.maxX&&z>=d.minZ&&z<=d.maxZ)?.name||'void';
export function canStand(x,z,r=.34) {
  return [-r,r].every(dx=>[-r,r].every(dz=>zoneAt(x+dx,z+dz)!=='void'));
}
