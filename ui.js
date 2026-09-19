const $=id=>document.getElementById(id);
let selected=[ROSTER.findIndex(c=>c.name==='奶龙'),ROSTER.findIndex(c=>c.name==='电棍'),ROSTER.findIndex(c=>c.name==='贝拉'),ROSTER.findIndex(c=>c.name==='七海')],side=0,mode='cpu',difficulty=1,currentGame=null,sound=true;
const net=new NetClient();
const images=new Map(),animationSheets=new Map();let ready=false;
const stagePicker=new StagePicker();let currentStage=null,starting=false,musicEnabled=true,musicStarted=false,startTicket=0;
let musicWindowFocused=document.hasFocus?.()??true;
const assetURL=url=>window.EMBEDDED_IMAGES?.[url]||url;
function sprite(c){return c.file;}
const mobileQuery=window.matchMedia('(pointer:coarse)');
const isMobile=()=>mobileQuery.matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&navigator.platform==='MacIntel');
const modeNames={cpu:'人机 1V1',local:'双人 1V1',training:'训练场','team-cpu':'单人 2V2','team-coop':'双人合作 2V2','team-versus':'双人对抗 2V2',net:'联网 1V1'};
const teamMode=()=>mode.startsWith('team-');
const activeSlots=()=>teamMode()?[0,1,2,3]:[0,1];
const activeSelected=()=>activeSlots().map(i=>selected[i]);
const slotController=i=>i===0?0:i===1&&['local','team-versus'].includes(mode)?1:i===2&&mode==='team-coop'?1:null;
function slotLabel(i){const player=slotController(i);if(mode==='net'){const you=net?.role==='guest'?1:0;return i===you?'你':i===0?'1P · 房主':'2P · 对手';}return teamMode()?(i%2===0?'A':'B')+(i<2?'1':'2')+' · '+(player===null?'CPU':(player+1)+'P'):player===null?(mode==='training'?'训练对手':'CPU'):(player+1)+'P';}
function changeMode(next){if(starting)return;if(isMobile()&&['local','team-coop','team-versus'].includes(next))return;if(mode==='net'&&next!=='net')net.leave();mode=next;if(!activeSlots().includes(side))side=0;refresh();}
const animatedNames=ROSTER.filter(c=>window.ANIMATIONS?.[c.id]).map(c=>c.name);
const audioFX={ctx:null,muted:false,say(text,pitch=1){if(this.muted||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;try{const u=new SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=.9;u.pitch=pitch;u.volume=.7;const voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('zh'));if(voice)u.voice=voice;speechSynthesis.cancel();speechSynthesis.speak(u);}catch{}},unlock(){try{if(!this.ctx)this.ctx=new(window.AudioContext||window.webkitAudioContext)();this.ctx.resume();}catch{}},tone(freq=250,duration=.1,type='square',volume=.06){if(this.muted||!this.ctx)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(35,freq/3),t+duration);g.gain.setValueAtTime(volume,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g).connect(this.ctx.destination);o.start(t);o.stop(t+duration);},play(kind){const cfg={light:[380,.07],heavy:[140,.18],hit:[180,.1],block:[680,.055],super:[780,.55],select:[650,.06],jump:[260,.12],ko:[105,.65],cast:[470,.17]};this.tone(...(cfg[kind]||cfg.hit));}};
const music=new FighterMusic({getContext:()=>audioFX.ctx,volume:.22});
music.play('select');
function syncMusic(){music.setMuted(!musicEnabled);music.setPaused(!musicWindowFocused||document.hidden||!!currentGame?.paused);music.play(currentGame&&currentStage?currentStage.music:'select');updateMusicLabel();}
function updateMusicLabel(){$('music').textContent=(musicEnabled?'♫ BGM 开':'♫ BGM 关')+' ▾';const id=currentGame&&currentStage?currentStage.music:'select';const track=FighterMusic.tracks[id];$('now-playing').textContent=!musicEnabled?'BGM 已关闭':!musicStarted?'点击任意按钮，开启选角 BGM':(currentGame?.paused?'已暂停 · ':'正在播放 · ')+(track?.title||track?.name||id);document.querySelectorAll('[data-bgm-toggle]').forEach(b=>{b.textContent=musicEnabled?'♫ BGM 开':'♫ BGM 关';b.setAttribute('aria-pressed',String(musicEnabled));});}
function unlockMusic(){audioFX.unlock();if(!musicEnabled)return;music.unlock().then(()=>{musicStarted=audioFX.ctx?.state==='running';syncMusic();}).catch(()=>{});}
function toggleMusic(){musicEnabled=!musicEnabled;syncMusic();if(musicEnabled)unlockMusic();}
document.querySelectorAll('[data-bgm-toggle]').forEach(b=>b.onclick=toggleMusic);
document.addEventListener('pointerdown',e=>{const settings=$('music-settings');if(settings.open&&!settings.contains(e.target))settings.open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('music-settings').open){$('music-settings').open=false;$('music').focus();e.stopImmediatePropagation();e.preventDefault();}},{capture:true});
$('music-volume').oninput=e=>{const value=+e.target.value;music.setVolume(value/100*.63);$('music-volume-value').textContent=value+'%';};
document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('[data-bgm-toggle]'))unlockMusic();},{capture:true});
document.addEventListener('keydown',e=>{if(!e.repeat)unlockMusic();},{capture:true});
window.addEventListener('blur',()=>{musicWindowFocused=false;syncMusic();});
window.addEventListener('focus',()=>{musicWindowFocused=true;syncMusic();});
document.addEventListener('visibilitychange',syncMusic);
window.addEventListener('pagehide',()=>music.stop());
window.addEventListener('pageshow',()=>{musicWindowFocused=document.hasFocus?.()??true;syncMusic();});
function renderStages(){
 $('stage-grid').innerHTML='<button class="stage-card stage-random active" data-stage="random" aria-pressed="true"><span class="stage-random-art">?</span><b>随机场景</b></button>'+STAGES.map(s=>`<button class="stage-card" data-stage="${s.id}" aria-pressed="false" title="${s.description}"><img src="${assetURL(s.thumbnail||s.file)}" loading="lazy" alt="${s.name}像素场景"><b>${s.name}</b></button>`).join('');
 $('stage-grid').querySelectorAll('button').forEach(b=>b.onclick=()=>{stagePicker.select(b.dataset.stage);refreshStage();audioFX.play('select');});
 refreshStage();
}
function refreshStage(){const selectedStage=STAGES.find(s=>s.id===stagePicker.selected);$('stage-grid').querySelectorAll('button').forEach(b=>{const active=b.dataset.stage===stagePicker.selected;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('stage-choice-status').textContent=selectedStage?'已选 · '+selectedStage.name:'每场随机 · 同场回合保持场景';$('stage-caption').textContent=selectedStage?selectedStage.name:'随机场景 · 开打时揭晓';document.querySelector('.select-stage').style.backgroundImage=`url("${assetURL((selectedStage||STAGES[0]).file)}")`;}
function refreshNetStageLock(){const locked=mode==='net'&&net?.role==='guest';$('stage-grid').querySelectorAll('button').forEach(b=>{b.disabled=locked;b.title=locked?'场景由房主选择':(b.title||'');});if(locked){$('stage-choice-status').textContent='场景由房主选择';$('stage-caption').textContent='场景由房主选择';}}
renderStages();
function skillHTML(c){return c.skills.map((s,i)=>`<div class="skill ${s.super?'super':''}" data-skill="${i}"><kbd>${s.key}</kbd><div><b>${s.name}</b><p>${s.mimic?'随机招式':s.damage?((s.count||s.pulses)?(s.count||s.pulses)+' × ':'')+s.damage+' 基础伤害':s.type==='wall'?'可破坏障碍':'持续强化'}${s.mimic?(s.super?' · 100 气':' · 冷却随招式'):s.cd?' · '+s.cd+'s 冷却':s.super?' · 100 气':''}<br>${s.desc}</p></div></div>`).join('');}
function refresh(){
 const slots=activeSlots();if(!slots.includes(side))side=0;$('selection').classList.toggle('team-selection',teamMode());$('team-options').hidden=!teamMode();
 for(let p=0;p<4;p++){
  const enabled=slots.includes(p),button=$('choose'+(p+1)),canvas=$('portrait'+(p+1));button.hidden=!enabled;canvas.closest('.fighter-preview').hidden=!enabled;if(!enabled)continue;
  const c=ROSTER[selected[p]];canvas.setAttribute('aria-label',slotLabel(p)+' '+c.name+' · 实战待机动画');ensureCharacter(c,true).then(()=>{drawCard(c);trimSheets();}).catch(showAssetError);
  $('name'+(p+1)).textContent=c.name;$('style'+(p+1)).textContent=c.title+' / '+c.style.split(' / ')[0];$('quote'+(p+1)).textContent=c.quote;$('p'+(p+1)+'tag').textContent=slotLabel(p);button.textContent=slotLabel(p)+' 选人';button.classList.toggle('active',side===p);button.setAttribute('aria-pressed',String(side===p));
 }
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode==='team-cpu'?teamMode():b.dataset.mode===mode));
 document.querySelectorAll('[data-team-mode]').forEach(b=>b.classList.toggle('active',b.dataset.teamMode===mode));
 $('team-description').textContent={'team-cpu':'你与 CPU 队友迎战两名 CPU。','team-coop':'1P 与 2P 同队，迎战两名 CPU。','team-versus':'1P 与 2P 各带一名 CPU 队友，分队对抗。'}[mode]||'';
 $('round-rules').textContent=mode==='net'?'联网对战 · 双方各自选人并点「开打」 · 场景由房主选择 · 先赢两回合':teamMode()?'四人同时上场 · 队内无伤害 · 全队倒下判负 · 90 秒 / 回合':'两胜制 · 60 秒 / 回合 · 全角色解锁';
 $('net-panel').hidden=mode!=='net';
 $('roster').querySelectorAll('button').forEach((b,i)=>{const chosen=slots.filter(p=>selected[p]===i);b.classList.toggle('p1',chosen.some(p=>p%2===0));b.classList.toggle('p2',chosen.some(p=>p%2===1));b.setAttribute('aria-pressed',String(i===selected[side]));const tag=b.querySelector('.slot-tag');tag.hidden=!chosen.length;tag.textContent=chosen.map(p=>teamMode()?(p%2===0?'A':'B')+(p<2?'1':'2'):mode==='net'?(p===0?'房主':'对手'):p===0?'1P':mode==='local'?'2P':'CPU').join('/');});
 const c=ROSTER[selected[side]];$('skill-owner').textContent=slotLabel(side)+' · '+c.name;$('passive').textContent=c.passive[0]+'：'+c.passive[1];$('skills').innerHTML=skillHTML(c);document.querySelector('.difficulty').style.opacity=['local','training','net'].includes(mode)?'.45':'1';
 refreshNetStageLock();
}
$('roster').innerHTML=ROSTER.map(c=>`<button class="character" title="${c.name} · ${c.title}" aria-label="选择${c.name}"><canvas width="96" height="96" aria-hidden="true"></canvas><span class="slot-tag" hidden></span><span class="char-name">${c.name}</span></button>`).join('');
$('roster').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>{selected[side]=i;audioFX.unlock();audioFX.play('select');refresh();if(mode==='net')net.sendPick(i);});
for(let i=0;i<4;i++)$('choose'+(i+1)).onclick=()=>{if(starting)return;side=i;refresh();};$('random').onclick=()=>{if(starting)return;selected[side]=Math.floor(Math.random()*ROSTER.length);refresh();if(mode==='net')net.sendPick(selected[side]);};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.mode));document.querySelectorAll('[data-team-mode]').forEach(b=>b.onclick=()=>changeMode(b.dataset.teamMode));
document.querySelectorAll('[data-difficulty]').forEach(b=>b.onclick=()=>{difficulty=Number(b.dataset.difficulty);document.querySelectorAll('[data-difficulty]').forEach(x=>x.classList.toggle('active',x===b));});
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('图片加载失败：'+url));im.src=url;});}
function buildHUD(count){
 const card=i=>`<div class="hud-player ${i%2?'second':''}" id="hud-card${i+1}"><div><b id="hud-name${i+1}"></b><span id="score${i+1}"></span></div><div class="health"><span id="hp${i+1}"></span></div><small id="health${i+1}"></small><div class="energy"><span id="mp${i+1}"></span></div></div>`;
 document.querySelector('.hud').classList.toggle('team-hud',count===4);document.querySelector('.hud').innerHTML=`<div class="hud-team">${card(0)}${count===4?card(2):''}</div><div class="timer"><small id="round">ROUND 1</small><b id="timer">60</b></div><div class="hud-team">${card(1)}${count===4?card(3):''}</div>`;
}
async function startGame(){
 if(starting)return;
 if(mode==='net'){net.startClicked();return;}
 starting=true;lastResourceTrim=0;
 if(isMobile()&&mode==='local'){mode='cpu';applyDeviceModes();}
 const matchMode=mode,matchDifficulty=difficulty;
 const chosenStage=stagePicker.choose();
 const chars=activeSelected().map(i=>ROSTER[i]);
 launchGame(chars,matchMode,matchDifficulty,chosenStage);
}
async function launchGame(chars,matchMode,matchDifficulty,chosenStage,extra={}){
 const ticket=++startTicket;
 releaseTouches();unlockMusic();
 $('selection').inert=true;$('rematch').disabled=true;$('start').disabled=true;$('quick-start').disabled=true;$('start').textContent='角色入场中…';
 try{
  const needIds=new Set(chars.flatMap(c=>[c.id,...c.skills.filter(s=>s.summonId!=null).map(s=>s.summonId)]));
  await Promise.all([...needIds].map(id=>ensureCharacter(ROSTER_BY_ID.get(id))));
  await window.MemeVisuals?.load?.(loadImage,chars);
  const stageImage=await loadImage(chosenStage.file);
  if(ticket!==startTicket)return null;
  if(isMobile()&&['local','team-coop','team-versus'].includes(matchMode))throw Error('当前设备请选单人模式，再点击开打');
  images.set('stage',stageImage);currentStage=chosenStage;stagePicker.commit(chosenStage);
  if(currentGame)currentGame.destroy();
  window.MemeVisuals?.releaseUnused?.();
  $('selection').hidden=true;$('battle').hidden=false;document.body.classList.add('in-battle');$('end').hidden=true;
  buildHUD(chars.length);
  $('battle-mode').textContent=modeNames[matchMode]+(matchMode==='net'?' · '+(net?.role==='host'?'房主':'对手'):'')+' · '+currentStage.name;
  const localIndex=matchMode==='net'&&net?.role==='guest'?1:0;
  $('battle-skills').innerHTML=skillHTML(chars[localIndex]);
  $('battle-guide').open=!isMobile();
  document.querySelectorAll('[data-touch-skill]').forEach(b=>{const i=+b.dataset.touchSkill;b.querySelector('b').textContent=chars[localIndex].skills[i].name;b.setAttribute('aria-label',chars[localIndex].skills[i].name);});
  $('battle-tip').textContent=matchMode==='net'?(net.role==='host'?'房主视角 · 按 ESC 暂停 · 双方都点再来一局即重开':'对手视角 · 方向键或 WASD 移动 · 小键盘或 J K U I O L 出招 · 暂停由房主操作'):['local','team-coop','team-versus'].includes(matchMode)?'2P：方向键移动 · 数字小键盘 1 2 4 5 6 3':'按 ESC 暂停';
  currentGame=new FightGame($('game'),chars,{mode:matchMode,difficulty:matchDifficulty,stage:currentStage,images,animationSheets,animations:window.ANIMATIONS,memeVisuals:window.MemeVisuals,audio:audioFX,prepareSkill,onRoundReset:g=>touchInput.reapply(g),onPause:paused=>{releaseTouches();syncMusic();$('pause').textContent=paused?'继续 ESC':'暂停 ESC';$('resume-battle').hidden=!paused;if(matchMode==='net')net?.onGamePause?.(paused);},onHUD:updateHUD,onBanner:showBanner,onEnd:showEnd,...extra});
  currentGame.start();
  $('pause').textContent='暂停 ESC';$('resume-battle').hidden=true;
  if(matchMode==='net'&&net?.role==='guest'){$('pause').disabled=true;$('pause').title='只有房主可以暂停';}
  syncMusic();$('game').focus();window.scrollTo(0,0);
  return currentGame;
 }catch(e){if(ticket===startTicket)$('start').textContent=e.message+'，点击重试';return null;}
 finally{if(ticket===startTicket){$('selection').inert=false;starting=false;$('rematch').disabled=false;$('start').disabled=false;$('quick-start').disabled=false;$('start').innerHTML='准备好了，开打！ <span>↗</span>';}}
}
/* Entry point for net.js: build the shared match from the host's go/snap message.
   Concurrent calls are safe: launchGame's ticket lets the latest one win. */
