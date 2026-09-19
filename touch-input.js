/* One pointer owns a set of keys. Sliding changes only the keys that differ. */
(()=>{
class FightTouchInput{
 constructor(doc,{getGame,unlock,mapCode}){
  this.doc=doc;this.getGame=getGame;this.unlock=unlock;this.mapCode=mapCode||null;this.pointers=new Map();this.held=new Set();this.cells=new Map();
  this.buttons=[...doc.querySelectorAll('[data-hold]')];this.pad=doc.getElementById('direction-pad');this.directions=[...doc.querySelectorAll('[data-direction]')];
  for(const button of this.buttons){
   button.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;e.preventDefault();unlock();button.setPointerCapture(e.pointerId);this.update(e.pointerId,button.dataset.hold.split(' '));});
   for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,e=>this.drop(e.pointerId));
  }
  if(this.pad){
   this.pad.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;e.preventDefault();unlock();this.pad.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,new Set());this.move(e);});
   this.pad.addEventListener('pointermove',e=>{if(this.pointers.has(e.pointerId)){e.preventDefault();this.move(e);}});
   for(const type of ['pointerup','pointercancel','lostpointercapture'])this.pad.addEventListener(type,e=>this.drop(e.pointerId));
   for(const button of this.directions){
    button.addEventListener('keydown',e=>{if(!['Space','Enter'].includes(e.code))return;e.preventDefault();if(!e.repeat){unlock();this.update('keyboard:'+e.code,button.dataset.direction.split(' '));}});
    button.addEventListener('keyup',e=>{if(['Space','Enter'].includes(e.code)){e.preventDefault();this.drop('keyboard:'+e.code);}});
   }
  }
 }
 update(id,codes){
  this.pointers.set(id,new Set(codes));const next=new Set([...this.pointers.values()].flatMap(set=>[...set]));
  const map=code=>this.mapCode?.[code]||code;
  for(const code of this.held)if(!next.has(code))this.getGame()?.keyUp(map(code));
  for(const code of next)if(!this.held.has(code))this.getGame()?.keyDown(map(code));
  this.held=next;this.paint();
 }
 move(event){
  const rect=this.pad.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
  if(x<0||y<0||x>=rect.width||y>=rect.height){this.cells.delete(event.pointerId);this.update(event.pointerId,[]);return;}
  const old=this.cells.get(event.pointerId);let col=Math.floor(x/rect.width*3),row=Math.floor(y/rect.height*3);
  // Small hysteresis around a grid edge keeps a resting thumb from toggling jump.
  if(old){if(Math.abs(col-old[0])===1&&Math.abs(x-Math.max(col,old[0])*rect.width/3)<3)col=old[0];if(Math.abs(row-old[1])===1&&Math.abs(y-Math.max(row,old[1])*rect.height/3)<3)row=old[1];}
  this.cells.set(event.pointerId,[col,row]);const codes=[];
  if(col===0)codes.push('KeyA');if(col===2)codes.push('KeyD');if(row===0)codes.push('KeyW');if(row===2)codes.push('KeyS');
  this.update(event.pointerId,codes);
 }
 drop(id){if(!this.pointers.has(id))return;this.pointers.delete(id);this.cells.delete(id);this.update(id,[]);this.pointers.delete(id);}
 paint(){
  for(const b of this.buttons)b.classList.toggle('held',b.dataset.hold.split(' ').every(code=>this.held.has(code)));
  const direction=[...this.held].filter(c=>['KeyA','KeyD','KeyW','KeyS'].includes(c)).sort().join(' ');
  for(const b of this.directions)b.classList.toggle('held',b.dataset.direction.split(' ').sort().join(' ')===direction);
 }
 reapply(game=this.getGame()){const map=code=>this.mapCode?.[code]||code;for(const code of this.held)game?.keyDown(map(code));}
 releaseAll(){for(const code of this.held)this.getGame()?.keyUp(code);this.pointers.clear();this.cells.clear();this.held.clear();this.paint();}
}
window.FightTouchInput=FightTouchInput;
})();
