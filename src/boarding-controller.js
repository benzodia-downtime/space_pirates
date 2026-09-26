import {BoardingCombat,CREW,clamp,emptyCargo} from './boarding-combat.js?v=helm-return-1';
import {zoneAt} from './boarding-layout.js?v=helm-return-1';
import {BoardingRenderer} from './boarding-renderer.js?v=helm-return-1';
const $=id=>document.getElementById(id);

export class BoardingController {
  constructor(voyage) {
    this.voyage=voyage;this.level=$('battle-level');this.space=$('space-scene');this.sim=new BoardingCombat();
    this.cargo=emptyCargo();this.lootRecovered=false;this.keys=new Set();this.pointers=new Map();this.continuing=false;this.lastOutcome=null;
    this.pad={x:0,z:0};this.aim=false;this.crouch=false;this.fireHeld=false;this.paused=false;this.frame=0;this.last=0;
    this.disposers=[];this.resultShown=false;this.motionPreference=matchMedia('(prefers-reduced-motion: reduce)');this.reduced=this.motionPreference.matches;
    const on=(el,event,fn,options)=>{el.addEventListener(event,fn,options);this.disposers.push(()=>el.removeEventListener(event,fn,options));};
    const action=(id,fn)=>{const el=$(id);let touchAt=-Infinity;
      on(el,'pointerdown',e=>{if(e.pointerType==='mouse')return;e.preventDefault();touchAt=performance.now();fn();});
      on(el,'click',e=>{if(e.detail!==0&&(e.pointerType==='touch'||performance.now()-touchAt<800))return;fn();});
    };
    action('battle-start',()=>this.start());action('battle-interact',()=>this.interact());
    action('battle-error-exit',()=>{this.sim.phase='defeat';this.sim.bag=emptyCargo();this.exit();});
    action('battle-pause',()=>this.togglePause());action('battle-resume',()=>this.togglePause(false));
    action('battle-reload',()=>{if(this.playing)this.sim.reload();});
    action('battle-aim',()=>{if(this.playing)this.aim=!this.aim;this.hud();});
    action('battle-crouch',()=>{if(this.playing)this.crouch=!this.crouch;this.hud();});
    on(this.motionPreference,'change',e=>{this.reduced=e.matches;this.render();});
    on(this.level,'contextmenu',e=>e.preventDefault());
    on($('battle-pad'),'pointerdown',e=>this.pointerDown(e,'move'));
    on($('battle-look'),'pointerdown',e=>this.pointerDown(e,'look'));
    on($('battle-fire'),'pointerdown',e=>this.pointerDown(e,'fire'));
    // Pointer Events only emit pointerdown for the first mouse button in a chord.
    // Mouse events preserve RMB aim + LMB fire regardless of press/release order.
    on($('battle-look'),'mousedown',e=>{if(!this.playing)return;if(e.button===0){this.fireHeld=true;this.sim.fire();}if(e.button===2)this.mouseAim=true;});
    on(window,'mouseup',e=>{if(!this.active)return;this.fireHeld=Boolean(e.buttons&1);this.mouseAim=Boolean(e.buttons&2);});
    on($('battle-fire'),'click',e=>{if(e.detail===0&&this.playing){this.sim.fire();this.render();}});
    on(window,'pointermove',e=>this.pointerMove(e));on(window,'pointerup',e=>this.pointerEnd(e));on(window,'pointercancel',e=>this.pointerEnd(e));
    on(window,'keydown',e=>this.key(e,true));on(window,'keyup',e=>this.key(e,false));
    on(window,'blur',()=>{if(this.active)this.togglePause(true);});
    on(document,'visibilitychange',()=>{if(document.hidden&&this.active)this.togglePause(true);});
    on(window,'resize',()=>{if(this.active)this.render();});
    this.tick=this.tick.bind(this);
  }
  get active(){return !this.level.hidden;}
  get playing(){return this.active&&!this.paused&&this.sim.walking&&this.visual?.available;}
  clearInput(){this.keys.clear();this.pointers.clear();this.pad={x:0,z:0};this.fireHeld=false;this.mouseAim=false;this.knob();}
  start() {
    if(!this.voyage.encounterReady||this.active)return;
    if(!this.visual){this.visual=new BoardingRenderer($('battle-canvas'));this.visual.onAvailability=available=>{if(!available)this.togglePause(true);$('battle-graphics-error').hidden=available;this.render();};}
    this.voyage.pause();this.voyage.audio.unlock();this.space.hidden=true;this.level.hidden=false;
    if(this.continuing){this.sim.respawn();this.prepare();this.continuing=false;}else this.reset();
    $('boarding-notice').hidden=true;clearTimeout(this.noticeTimer);
    $('battle-graphics-error').hidden=this.visual.available;
    this.level.focus({preventScroll:true});this.render();this.loop();
  }
  prepare(){this.soundShots=this.sim.shots;this.soundEnemyShots=this.sim.enemyShots;this.clearInput();this.aim=this.crouch=this.paused=this.lootRecovered=this.resultShown=false;$('battle-pause-panel').hidden=true;this.last=0;this.render();}
  reset(){if(!this.active)return;this.sim.reset();this.prepare();}
  interact(){if(!this.playing)return;const action=this.sim.interact();if(action){this.clearInput();this.voyage.audio.tone(action==='loot'?560:180,100,.12,.04,'sine');this.render();}}
  stopLoop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.last=0;}
  loop(){if(this.active&&!this.paused&&!this.resultShown&&!this.frame&&this.visual?.available)this.frame=requestAnimationFrame(this.tick);}
  tick(now){this.frame=0;const dt=this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;this.update(dt);this.render();this.loop();}
  update(dt){
    if(!this.active||this.paused||!this.visual?.available)return;this.sim.update(dt,this.input());
    // The lever secures the loot, not the camera. Only sitting at the helm exits.
    if(this.sim.detached&&!this.lootRecovered){for(const [key,n] of Object.entries(this.sim.bag))this.cargo[key]+=n;this.lootRecovered=true;this.lastOutcome='extracted';}
    if(['victory','defeat'].includes(this.sim.phase)&&this.sim.resultAge>(this.sim.phase==='defeat'?1.1:.35))this.exit();
  }
  input(){const x=Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft'))+this.pad.x,z=Number(this.keys.has('w')||this.keys.has('arrowup'))-Number(this.keys.has('s')||this.keys.has('arrowdown'))+this.pad.z;return {x:clamp(x,-1,1),z:clamp(z,-1,1),aim:this.aim||this.mouseAim,crouch:this.crouch,run:this.keys.has('shift'),fire:this.fireHeld||this.keys.has('f')};}
  key(e,down) {
    if(!this.active)return;const key=e.key.toLowerCase();
    if(key==='tab'&&down&&(this.paused||this.resultShown)) {
      const panel=$('battle-pause-panel'),buttons=[...panel.querySelectorAll('button')];
      const index=buttons.indexOf(document.activeElement),next=(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length;e.preventDefault();buttons[next]?.focus();return;
    }
    if(key==='escape'&&down&&!e.repeat){e.preventDefault();this.togglePause();return;}
    if(!this.playing){this.keys.delete(key);return;}
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift','f','r','c','e'].includes(key)) {
      e.preventDefault();if(down)this.keys.add(key);else this.keys.delete(key);
      if(down&&!e.repeat&&key==='r')this.sim.reload();if(down&&!e.repeat&&key==='c')this.crouch=!this.crouch;
      if(down&&!e.repeat&&key==='e')this.interact();
    }
  }
  pointerDown(e,kind) {
    if(!this.playing)return;if(e.pointerType!=='mouse'||kind!=='look')e.preventDefault();
    if(kind==='look'&&e.pointerType==='mouse'){if(e.button===0)this.fireHeld=true;if(e.button===2)this.mouseAim=true;}
    if(kind==='fire')this.fireHeld=true;
    if(!this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,{kind,x:e.clientX,y:e.clientY,originX:e.clientX,originY:e.clientY,mouse:e.pointerType==='mouse'});
    // Mouse chords share a pointer ID; avoid capture so right-button release
    // cannot orphan a held left-button shot. Touch fingers capture independently.
    if(e.pointerType!=='mouse')e.currentTarget.setPointerCapture?.(e.pointerId);
    if(this.fireHeld)this.sim.fire();this.render();
  }
  pointerMove(e) {
    const p=this.pointers.get(e.pointerId);if(!p||!this.playing)return;
    if(p.kind==='move'){const x=e.clientX-p.originX,z=p.originY-e.clientY,n=Math.max(34,Math.hypot(x,z));this.pad={x:x/n,z:z/n};this.knob();}
    if(p.kind==='look'){this.sim.view.yaw+=(e.clientX-p.x)*.005;this.sim.view.pitch=clamp(this.sim.view.pitch+(e.clientY-p.y)*.004,-.65,.75);}
    p.x=e.clientX;p.y=e.clientY;this.render();
  }
  pointerEnd(e) {
    const p=this.pointers.get(e.pointerId);if(!p)return;
    if(p.kind==='move'){this.pad={x:0,z:0};this.knob();}
    if(p.mouse){if(e.type==='pointercancel'){this.fireHeld=false;this.mouseAim=false;}else {this.fireHeld=Boolean(e.buttons&1);this.mouseAim=Boolean(e.buttons&2);}if(e.buttons)return;}
    else if(p.kind==='fire')this.fireHeld=false;
    this.pointers.delete(e.pointerId);
  }
  knob(){const knob=$('battle-pad-knob');knob.style.transform=`translate(${this.pad.x*30}px,${-this.pad.z*30}px)`;}
  togglePause(force=!this.paused) {
    if(!this.active||this.resultShown)return;this.paused=force;this.clearInput();
    $('battle-pause-panel').hidden=!force;$('battle-pause').setAttribute('aria-pressed',String(force));
    if(force){this.stopLoop();this.voyage.audio.stop();$('battle-resume').focus({preventScroll:true});}else{this.last=0;this.level.focus({preventScroll:true});this.loop();}this.render();
  }
  hud() {
    for(const [name,a] of [['player',this.sim.player],['enemy',this.sim.enemy]]) {
      $(name+'-health-text').textContent=`${a.health} / ${a.maxHealth}`;
      $(name+'-health-bar').style.width=`${a.health/a.maxHealth*100}%`;$(name+'-health-track').setAttribute('aria-valuenow',String(a.health));
    }
    $('battle-ammo').textContent=this.sim.reloadTime?`장전 ${this.sim.reloadTime.toFixed(1)}`:`${this.sim.rounds} / ${CREW.magazine}`;
    const zone=zoneAt(this.sim.player.x,this.sim.player.z),action=this.sim.interaction();
    const mission={cockpit:'조종석 · 계단을 내려가 연결 통로로 이동',stairs:'아래층 브리치로 내려가기',airlock:this.sim.returned?'귀환 완료 · 오른쪽 분리 레버를 당기세요':'하부 에어록 · 전방 통로로 적함 진입',bridge:this.sim.enteredEnemy?'연결 통로 · 내 함선으로 귀환 가능':'연결 통로 · 적함 화물실로 이동',enemy:this.sim.enemy.health<=0?(this.sim.enemy.looted?'시신 수색 완료 · 왔던 통로로 귀환':'적 승무원 사망 · 시신 가까이에서 수색'):'적함 · 전투하거나 언제든 통로로 철수'};
    const home=zone==='cockpit'?'오른쪽 조종석 가까이에서 앉기 · E':zone==='stairs'?'조종석으로 올라가기':'브리치 회수 완료 · 뒤쪽 계단으로 조종석에 올라가세요';
    $('battle-phase').textContent=this.paused?'일시 정지':this.sim.phase==='extracting'?(this.sim.extraction<.65?'연결 통로 회수 중':'전방 하부 해치 폐쇄 중'):this.sim.phase==='victory'?'조종석 착석 · 항해 조작으로 전환':this.sim.phase==='defeat'?'승무원 사망 · 조종석에서 부활합니다':this.sim.phase==='home'?home:this.sim.enemyPhase==='lock'?'적 조준 고정 · 엄폐 / 이동':mission[zone];
    $('battle-interact').hidden=!action;$('battle-interact').textContent=action?`${action.label} · E`:'';
    $('battle-interact').title=action?.hint||'';
    const bag=this.sim.bag;$('battle-bag').textContent=`${this.lootRecovered?'회수 완료':'휴대 물자'} · 연료 ${bag.fuelCells} / 탄약 ${bag.ammoCrates} / 의료 ${bag.medicalSupplies}`;
    $('battle-bag').hidden=!Object.values(bag).some(Boolean);
    $('battle-aim').setAttribute('aria-pressed',String(this.aim||Boolean(this.mouseAim)));$('battle-crouch').setAttribute('aria-pressed',String(this.crouch));
    $('battle-crosshair').classList.toggle('hit',this.sim.hitMarker>0);this.level.style.setProperty('--crew-damage',String(Math.max(0,1-this.sim.player.hitAge/.35)*.55));
    $('battle-controls').inert=this.paused||!this.sim.walking;
  }
  render(){if(!this.active)return;
    this.sim.view.aspect=this.level.clientWidth/this.level.clientHeight;
    if(this.sim.shots>this.soundShots)this.voyage.audio.tone(220,55,.1,.045,'sawtooth');
    if(this.sim.enemyShots>this.soundEnemyShots)this.voyage.audio.tone(170,45,.13,.025,'sawtooth');
    this.soundShots=this.sim.shots;this.soundEnemyShots=this.sim.enemyShots;
    this.visual?.draw(this.sim,this.reduced);this.hud();
  }
  exit(){
    if(!this.active||!['victory','defeat'].includes(this.sim.phase))return false;
    const won=this.sim.phase==='victory';this.lastOutcome=won?'extracted':'defeat';this.continuing=!won;
    if(won&&!this.lootRecovered){for(const [key,n] of Object.entries(this.sim.bag))this.cargo[key]+=n;this.lootRecovered=true;}
    if(!won)this.sim.bag=emptyCargo();
    this.stopLoop();this.clearInput();this.voyage.audio.stop();this.level.hidden=true;this.space.hidden=false;this.paused=false;
    this.voyage.resolveEncounter({extracted:won});this.voyage.resume();this.voyage.focusControls();
    const notice=$('boarding-notice');notice.textContent=won?(Object.values(this.sim.bag).some(Boolean)?'생환 · 휴대 전리품 회수 완료':'생환 · 전리품 없이 안전하게 분리'):'승무원 사망 · 휴대 물자 소실 · 조종석에서 부활';notice.hidden=false;
    clearTimeout(this.noticeTimer);this.noticeTimer=setTimeout(()=>{notice.hidden=true;},5000);return true;
  }
  getState(){return {...this.sim.getState(),active:this.active,paused:this.paused,lastOutcome:this.lastOutcome,lootRecovered:this.lootRecovered,input:this.input(),rendering:this.visual?.getState()||null};}
  destroy(){clearTimeout(this.noticeTimer);this.stopLoop();this.clearInput();for(const remove of this.disposers)remove();this.visual?.destroy();}
}
