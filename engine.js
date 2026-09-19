/* Fixed-step arcade simulation. UI and rendering are separate from combat rules. */
(()=>{
const W=960,H=540,FLOOR=443,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const controls=[{left:'KeyA',right:'KeyD',jump:'KeyW',block:'KeyS',attacks:['KeyJ','KeyK','KeyU','KeyI','KeyO','KeyL']},{left:'ArrowLeft',right:'ArrowRight',jump:'ArrowUp',block:'ArrowDown',attacks:['Numpad1','Numpad2','Numpad4','Numpad5','Numpad6','Numpad3']}];
// Per-controller key bitmasks used by the LAN protocol (Space folds into controller 0's jump bit).
const KEY_BITS=controls.map(c=>({left:1,right:2,jump:4,block:8,attacks:[16,32,64,128,256,512]}));
// On the guest machine the P1 key set is free, so it is translated onto the
// guest's controller (WASD + J K U I O L work in addition to arrows + numpad).
const P1_TO_P2={KeyA:'ArrowLeft',KeyD:'ArrowRight',KeyW:'ArrowUp',KeyS:'ArrowDown',KeyJ:'Numpad1',KeyK:'Numpad2',KeyU:'Numpad4',KeyI:'Numpad5',KeyO:'Numpad6',KeyL:'Numpad3',Space:'ArrowUp'};
class FightGame{
 constructor(canvas,characters,options={}){this.canvas=canvas;this.ctx=canvas?.getContext('2d');this.characters=characters;this.options=options;this.mode=options.mode||'cpu';this.difficulty=clamp(options.difficulty??1,0,3);this.isTeamMatch=this.mode.startsWith('team-')&&characters.length===4;this.audio=options.audio||{play(){}};this.keys=new Set();this.fighters=[];this.projectiles=[];this.effects=[];this.particles=[];this.texts=[];this.wins=[0,0];this.round=1;this.age=0;this.phase='intro';this.paused=false;this.running=false;this.shake=0;this.hitstop=0;this.flash=0;this.totalHits=characters.map(()=>0);this.maxCombo=characters.map(()=>0);this.uiClock=0;this.bannerLeft=0;this.lastBanner='';this.random=options.random||Math.random;this.fxRandom=options.fxRandom||this.random;this.stepNum=0;this.netRole=options.net?.role||null;this.inputRecords=new Map();this.netStall=false;this._ev=[new Set(),new Set()];this.stepKeys=[new Set(),new Set()];this._down=e=>{if(e.target?.closest?.('dialog'))return;if(this.isControl(e.code)){e.preventDefault();if(!e.repeat)this.keyDown(e.code);}};this._up=e=>this.keyUp(e.code);this._blur=()=>{this.keys.clear();if(this.mode==='net'&&this.netRole==='guest'){this._ev.forEach(s=>s.clear());return;}if(this.running&&!this.paused&&this.phase!=='finished')this.togglePause(true);};this._visibility=()=>{if(document.hidden)this._blur();};this.resetRound();}
 teamOf(id){return id%2;}
 isEnemy(a,b){return !!a&&!!b&&a.team!==b.team;}
 opponents(f){return this.fighters.filter(o=>this.isEnemy(f,o)&&o.hp>0);}
 targetFor(f){return this.opponents(f).sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))[0];}
 controllerFor(id){if(id===0)return 0;if(id===1&&['local','team-versus','net'].includes(this.mode))return 1;if(id===2&&this.mode==='team-coop')return 1;return null;}
 localController(){return this.netRole==='guest'?1:0;}
 controllerForCode(code){if(code==='Space')return 0;const i=controls.findIndex(c=>[c.left,c.right,c.jump,c.block,...c.attacks].includes(code));return i<0?null:i;}
 keyHeld(controller,code){if(this.mode!=='net')return this.keys.has(code);return this.stepKeys[controller]?.has(code)??false;}
 keyMask(set,controller){let mask=0;for(const code of set){if(this.controllerForCode(code)!==controller)continue;const c=controls[controller],kb=KEY_BITS[controller];if(code===c.left)mask|=kb.left;else if(code===c.right)mask|=kb.right;else if(code===c.jump||(controller===0&&code==='Space'))mask|=kb.jump;else if(code===c.block)mask|=kb.block;else{const ai=c.attacks.indexOf(code);if(ai>=0)mask|=kb.attacks[ai];}}return mask;}
 decodeMask(mask,controller){const set=new Set(),c=controls[controller],kb=KEY_BITS[controller];if(mask&kb.left)set.add(c.left);if(mask&kb.right)set.add(c.right);if(mask&kb.jump)set.add(c.jump);if(mask&kb.block)set.add(c.block);for(let i=0;i<6;i++)if(mask&kb.attacks[i])set.add(c.attacks[i]);return set;}
 teamHealth(team){const members=this.fighters.filter(f=>f.team===team);return members.reduce((n,f)=>n+f.hp,0)/members.reduce((n,f)=>n+f.data.hp,0);}
 teamAlive(team){return this.fighters.some(f=>f.team===team&&f.hp>0);}
 teamTitle(team){return this.isTeamMatch?(team===0?'A 队':'B 队'):this.fighters[team].data.name;}
 retire(f){f.hp=0;f.attack=null;f.castPending=null;f.queue=[];f.jumpRequest=false;f.jumpBuffer=0;f.blocking=false;f.aiMove=0;f.aiBlock=0;f.counterTime=0;f.reflectTime=0;f.buff=null;f.burn=null;}
 isControl(code){return code==='Escape'||code==='Space'||controls.some(c=>[c.left,c.right,c.jump,c.block,...c.attacks].includes(code));}
 makeFighter(data,id){return {data,id,team:this.teamOf(id),controller:this.controllerFor(id),x:this.isTeamMatch?[180,780,305,655][id]:id===0?265:695,y:FLOOR,vx:0,vy:0,facing:this.teamOf(id)===0?1:-1,hp:data.hp,energy:this.mode==='training'?100:20,guard:100,blocking:false,stun:0,invuln:0,slow:0,counterTime:0,attack:null,cooldowns:[0,0,0,0,0,0],queue:[],jumpRequest:false,combo:0,comboTime:0,hitCount:0,hitFlash:0,aiWait:.5,aiMove:0,aiBlock:0,walk:0,knocked:0,downTime:0,landing:0,animTime:0,animState:"idle",attackSerial:0,guardBroken:0};}
 resetRound(){this.fighters=this.characters.map((d,i)=>this.makeFighter(d,i));this.projectiles=[];this.effects=[];this.particles=[];this.texts=[];this.time=this.isTeamMatch?90:60;this.phase='intro';this.phaseTime=2.25;this.keys.clear();this._ev.forEach(s=>s.clear());this.options.onRoundReset?.(this);this.hitstop=0;this.setBanner('ROUND '+this.round,'先赢两回合 · READY');this.options.onHUD?.(this);}
 start(){this.running=true;this.lastFrame=0;this.accumulator=0;if(typeof window!=='undefined'){window.addEventListener('keydown',this._down);window.addEventListener('keyup',this._up);window.addEventListener('blur',this._blur);document.addEventListener('visibilitychange',this._visibility);}const frame=t=>{if(!this.running)return;if(!this.lastFrame)this.lastFrame=t;const delta=Math.min((t-this.lastFrame)/1000,.1);this.lastFrame=t;if(this.mode==='net'&&this.netRole==='guest'){this.accumulator=0;const budget=this.netBacklog()>16?8:2;for(let i=0;i<budget&&this.netCanStep();i++)this.step(1/120);}else{this.accumulator+=delta;while(this.accumulator>=1/120){if(this.step(1/120)===false){this.accumulator=Math.min(this.accumulator,1/30);break;}this.accumulator-=1/120;}}this.draw();this.frameId=requestAnimationFrame(frame);};this.frameId=requestAnimationFrame(frame);}
 destroy(){this.fighters.forEach(f=>f.castPending=null);this.running=false;if(this.frameId)cancelAnimationFrame(this.frameId);this.keys.clear();if(typeof window!=='undefined'){window.removeEventListener('keydown',this._down);window.removeEventListener('keyup',this._up);window.removeEventListener('blur',this._blur);document.removeEventListener('visibilitychange',this._visibility);}}
 togglePause(force){if(this.phase==='finished')return;
 if(this.mode==='net'){
  // Net pause keeps sim state intact: the guest replays the same input
  // records later, so clearing fighter queues would desync the machines.
  this.paused=force??!this.paused;this.keys.clear();this._ev.forEach(s=>s.clear());
  this.options.onBanner?.(this.paused?'PAUSED':'',this.paused?'对手等待恢复':'');
  this.options.onPause?.(this.paused);
  return;
 }
 this.paused=force??!this.paused;this.keys.clear();this.fighters.forEach(f=>{f.queue=[];f.jumpRequest=false;f.jumpBuffer=0;f.castPending=null;});this.options.onBanner?.(this.paused?'PAUSED':'',this.paused?'点击下方继续战斗，或按 ESC':'');this.options.onPause?.(this.paused);}
 keyDown(code){
  if(this.mode==='net'){
   if(code==='Escape'){if(this.netRole==='host')this.togglePause();else this.options.net?.onGuestEscape?.();return;}
   if(this.netRole==='guest')code=P1_TO_P2[code]||code;
   const c=this.controllerForCode(code);
   if(c===null||c!==this.localController())return;
   if(this.keys.has(code))return;
   this.keys.add(code);
   if(!this.paused&&this.phase==='fight')this._ev[c].add(code);
   return;
  }
  if(code==='Escape'){this.togglePause();return;}if(this.keys.has(code))return;this.keys.add(code);if(this.paused||this.phase!=='fight')return;for(const f of this.fighters){if(f.controller===null||f.hp<=0)continue;const c=controls[f.controller];if(code===c.jump||(f.controller===0&&code==='Space'))f.jumpRequest=true;const index=c.attacks.indexOf(code);if(index>=0)f.queue.push({index,ttl:.18});}}
 keyUp(code){if(this.mode==='net'&&this.netRole==='guest')code=P1_TO_P2[code]||code;this.keys.delete(code);}
 setBanner(title,sub='',duration=0){this.lastBanner=title;this.options.onBanner?.(title,sub);this.bannerLeft=duration;}
 effect(type,x,y,color,life=.4,extra={}){this.effects.push({type,x,y,color,life,max:life,...extra});}
 text(text,x,y,color='#fff',life=.65,size=22){this.texts.push({text,x,y,color,life,max:life,size});}
 sparks(x,y,color,count=16,power=1){for(let i=0;i<count;i++){const a=this.random()*Math.PI*2,v=(75+this.random()*200)*power;this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.15+this.random()*.4,color,size:2+Math.floor(this.random()*5)});}}
 canAttack(f,index){if(f.castPending||this.paused)return false;if(this.phase!=='fight'||f.hp<=0||f.stun>0||f.knocked>0||f.blocking||f.cooldowns[index]>0)return false;if(index===5&&f.energy<100)return false;const a=f.attack;if(a&&!(a.skill.type==='light'&&a.hit.size>0&&a.t>.12&&index<=1))return false;return true;}
 attack(f,index,preparedSkill){if(!this.canAttack(f,index))return false;const skill=preparedSkill||window.MemeCombat?.getSkill(f,index,this)||f.data.skills[index];
 if(skill.mimicOrigin&&!preparedSkill&&this.options.prepareSkill){
  if(this.mode==='net'){
   // Net lockstep: the donor pick above was one synchronous PRNG draw, so
   // both machines already resolved the same skill at the same step. Only
   // the render assets are async; load them without deferring the attack
   // (a Promise continuation firing outside step() would desync the sims).
   this.options.prepareSkill(skill).catch(()=>{});
  }else{
   const ticket={index,skill};f.castPending=ticket;
   Promise.resolve().then(()=>this.options.prepareSkill(skill)).then(()=>{
    if(f.castPending!==ticket)return;f.castPending=null;
    if(this.fighters.includes(f)&&this.phase==='fight'&&!this.paused)this.attack(f,index,skill);
   }).catch(()=>{if(f.castPending===ticket){f.castPending=null;this.text('模仿中断',f.x,f.y-185,f.data.color,.6,16);}});
   return true;
  }
 }
 f.attack={skill,index,serial:++f.attackSerial,t:0,emitted:false,shots:0,hit:new Set(),leeched:false};f.cooldowns[index]=skill.cd;if(index===5){f.energy=0;f.invuln=.64;this.flash=.15;this.shake=5;this.audio.play('super');this.setBanner(skill.name,f.data.name+' · SUPER',1.0);this.effect('super',f.x,f.y-80,f.data.color,.8,{radius:160});}else this.audio.play(index===0?'light':index===1?'heavy':'cast');if(skill.type==='upper'){f.vy=-580;f.invuln=.2;}if(skill.type==='slam'){f.vy=skill.super?-710:-570;}if(skill.type==='dash')f.invuln=skill.super?.42:(skill.invuln||0);return true;}
 spawnShot(f,a,offset=0){if(window.MemeCombat){const p=MemeCombat.makeShot(this,f,a,a.shots||0);if(!a.skill.spread)p.y+=offset;return p;}}

 hit(attacker,defender,skill,source,originX=attacker.x){if(!this.isEnemy(attacker,defender)||defender.hp<=0||defender.invuln>0||source.hit.has(defender.id))return false;source.hit.add(defender.id);const dir=defender.x>=originX?1:-1;const inFront=defender.facing===-dir;const isGrab=skill.type==='grab';if(defender.counterTime>0&&inFront&&!isGrab&&!skill.super&&!['projectile','throw','summon','rain','barrage','beam','trap'].includes(skill.type)){defender.counterTime=0;attacker.hp=clamp(attacker.hp-(defender.counterDamage||30),0,attacker.data.hp);attacker.stun=.45;attacker.vx=-dir*220;attacker.attack=null;attacker.castPending=null;defender.energy=clamp(defender.energy+14,0,100);this.text('反击!',defender.x,defender.y-190,defender.data.color);this.sparks(attacker.x,attacker.y-90,defender.data.color,25);this.hitstop=.075;return true;}
 const blocked=defender.blocking&&inFront&&defender.guard>0&&!isGrab;let raw=skill.damage*attacker.data.power*(attacker.buff?.attack||1)*(attacker.form?.attack||1);let damage=raw*(defender.data.trait==='armor'?.9:1)*(defender.buff?.defense||1);if(blocked){damage*=skill.super?.24:.13;defender.guard-=skill.super?42:skill.type==='heavy'?26:15;defender.stun=.075;defender.energy=clamp(defender.energy+5+(defender.data.trait==='counter'?4:0),0,100);attacker.energy=clamp(attacker.energy+4,0,100);this.effect('shield',defender.x-dir*30,defender.y-78,'#8df0ff',.22,{radius:65});this.audio.play('block');this.text('格挡',defender.x,defender.y-170,'#91eaff',.35,16);if(defender.guard<=0){defender.guard=0;defender.stun=.9;defender.guardBroken=1.2;defender.blocking=false;this.text('破防!',defender.x,defender.y-200,'#ff75a4',.8,30);}}
 else{attacker.combo=attacker.comboTime>0?attacker.combo+1:1;attacker.comboTime=1.3;attacker.hitCount++;this.totalHits[attacker.id]++;this.maxCombo[attacker.id]=Math.max(this.maxCombo[attacker.id],attacker.combo);damage*=Math.max(.4,1-(attacker.combo-1)*.085);defender.stun=skill.type==='light'?.28:skill.super?.42:.37;defender.attack=null;defender.castPending=null;defender.queue=[];defender.hitFlash=.13;defender.blocking=false;if(skill.type==='trap')defender.slow=1.5;if(['upper','slam','grab'].includes(skill.type)||(skill.super&&source.finisher!==false)){defender.vy=-240-(skill.type==='upper'?120:0);defender.knocked=.72;defender.downTime=0;}if(attacker.combo>=7){defender.invuln=.48;defender.vx=dir*470;defender.stun=.24;this.text('脱离连段',defender.x,defender.y-195,'#c6ff85',.7,16);}attacker.energy=clamp(attacker.energy+(skill.super?2:9)+(attacker.data.trait==='rush'&&attacker.hitCount%3===0?14:0),0,100);defender.energy=clamp(defender.energy+7,0,100);const leechSource=source.leechSource||source;if(attacker.hp>0&&attacker.data.trait==='leech'&&source.index>=2&&!leechSource.leeched){attacker.hp=clamp(attacker.hp+9,0,attacker.data.hp);leechSource.leeched=true;}this.audio.play('hit');this.text('-'+Math.round(damage),defender.x+dir*15,defender.y-160,skill.super?'#d8ff62':'#fff',.65,skill.super?30:23);this.sparks(defender.x-dir*23,defender.y-85,attacker.data.color,skill.super?36:18,skill.super?1.6:1);this.effect('hit',defender.x-dir*23,defender.y-85,attacker.data.color,.25,{radius:skill.super?90:48});}
 window.MemeCombat?.afterHit(this,attacker,defender,skill,source,blocked);defender.hp=clamp(defender.hp-damage,0,defender.data.hp);if(defender.invuln<=0)defender.vx=dir*(blocked?75:skill.type==='light'?95:skill.super?340:235);if(!blocked&&!skill.physical&&!skill.noIcons&&skill.type!=='light')this.text(attacker.data.glyph+'!',defender.x-dir*50,defender.y-120,attacker.data.color,.45,24);this.shake=blocked?2:skill.super?12:skill.type==='heavy'?7:4;this.hitstop=blocked?.018:skill.super?.065:skill.type==='heavy'?.065:.032;return true;}
 applyMelee(f,a){if(f.hp<=0||f.stun>0)return;const active=f.attack,s=a.skill;for(const o of this.opponents(f).sort((a,b)=>Math.abs(a.x-f.x)-Math.abs(b.x-f.x))){const dist=Math.abs(o.x-f.x),dy=Math.abs(o.y-f.y),radial=['burst','slam','heal','grab'].includes(s.type),front=(o.x-f.x)*f.facing>=-20,height=s.type==='slam'?o.y>FLOOR-80:dy<(s.type==='upper'?150:s.super?170:112);if(dist<s.range&&(radial||front)&&height){this.hit(f,o,s,a);if(f.hp<=0||f.stun>0||f.attack!==active||(s.type==='grab'&&a.hit.size))break;}}}
 updateAttack(f,dt){const a=f.attack;if(!a)return;const s=a.skill;a.t+=dt;if(s.type==='dash'&&a.t>=s.start&&a.t<s.duration-.08){f.x+=f.facing*(s.super?820:580)*dt;this.applyMelee(f,a);if(Math.floor(a.t*30)%3===0)this.effect('ghost',f.x-f.facing*18,f.y,f.data.color,.18,{fighter:f.id,alpha:.3});}
 if(s.type==='barrage'){while(a.shots<(s.count||5)&&a.t>=s.start+a.shots*(s.interval||.14)){this.spawnShot(f,a,(a.shots%3-1)*15);a.shots++;}}
 else if(!a.emitted&&a.t>=s.start){a.emitted=true;const handled=window.MemeCombat?.emit(this,f,a);if(handled){}else if(s.type==='projectile'){for(let n=0;n<(s.count||1);n++){a.shots=n;this.spawnShot(f,a);}}else if(s.type==='trap'){this.effect('trap',clamp(f.x+f.facing*180,45,W-45),FLOOR,f.data.color,3.4,{owner:f.id,attack:a,radius:65});}else if(s.type==='counter'){f.counterTime=2;f.counterDamage=s.damage;this.effect('aura',f.x,f.y-80,f.data.color,.45,{radius:65});this.text('反击架势',f.x,f.y-170,f.data.color,.65,16);}else if(s.type==='heal'){f.hp=clamp(f.hp+55,0,f.data.hp);this.text('+55',f.x,f.y-155,'#b8ff83',.8,25);this.effect('heal',f.x,f.y-60,'#b8ff83',.75,{radius:55});this.applyMelee(f,a);}else if(s.type==='beam'){this.effect('beam',f.x+f.facing*35,f.y-84,f.data.color,.5,{dir:f.facing,radius:42,fx:s.fx,length:s.range});this.applyMelee(f,a);}else if(s.type!=='dash'&&s.type!=='slam'){this.applyMelee(f,a);this.effect(s.type==='upper'?'upper':'slash',f.x+f.facing*65,f.y-83,f.data.color,.22,{dir:f.facing,radius:s.range*.5});}if(a.index>=2&&!s.super)this.text(s.name,f.x,f.y-190,f.data.color,.65,17);}
 if(s.type==='slam'&&a.emitted&&f.y>=FLOOR-.1&&!a.landed){a.landed=true;this.effect('slam',f.x,FLOOR-2,f.data.color,.55,{radius:s.range});this.sparks(f.x,FLOOR-8,f.data.color,35,1.5);this.shake=9;this.applyMelee(f,a);window.MemeCombat?.cue(this,f,a);if(s.extraShot)window.MemeCombat?.makeShot(this,f,{...a,skill:{...s,type:'projectile',fx:s.extraShot,damage:28,speed:700,offset:48}},0);}
 if(a.t>=s.duration&&(s.type!=='slam'||a.landed))f.attack=null;}
 ai(dt){if(this.mode==='local'||this.mode==='training'||this.mode==='net')return;const hard=this.difficulty;for(const f of this.fighters){if(f.controller!==null||f.hp<=0)continue;const o=this.targetFor(f);if(!o)continue;const dist=Math.abs(o.x-f.x),dir=Math.sign(o.x-f.x)||f.facing;f.aiWait-=dt;f.aiBlock=Math.max(0,f.aiBlock-dt);if(f.aiWait>0)continue;f.aiWait=[.36,.22,.12,.045][hard]+this.random()*[.15,.15,.1,.035][hard];if(f.stun>0||f.knocked>0)continue;
 const incoming=this.projectiles.find(p=>this.isEnemy(f,this.fighters[p.owner])&&p.life>0&&(f.x-p.x)*p.vx>=0&&Math.abs(p.x-f.x)<[160,240,300,370][hard]&&Math.abs(p.y-(f.y-80))<95);
 const threatened=this.opponents(f).find(v=>v.attack&&Math.abs(v.x-f.x)<Math.min(240,v.attack.skill.range+35));
 if(hard===3&&o.attack?.skill.type==='grab'&&dist<150){f.aiMove=-dir;f.jumpRequest=true;continue;}
 if((incoming||threatened)&&this.random()<[.22,.48,.7,.9][hard]){if(hard===3&&incoming&&!threatened&&this.random()<.3){f.jumpRequest=true;f.aiMove=dir;}else{f.aiBlock=.18+this.random()*.24;f.aiMove=0;f.aiFacing=Math.sign((incoming?.x??threatened?.x??o.x)-f.x)||dir;f.facing=f.aiFacing;}continue;}
 f.aiMove=dist>(hard===3?68:100)?dir:hard===3&&o.blocking?dir:this.random()<.12?-dir:0;
 if(incoming&&this.random()<.35){f.jumpRequest=true;continue;}
 let candidates=[0,1,2,3,4,5].filter(i=>{if(!this.canAttack(f,i))return false;const s=f.data.skills[i];if(hard===3&&s.type==='counter')return !!(threatened||incoming&&s.reflect);if(s.type==='heal'||s.type==='buff'&&s.heal)return f.hp<f.data.hp*.75;return ['projectile','throw','summon','rain','buff','transform','wall','beam','barrage','dash','trap'].includes(s.type)||dist<(s.range||120)+(hard===3?-5:30);});
 if(candidates.length&&this.random()<[.55,.8,.94,.99][hard]){let index;if(hard===3){const score=i=>{const s=f.data.skills[i];return (s.type==='grab'&&o.blocking?150:0)+(i===5?90:0)+(f.attack?.skill.type==='light'&&i===1?100:0)+((s.type==='heal'||s.type==='buff'&&s.heal)&&f.hp<f.data.hp*.4?140:0)+(s.damage||20)*(s.pulses||s.count||1)/Math.max(.25,s.duration||.6)+(dist>230&&['projectile','throw','beam','summon'].includes(s.type)?35:0)+this.random()*20;};index=candidates.map(i=>[i,score(i)]).sort((a,b)=>b[1]-a[1])[0][0];}else index=candidates[Math.floor(this.random()*candidates.length)];if(!f.queue.some(q=>q.index===index))f.queue.push({index,ttl:.18});}
 if(dist<180&&(hard===3?o.y<FLOOR-70&&this.random()<.14:this.random()<.09))f.jumpRequest=true;
 }}
 step(dt){
  if(this.paused)return false;
  if(this.mode==='net'){
   const next=this.stepNum+1;
   if(this.netRole==='host'){
    if(!this.netReady()){if(!this.netStall){this.netStall=true;this.options.net?.onStall?.(true);}return false;}
   }else if(!this.netCanStep()){return false;}
   if(this.netStall){this.netStall=false;this.options.net?.onStall?.(false);}
   if(this.netRole==='host')this.netWriteLocalRecord(next);
   this.applyInputRecord(next);
  }
  this.stepNum++;
  this.stepBody(dt);
  if(this.mode==='net'){
   if(this.netRole==='host'&&this.stepNum%4===3)this.options.net?.onBatch?.(this.stepNum-3);
   if(this.stepNum%24===0)this.options.net?.onHash?.(this.stepNum,this.stateHash());
   if(this.stepNum%120===0)this.pruneRecords();
  }
  return true;
 }
 stepBody(dt){this.age+=dt;if(this.hitstop>0){this.hitstop=Math.max(0,this.hitstop-dt);return;}this.shake=Math.max(0,this.shake-dt*22);this.flash=Math.max(0,this.flash-dt);if(this.bannerLeft>0){this.bannerLeft-=dt;if(this.bannerLeft<=0)this.setBanner('');}this.updateVisuals(dt);if(this.phase!=='fight')this.fighters.forEach(f=>{if(this.phase==='roundend'&&f.hp<=0){f.vy+=1650*dt;f.y=Math.min(FLOOR,f.y+f.vy*dt);if(f.y===FLOOR)f.vy=0;}window.FighterAnimation?.advance(f,dt,FLOOR);});if(this.phase==='intro'){this.phaseTime-=dt;if(this.phaseTime<.75&&this.lastBanner!=='FIGHT!'){this.setBanner('FIGHT!','开打！');this.audio.play('super');}if(this.phaseTime<=0){this.phase='fight';this.setBanner('');}return;}if(this.phase==='roundend'){this.phaseTime-=dt;if(this.phaseTime<=0){if(this.wins.some(n=>n>=2)){this.phase='finished';const team=this.wins[0]>=2?0:1;const winner=this.fighters.find(f=>f.team===team&&f.hp>0)||this.fighters[team];this.winnerTeam=team;this.options.onEnd?.(winner,`${this.wins[0]} : ${this.wins[1]} · 1P 最高 ${this.maxCombo[0]} 连击 · ${this.totalHits[0]} 次命中`);}else{this.round++;this.resetRound();}}return;}if(this.phase!=='fight')return;
 this.time-=this.mode==='training'?0:dt;window.MemeCombat?.step(this,dt);this.ai(dt);for(const f of this.fighters){const o=this.targetFor(f),c=controls[f.controller];if(f.hp<=0){this.retire(f);f.vy+=1650*dt;f.y=Math.min(FLOOR,f.y+f.vy*dt);if(f.y===FLOOR)f.vy=0;continue;}f.cooldowns=f.cooldowns.map(n=>Math.max(0,n-dt*(f.buff?.cooldown||1)));for(const key of ['stun','invuln','slow','counterTime','comboTime','hitFlash','landing','guardBroken'])f[key]=Math.max(0,f[key]-dt);if(f.knocked>0&&f.y>=FLOOR-.1&&f.vy>=0){f.knocked=Math.max(0,f.knocked-dt);f.downTime+=dt;}if(!f.comboTime)f.combo=0;f.energy=clamp(f.energy+dt*(f.data.trait==='charge'?3:2),0,100);if(this.mode==='training'){f.energy=100;if(f.id===1&&f.stun===0&&!this.fighters[0].comboTime)f.hp=Math.min(f.data.hp,f.hp+dt*350);}
 const human=f.controller!==null;const grounded=f.y>=FLOOR-.1;const move=human?(this.keyHeld(f.controller,c.right)?1:0)-(this.keyHeld(f.controller,c.left)?1:0):this.mode!=='training'?f.aiMove:0;const block=human?this.keyHeld(f.controller,c.block):this.mode!=='training'&&f.aiBlock>0;f.blocking=!!(block&&grounded&&!f.attack&&f.stun<=0&&!f.knocked&&f.guardBroken<=0&&f.guard>0);if(!f.blocking)f.guard=clamp(f.guard+dt*15,0,100);if(!f.attack&&f.stun<=0&&!f.knocked){if(move&&(human||!f.blocking))f.facing=Math.sign(move);if(!human&&o&&(f.aiBlock>0||f.queue.length))f.facing=f.aiBlock>0?(f.aiFacing||(o.x>=f.x?1:-1)):(o.x>=f.x?1:-1);}
 if(f.jumpRequest){f.jumpBuffer=.14;f.jumpRequest=false;}if(f.jumpBuffer>0){f.jumpBuffer=Math.max(0,f.jumpBuffer-dt);if(grounded&&!f.attack&&f.stun<=0&&!f.knocked&&!f.blocking){f.jumpBuffer=0;f.vy=f.data.trait==='air'?-680:-600;this.audio.play('jump');this.effect('dust',f.x,FLOOR,'#afa1c1',.3,{radius:25});}f.jumpRequest=false;}
 f.queue=f.queue.filter(q=>{q.ttl-=dt;return q.ttl>0;}).slice(-4);if(f.queue.length&&this.attack(f,f.queue[0].index))f.queue.shift();if(f.stun<=0&&!f.blocking&&!f.knocked){const factor=f.attack?.skill.type==='light'?.25:f.attack?0:1;f.x+=move*f.data.speed*(f.slow>0?.55:1)*(f.buff?.speed||1)*(f.form?.speed||1)*factor*dt;if(move&&factor)f.walk+=dt*12;else f.walk=0;}
 f.x+=f.vx*dt;f.vx*=Math.exp(-9*dt);f.vy+=1650*dt;f.y+=f.vy*dt;if(f.y>FLOOR){if(f.vy>350){f.landing=.12;this.effect('dust',f.x,FLOOR,'#afa1c1',.3,{radius:25});}f.y=FLOOR;f.vy=0;}f.x=clamp(f.x,44,W-44);this.updateAttack(f,dt);f.x=clamp(f.x,44,W-44);}
 for(const f of this.fighters)window.FighterAnimation?.advance(f,dt,FLOOR);
 for(const f of this.fighters)if(f.hp<=0)this.retire(f);
 for(const p of this.projectiles){p.life-=dt;p.x+=p.vx*dt;window.MemeCombat?.projectileStep(this,p,dt);p.trail.push({x:p.x,y:p.y});if(p.trail.length>7)p.trail.shift();for(const target of this.opponents(this.fighters[p.owner])){if(Math.abs(p.x-target.x)<38+p.radius&&Math.abs(p.y-(target.y-83))<72&&p.life>0){if(this.hit(this.fighters[p.owner],target,p.skill,{...p.attack,hit:p.hit,leechSource:p.attack},p.x-Math.sign(p.vx)*40)){window.MemeCombat?.impact(this,p);if(!p.returning||p.turned)p.life=0;break;}}}}
 for(let i=0;i<this.projectiles.length;i++)for(let j=i+1;j<this.projectiles.length;j++){const p=this.projectiles[i],q=this.projectiles[j];if(this.isEnemy(this.fighters[p.owner],this.fighters[q.owner])&&p.life>0&&q.life>0&&Math.abs(p.x-q.x)<25&&Math.abs(p.y-q.y)<27){if(p.skill.pierce){q.life=0;p.skill={...p.skill,pierce:p.skill.pierce-1};}else if(q.skill.pierce){p.life=0;q.skill={...q.skill,pierce:q.skill.pierce-1};}else p.life=q.life=0;this.sparks(p.x,p.y,'#fff',12);}}
 this.projectiles=this.projectiles.filter(p=>p.life>0&&p.x>-60&&p.x<W+60);for(const e of this.effects){if(e.type==='trap'){for(const target of this.opponents(this.fighters[e.owner]))if(e.life>0&&Math.abs(target.x-e.x)<e.radius&&target.y>FLOOR-60){if(this.hit(this.fighters[e.owner],target,e.attack.skill,e.attack,e.x)){e.life=0;this.effect('burst',e.x,FLOOR-35,e.color,.4,{radius:90});}}}}
 if(this.mode==='training'){for(const f of this.fighters){if(f.hp<=0){f.hp=f.data.hp;f.stun=.5;this.text('训练恢复',f.x,f.y-185,'#b8ff83');}}}else if(!this.teamAlive(0)||!this.teamAlive(1)||this.time<=0){const health=[this.teamHealth(0),this.teamHealth(1)];let winner=health[0]>health[1]?0:1;const draw=Math.abs(health[0]-health[1])<.00001;if(!draw)this.wins[winner]++;this.phase='roundend';this.phaseTime=2.4;this.projectiles=[];this.fighters.forEach(f=>{f.queue=[];f.attack=null;f.castPending=null;});this.setBanner(draw?'DRAW':this.time<=0?'TIME UP':'K.O.',draw?'平局 · 再战一回合':this.teamTitle(winner)+' 赢下本回合');this.audio.play('ko');this.options.onHUD?.(this);}
 this.uiClock+=dt;if(this.uiClock>.07){this.options.onHUD?.(this);this.uiClock=0;}}
 updateVisuals(dt){for(const e of this.effects)e.life-=dt;this.effects=this.effects.filter(e=>e.life>0);for(const p of this.particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=520*dt;}this.particles=this.particles.filter(p=>p.life>0).slice(-320);for(const t of this.texts){t.life-=dt;t.y-=28*dt;}this.texts=this.texts.filter(t=>t.life>0);}
 drawFighter(f,alpha=1,x=f.x,y=f.y){
 if(f.hp<=0){alpha*=.3;y=FLOOR;}const ctx=this.ctx,origin=f.attack?.skill.mimicOrigin;
 const actor=origin?{...f,form:null,data:ROSTER_BY_ID.get(origin.characterId),attack:{...f.attack,index:origin.index}}:f;
 if(!this.options.memeVisuals?.form(this,actor,alpha,x,y))window.FighterAnimation.drawCharacter(ctx,actor,this.options,alpha,x,y);
 if(alpha<1)return;this.options.memeVisuals?.status(this,f);
 if(f.counterTime>0){ctx.strokeStyle=f.data.color;ctx.lineWidth=2;ctx.globalAlpha=.65;ctx.strokeRect(f.x-44,f.y-188,88,188);ctx.globalAlpha=1;}
 if(f.blocking)this.drawEffect({type:'shield',x:f.x+f.facing*28,y:f.y-80,color:'#a6eeff',life:.14,max:.22,radius:58});
 }

 drawEffect(e){if(this.options.memeVisuals?.effect(this,e))return;const c=this.ctx,p=1-e.life/e.max,r=e.radius||50;c.save();c.globalAlpha=Math.min(1,e.life*6);c.fillStyle=e.color;c.strokeStyle=e.color;c.lineWidth=e.type==='beam'?8:4;const square=(x,y,w,h)=>c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
 if(e.type==='ghost'){this.drawFighter(this.fighters[e.fighter],.18*(1-p),e.x,e.y);}
 else if(e.type==='beam'){let w=Math.min(e.length||W,e.dir>0?W-e.x:e.x),x=e.dir>0?e.x:e.x-w;c.globalAlpha=(1-p)*.85;square(x,e.y-r/2,w,r);c.fillStyle='#fff9e6';square(x,e.y-5,w,10);for(let i=0;i<9;i++){c.fillStyle=e.color;square(x+((i*113+this.age*650)%Math.max(1,w)),e.y-r-10,25,4);square(x+((i*113+this.age*480)%Math.max(1,w)),e.y+r,45,3);}}
 else if(e.type==='trap'){c.globalAlpha=.35+Math.sin(this.age*8)*.15;square(e.x-r,FLOOR-12,r*2,10);c.globalAlpha=.8;c.strokeRect(e.x-r,FLOOR-26,r*2,20);for(let i=0;i<5;i++)square(e.x-r+i*r*.5,FLOOR-18-Math.sin(this.age*4+i)*9,6,6);}
 else if(e.type==='slam'||e.type==='dust'){c.globalAlpha=(1-p)*.7;const width=r*(.2+p);c.strokeRect(e.x-width,e.y-8-p*28,width*2,10+p*20);for(let i=0;i<9;i++)square(e.x+(i-4)*width/4,e.y-this.fxRandom()*30*(1-p),5+3*p,8);}
 else if(e.type==='shield'){c.lineWidth=3;c.beginPath();c.ellipse(e.x,e.y,r*.43,r,0,0,Math.PI*2);c.stroke();c.globalAlpha=.12;c.fill();}
 else if(e.type==='heal'){for(let i=0;i<5;i++){let x=e.x+Math.sin(i*2)*r,y=e.y-i*18-p*45;square(x-3,y-9,6,18);square(x-9,y-3,18,6);}}
 else if(e.type==='hit'){c.translate(e.x,e.y);for(let i=0;i<8;i++){c.rotate(Math.PI/4);square(r*.2+p*r*.5,-3,r*(1-p),6);}c.fillStyle='#fffbea';square(-8,-8,16,16);}
 else if(e.type==='slash'||e.type==='upper'){c.translate(e.x,e.y);c.scale(e.dir||1,1);c.lineWidth=9*(1-p)+2;c.beginPath();c.arc(-22,12,r*(.8+p*.4),-1.5,.7);c.stroke();c.strokeStyle='#fff7de';c.lineWidth=3;c.stroke();}
 else{c.translate(e.x,e.y);c.rotate(p*1.5);c.lineWidth=3;c.strokeRect(-r*p,-r*p,r*p*2,r*p*2);c.rotate(Math.PI/4);c.strokeRect(-r*p*.7,-r*p*.7,r*p*1.4,r*p*1.4);}c.restore();}
 draw(){const c=this.ctx;if(!c)return;c.imageSmoothingEnabled=false;c.clearRect(0,0,W,H);c.save();if(this.shake>0)c.translate((this.fxRandom()-.5)*this.shake,(this.fxRandom()-.5)*this.shake);const bg=this.options.images?.get('stage');if(bg)c.drawImage(bg,0,0,W,H);else{c.fillStyle='#241f39';c.fillRect(0,0,W,H);}c.fillStyle=this.options.stage?.shade||'#10101b20';c.fillRect(0,0,W,H);c.fillStyle=(this.options.stage?.color||'#d8ff62')+'17';c.fillRect(0,FLOOR+3,W,2);
 for(const f of this.fighters){c.fillStyle='#05050c66';c.beginPath();c.ellipse(f.x,FLOOR+3,50-(FLOOR-f.y)*.09,9,0,0,Math.PI*2);c.fill();}for(const e of this.effects.filter(e=>['trap','ghost'].includes(e.type)))this.drawEffect(e);for(const f of [...this.fighters].sort((a,b)=>(a.hp>0)-(b.hp>0)||a.y-b.y))this.drawFighter(f);if(this.isTeamMatch){for(const f of this.fighters){c.textAlign='center';c.font='bold 13px Microsoft YaHei';c.fillStyle=f.team===0?'#d8ff62':'#ff75a4';c.strokeStyle='#111119';c.lineWidth=4;const label=f.hp<=0?'K.O.':f.controller!==null?(f.controller+1)+'P':(f.team===0?'A':'B')+'·CPU';c.strokeText(label,f.x,f.y-190);c.fillText(label,f.x,f.y-190);}}
 for(const p of this.projectiles){if(this.options.memeVisuals?.projectile(this,p))continue;}

 for(const e of this.effects.filter(e=>!['trap','ghost'].includes(e.type)))this.drawEffect(e);for(const p of this.particles){c.globalAlpha=Math.min(1,p.life*5);c.fillStyle=p.color;c.fillRect(Math.round(p.x),Math.round(p.y),p.size,p.size);}c.globalAlpha=1;for(const t of this.texts){c.globalAlpha=Math.min(1,t.life*4);c.font=`900 ${t.size}px 'Microsoft YaHei',sans-serif`;c.textAlign='center';c.lineWidth=4;c.strokeStyle='#171120';c.strokeText(t.text,t.x,t.y);c.fillStyle=t.color;c.fillText(t.text,t.x,t.y);}c.globalAlpha=1;
 this.fighters.forEach((f,i)=>{if(f.combo>1&&f.comboTime>0){c.textAlign=f.team===0?'left':'right';const x=f.team===0?42:918;c.font='italic 45px Impact, sans-serif';c.fillStyle=f.team===0?'#d8ff62':'#ff75a4';c.strokeStyle='#201429';c.lineWidth=4;const comboY=this.isTeamMatch?225+Math.floor(f.id/2)*65:205;c.strokeText(f.combo+' HIT',x,comboY);c.fillText(f.combo+' HIT',x,comboY);c.font='12px monospace';c.fillStyle='#fff';c.fillText(f.combo>=5?'ABSTRACT COMBO!':'COMBO',x,comboY+20);}});if(this.mode==='training'){c.textAlign='center';c.font='14px monospace';c.fillStyle='#ddd9ee';c.fillText('训练模式 · 无限能量 · 停手后对手恢复',W/2,520);}c.restore();if(this.flash>0){c.fillStyle=`rgba(255,248,221,${this.flash*2.3})`;c.fillRect(0,0,W,H);}c.fillStyle='#0000000c';for(let y=0;y<H;y+=4)c.fillRect(0,y,W,1);}
 // ---- LAN lockstep plumbing (all gated on mode==='net'; local modes untouched) ----
 netWriteLocalRecord(step){const c=this.localController();const slot=this.inputRecords.get(step)||{};slot[c]={k:this.keyMask(this.keys,c),e:this.keyMask(this._ev[c],c)};this._ev[c].clear();this.inputRecords.set(step,slot);}
 netCreateRecords(from,to){const c=this.localController();const out=[];let evStep=-1;for(let s=from;s<=to;s++)if(!this.inputRecords.get(s)?.[c]){evStep=s;break;}
  for(let s=from;s<=to;s++){
   const existing=this.inputRecords.get(s)?.[c];
   if(existing){out.push(existing);continue;}
   const rec={k:this.keyMask(this.keys,c),e:s===evStep?this.keyMask(this._ev[c],c):0};
   const slot=this.inputRecords.get(s)||{};slot[c]=rec;this.inputRecords.set(s,slot);out.push(rec);
  }
  this._ev[c].clear();
  return out;
 }
 netSetRecord(step,controller,rec){const slot=this.inputRecords.get(step)||{};slot[controller]=rec;this.inputRecords.set(step,slot);}
 applyInputRecord(step){
  const rec=this.inputRecords.get(step);
  this.stepKeys[0]=this.decodeMask(rec?.[0]?(rec[0].k|rec[0].e):0,0);
  this.stepKeys[1]=this.decodeMask(rec?.[1]?(rec[1].k|rec[1].e):0,1);
  if(this.paused||this.phase!=='fight')return;
  for(const f of this.fighters){
   if(f.controller===null||f.hp<=0)continue;
   const e=rec?.[f.controller]?.e||0,kb=KEY_BITS[f.controller];
   if(e&kb.jump)f.jumpRequest=true;
   for(let i=0;i<6;i++)if(e&kb.attacks[i])f.queue.push({index:i,ttl:.18});
  }
 }
 netReady(){return !!this.inputRecords.get(this.stepNum+1)?.[1];}
 netCanStep(){const rec=this.inputRecords.get(this.stepNum+1);return !!(rec?.[0]&&rec?.[1]);}
 netBacklog(){let n=0;for(const s of this.inputRecords.keys())if(s>this.stepNum)n++;return n;}
 pruneRecords(){for(const s of [...this.inputRecords.keys()])if(s<this.stepNum-1200)this.inputRecords.delete(s);}
 // Full sim serialization for reconnect handoffs. Attack objects are shared
 // between fighters, projectiles and trap effects, so they travel through a
 // registry that preserves identity after restore.
 snapshot(){
  const attacks=[];
  const reg=a=>{if(!a)return -1;const i=attacks.indexOf(a);if(i>=0)return i;attacks.push(a);return attacks.length-1;};
  return {v:1,step:this.stepNum,age:this.age,phase:this.phase,phaseTime:this.phaseTime,round:this.round,wins:this.wins.slice(),time:this.time,hitstop:this.hitstop,shake:this.shake,flash:this.flash,bannerLeft:this.bannerLeft,lastBanner:this.lastBanner,uiClock:this.uiClock,totalHits:this.totalHits.slice(),maxCombo:this.maxCombo.slice(),fighters:this.fighters.map(f=>this.fighterState(f,reg)),attacks:attacks.map(a=>this.attackState(a)),projectiles:this.projectiles.map(p=>this.projectileState(p,reg)),effects:this.effects.map(e=>this.effectState(e,reg)),particles:this.particles.map(p=>({...p})),texts:this.texts.map(t=>({...t})),prng:this.options.net?.randomState?.()??null};
 }
 fighterState(f,reg){const{data,castPending,attack,...rest}=f;return {...rest,attack:reg(attack),queue:f.queue.map(q=>({...q})),buff:f.buff?{...f.buff}:null,form:f.form?{...f.form}:null,burn:f.burn?{...f.burn}:null,mimicHistory:f.mimicHistory?{...f.mimicHistory}:null};}
 attackState(a){const{hit,...rest}=a;return {...rest,hit:[...hit]};}
 projectileState(p,reg){const{attack,hit,trail,...rest}=p;return {...rest,attack:reg(attack),hit:[...hit],trail:trail.map(t=>({...t}))};}
 effectState(e,reg){const{attack,...rest}=e;return {...rest,attack:reg(attack)};}
 restore(snap){
  const attacks=snap.attacks.map(a=>({...a,hit:new Set(a.hit)}));
  const at=i=>i<0?null:attacks[i];
  this.stepNum=snap.step;this.age=snap.age;this.phase=snap.phase;this.phaseTime=snap.phaseTime;this.round=snap.round;this.wins=snap.wins.slice();this.time=snap.time;this.hitstop=snap.hitstop;this.shake=snap.shake;this.flash=snap.flash;this.bannerLeft=snap.bannerLeft;this.lastBanner=snap.lastBanner;this.uiClock=snap.uiClock;this.totalHits=snap.totalHits.slice();this.maxCombo=snap.maxCombo.slice();
  this.fighters=snap.fighters.map(s=>({...s,data:this.characters[s.id],attack:at(s.attack),queue:s.queue.map(q=>({...q}))}));
  this.projectiles=snap.projectiles.map(s=>({...s,attack:at(s.attack),hit:new Set(s.hit),trail:s.trail.map(t=>({...t}))}));
  this.effects=snap.effects.map(s=>({...s,attack:at(s.attack)}));
  this.particles=snap.particles.map(s=>({...s}));
  this.texts=snap.texts.map(s=>({...s}));
  this.options.net?.setRandomState?.(snap.prng);
  this.netStall=false;this.inputRecords.clear();this._ev.forEach(s=>s.clear());
  this.options.onHUD?.(this);
  this.options.onBanner?.(this.lastBanner,'');
 }
 canonical(v){
  if(v===undefined||v===null)return 'null';
  // Floats are quantized to 1e-4 (far below one pixel) so that last-ulp
  // differences in Math.exp/sin/cos between browser engines do not trip the
  // cross-machine hash check; gross divergence is still caught immediately.
  if(typeof v==='number')return Number.isFinite(v)?String(Math.round(v*1e4)):'nan';
  if(typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(x=>this.canonical(x)).join(',')+']';
  // Sorted keys keep the hash independent of object key insertion order,
  // which differs between live fighters and snapshot-restored clones.
  const keys=Object.keys(v).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+this.canonical(v[k])).join(',')+'}';
 }
 stateHash(){
  let h=0x811c9dc5;const str=this.canonical(this.snapshot());
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return ('0000000'+h.toString(16)).slice(-8);
 }
}
FightGame.KEY_BITS=KEY_BITS;
window.FightGame=FightGame;
})();