async function launchNetGame(fighterIndices,stageId,extra={}){
 starting=true;
 const chars=fighterIndices.map(i=>ROSTER[i]);
 const chosenStage=STAGES.find(s=>s.id===stageId)||stagePicker.choose();
 return launchGame(chars,'net',difficulty,chosenStage,extra);
}
let lastResourceTrim=0;
async function prepareSkill(skill){const ids=new Set([skill.summonId,skill.mimicOrigin?.characterId].filter(id=>id!=null));await Promise.all([MemeVisuals.load(loadImage,[{skills:[skill]}],true),...[...ids].map(id=>ensureCharacter(ROSTER_BY_ID.get(id)))]);}
function updateHUD(g){if(g.age-lastResourceTrim>1){lastResourceTrim=g.age;trimSheets();MemeVisuals.releaseUnused(g);}const touchFighter=g.fighters[g.mode==='net'&&net?.role==='guest'?1:0];document.querySelectorAll('[data-touch-skill]').forEach(b=>{const f=touchFighter,i=+b.dataset.touchSkill,cd=f.cooldowns[i];b.querySelector('em').textContent=f.hp<=0?'K.O.':f.castPending?.index===i?'…':cd>0?cd.toFixed(1):i===5&&f.energy<100?Math.floor(f.energy)+'气':'';b.classList.toggle('available',f.hp>0&&cd<=0&&(i!==5||f.energy>=100));});g.fighters.forEach((f,i)=>{const n=i+1,team=f.team??i;$('hud-name'+n).textContent=(g.isTeamMatch?(f.controller===null?'CPU':(f.controller+1)+'P')+' · ':'')+f.data.name;$('hp'+n).style.width=(f.hp/f.data.hp*100)+'%';$('health'+n).textContent=f.hp<=0?'K.O. · 已退场':`${Math.ceil(f.hp)} / ${f.data.hp}  ·  防御 ${Math.ceil(f.guard)}%`;$('mp'+n).style.width=f.energy+'%';$('mp'+n).style.background=f.energy>=100?'#d8ff62':'#76e7ff';$('score'+n).textContent=i<2?'●'.repeat(g.wins[team])+'○'.repeat(2-g.wins[team]):'';$('hud-card'+n).classList.toggle('defeated',f.hp<=0);});$('timer').textContent=g.mode==='training'?'∞':Math.max(0,Math.ceil(g.time));$('round').textContent='ROUND '+g.round;$('battle-skills').querySelectorAll('.skill').forEach((el,i)=>{let cd=touchFighter.cooldowns[i],existing=el.querySelector('.cooldown');let msg=cd>0?cd.toFixed(1):i===5&&touchFighter.energy<100?Math.floor(touchFighter.energy)+' / 100':'';if(msg){if(!existing){existing=document.createElement('span');existing.className='cooldown';el.append(existing);}existing.textContent=msg;}else existing?.remove();});}
function showBanner(title,sub=''){$('banner-text').textContent=title;$('banner-sub').textContent=sub;}
function showEnd(winner,stats){$('end').hidden=false;$('end-sub').textContent='MATCH COMPLETE';$('end-title').textContent=(currentGame?.isTeamMatch?currentGame.teamTitle(winner.team):winner.data.name)+' 获胜';$('end-info').textContent=stats;showBanner('');}
function goBack(){$('selection').inert=false;startTicket++;starting=false;$('rematch').disabled=false;$('start').disabled=false;$('quick-start').disabled=false;$('start').innerHTML='准备好了，开打！ <span>↗</span>';if(currentGame){currentGame.destroy();currentGame=null;}$('battle').hidden=true;$('selection').hidden=false;document.body.classList.remove('in-battle');releaseTouches();$('end').hidden=true;$('pause').disabled=false;$('pause').title='';syncMusic();refresh();refreshStage();net?.onBack();}
$('start').onclick=startGame;$('quick-start').onclick=startGame;$('back').onclick=goBack;$('reselect').onclick=goBack;$('rematch').onclick=()=>{if(mode==='net'&&net.inMatch)net.rematch();else startGame();};$('pause').onclick=()=>{if(mode==='net'&&net?.role==='guest')return;currentGame?.togglePause();};$('resume-battle').onclick=()=>{if(currentGame?.paused)currentGame.togglePause(false);};
$('help').onclick=()=>{if(currentGame&&!currentGame.paused)currentGame.togglePause();$('help-dialog').showModal();};$('close-help').onclick=()=>$('help-dialog').close();$('help-dialog').addEventListener('click',e=>{if(e.target===$('help-dialog'))$('help-dialog').close();});
$('sound').onclick=()=>{sound=!sound;audioFX.muted=!sound;if(!sound)window.speechSynthesis?.cancel();$('sound').textContent=sound?'♪ 音效开':'♪ 音效关';if(sound)audioFX.unlock();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('fullscreen').textContent='不支持';}};
// Block browser gestures on the play surfaces without cancelling menu clicks or scrolling.
for(const surface of [$('arena'),$('touch')]){
 for(const type of ['contextmenu','selectstart','dragstart','dblclick']){
  surface.addEventListener(type,e=>{if(e.cancelable)e.preventDefault();});
 }
}
const touchInput=new FightTouchInput(document,{getGame:()=>currentGame,unlock:()=>audioFX.unlock(),mapCode:()=>mode==='net'&&net?.role==='guest'?NET.P1_TO_P2:null});
function releaseTouches(){touchInput.releaseAll();}
window.addEventListener('blur',releaseTouches);
window.addEventListener('orientationchange',releaseTouches);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseTouches();});
const pendingAssets=new Map();
function trimSheets(){const keep=new Set(activeSelected().map(i=>ROSTER[i].id));for(const c of [...activeSelected().map(i=>ROSTER[i]),...(currentGame?.characters||[])]){keep.add(c.id);for(const s of c.skills)if(s.summonId!=null)keep.add(s.summonId);}for(const f of currentGame?.fighters||[])for(const s of [f.attack?.skill,f.castPending?.skill]){if(s?.summonId!=null)keep.add(s.summonId);if(s?.mimicOrigin)keep.add(s.mimicOrigin.characterId);}for(const p of currentGame?.projectiles||[])if(p.summonId!=null)keep.add(p.summonId);for(const id of animationSheets.keys())if(!keep.has(id)&&![...pendingAssets.keys()].some(k=>k.startsWith(id+':')))animationSheets.delete(id);}
function showAssetError(e){$('animation-status').hidden=false;$('animation-status').textContent=e.message+'；请重新选择该角色重试。';}
const idleFrames=entry=>[...(entry.clips.idle||[]),...Object.values(entry.directionalClips||{}).flatMap(clips=>clips.idle||[])];
async function ensureCharacter(c,previewOnly=false){
 if(!c)return;const entry=window.ANIMATIONS?.[c.id];
 if(!entry){if(!images.has(c.id)){const k='portrait:'+c.id;if(!pendingAssets.has(k))pendingAssets.set(k,loadImage(c.file).then(im=>images.set(c.id,im)).finally(()=>pendingAssets.delete(k)));await pendingAssets.get(k);}return;}
 if(!animationSheets.has(c.id))animationSheets.set(c.id,new Map());
 const sheets=animationSheets.get(c.id),needed=previewOnly?[...new Set(idleFrames(entry).map(r=>r.sheet))]:Object.keys(entry.sheets);
 await Promise.all(needed.map(async key=>{if(sheets.has(key))return;const k=c.id+':'+key;if(!pendingAssets.has(k))pendingAssets.set(k,loadImage(entry.sheets[key]).then(im=>sheets.set(key,FighterAnimation.prepareSheet(im,entry))).finally(()=>pendingAssets.delete(k)));await pendingAssets.get(k);}));
}
function previewFighter(c,facing,time){return {data:c,x:0,y:443,facing,hp:1,vy:0,knocked:0,stun:0,blocking:false,attack:null,landing:0,walk:0,animTime:time,hitFlash:0,invuln:0};}
const previewResources={images,animationSheets,animations:window.ANIMATIONS};
function drawPreview(canvas,c,facing,time,card=false){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
 const entry=window.ANIMATIONS?.[c.id],sheets=animationSheets.get(c.id);
 if(entry&&!idleFrames(entry).every(r=>sheets?.has(r.sheet)))return;
 ctx.save();const scale=card?.46:1.3;ctx.translate(canvas.width/2,card?93:276);ctx.scale(scale,scale);
 FighterAnimation.drawCharacter(ctx,previewFighter(c,facing,time),previewResources,1,0,0);ctx.restore();
}
function drawCard(c){const canvas=$('roster').children[ROSTER.indexOf(c)]?.querySelector('canvas');if(canvas)drawPreview(canvas,c,1,0,true);}
let previewTime=0,previewLast=0;
function animateSelection(now){const dt=Math.min((now-previewLast)/1000,.05);previewLast=now;if(!$('selection').hidden&&!document.hidden){previewTime+=dt;for(const p of activeSlots())drawPreview($('portrait'+(p+1)),ROSTER[selected[p]],p%2===0?1:-1,previewTime);for(const id of new Set(activeSelected())){const c=ROSTER[id],canvas=$('roster').children[id].querySelector('canvas');const owner=selected[side]===id?side:activeSlots().find(p=>selected[p]===id);drawPreview(canvas,c,owner%2===0?1:-1,previewTime,true);}}requestAnimationFrame(animateSelection);}
// Fetch visible roster rows first; each thumbnail retains the actual idle crop
// after its full sheet is released, keeping phone memory bounded.
function loadCards(){
 const queue=[],queued=new Set();let workers=0;
 function pump(){while(workers<3&&queue.length){const c=queue.shift();workers++;ensureCharacter(c,true).then(()=>{drawCard(c);trimSheets();}).catch(showAssetError).finally(()=>{workers--;pump();});}}
 function enqueue(id){if(!queued.has(id)){queued.add(id);queue.push(ROSTER[id]);pump();}}
 if(!window.IntersectionObserver){ROSTER.forEach((c,i)=>enqueue(i));return;}
 const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){enqueue(+e.target.dataset.characterId);observer.unobserve(e.target);}},{rootMargin:'180px'});
 [...$('roster').children].forEach((b,id)=>{b.dataset.characterId=id;observer.observe(b);});
}
function applyDeviceModes(){const mobile=isMobile();document.body.classList.toggle('mobile-device',mobile);document.querySelectorAll('[data-mode="local"],[data-team-mode="team-coop"],[data-team-mode="team-versus"]').forEach(button=>{button.hidden=mobile;button.disabled=mobile;});$('p2-help').hidden=mobile;$('battle-guide').open=!mobile;if(mobile&&['local','team-coop','team-versus'].includes(mode))mode=teamMode()?'team-cpu':'cpu';refresh();}
mobileQuery.addEventListener?.('change',applyDeviceModes);
applyDeviceModes();loadCards();requestAnimationFrame(animateSelection);
// LAN room panel + auto-join (?room=CODE or a saved session after page reload).
$('net-relay').value=NET.relayURL();
$('net-host').onclick=()=>{net.createRoom();};
$('net-connect').onclick=()=>{const code=$('net-code').value.trim();if(code.length<4){net.status('请输入 4 位房间码','error');return;}net.joinRoom(code);};
$('net-code').addEventListener('keydown',e=>{if(e.key==='Enter')$('net-connect').click();});
$('net-code').addEventListener('input',()=>{$('net-code').value=$('net-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'');});
const roomParam=new URLSearchParams(location.search).get('room');
let savedJoin=null;try{savedJoin=JSON.parse(sessionStorage.getItem('net-join'));}catch{}
if(roomParam){mode='net';refresh();net.joinRoom(roomParam);}
else if(savedJoin?.room&&savedJoin.role&&savedJoin.inMatch){
 // Resume only a match that was in progress; stale lobby sessions must not
 // auto-connect with old roles and rooms.
 mode='net';refresh();net.resume(savedJoin);
}else if(savedJoin){try{sessionStorage.removeItem('net-join');}catch{}}

