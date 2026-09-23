(() => {
  const root = document.getElementById('game-root');
  if (!root) return;

  const game = root.dataset.game;
  const mode = root.dataset.mode;
  const matchId = root.dataset.matchId;
  let submitted = false;

  const clamp = (n,a,b) => Math.max(a, Math.min(b,n));
  const rand = (a,b) => a + Math.random() * (b-a);
  const randi = (a,b) => Math.floor(rand(a,b+1));

  function shell(title, instructions) {
    root.innerHTML = `<div class="game-shell"><h2>${title}</h2><p class="muted game-instructions">${instructions}</p><div id="game-ui"></div><div id="game-msg"></div></div>`;
    return document.getElementById('game-ui');
  }

  async function finish(score, cpuWon, extra='') {
    if (submitted) return;
    submitted = true;
    score = clamp(Math.round(score), 0, 10000);
    const msg = document.getElementById('game-msg');
    if (mode === 'cpu') {
      const won = !cpuWon;
      try {
        const res = await fetch(`/api/cpu-result/${game}`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({won})
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save result');
        msg.innerHTML = `<section class="panel result"><h2 class="${won?'win':'loss'}">${won?'YOU WIN':'CPU WINS'}</h2><p>Your run score: <strong>${score}</strong>${extra ? ` · ${extra}` : ''}</p><a class="btn" href="">Play Again</a> <a class="btn" href="/dashboard">Dashboard</a></section>`;
      } catch (e) {
        submitted = false;
        msg.innerHTML = `<section class="panel"><p class="loss">${e.message}</p><button class="btn" onclick="location.reload()">Reload</button></section>`;
      }
    } else {
      try {
        const res = await fetch(`/api/pvp/${matchId}/score`, {
          method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({score})
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not submit score');
        msg.innerHTML = `<section class="panel"><h2>Score locked: ${score}</h2><p>${data.status==='completed'?'Match complete.':'Waiting for opponent.'}</p><a class="btn primary" href="/pvp/${matchId}">Refresh Match</a></section>`;
      } catch (e) {
        submitted = false;
        msg.innerHTML = `<p class="loss">${e.message}</p>`;
      }
    }
  }

  function pointerPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left) * canvas.width/r.width, y:(e.clientY-r.top) * canvas.height/r.height};
  }

  function roundedRect(ctx,x,y,w,h,r,fill=true) {
    ctx.beginPath();
    ctx.roundRect(x,y,w,h,r);
    fill ? ctx.fill() : ctx.stroke();
  }

  // ---------------- CUP PONG ----------------
  function cupPong() {
    const ui = shell('Cup Pong', 'Click/touch the ball, drag toward the cups, then release. You get 10 throws. A clean cup hit removes that cup.');
    ui.innerHTML = `<div class="scoreline">Throws <span id="throws">0</span>/10 · Cups sunk <span id="sunk">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas><div class="throw-tip">Drag the ball upward to aim and set power.</div>`;
    const c=ui.querySelector('#arena'), ctx=c.getContext('2d');
    const cupLayout=[[360,72],[325,108],[395,108],[290,144],[360,144],[430,144],[255,180],[325,180],[395,180],[465,180]];
    let cups=cupLayout.map(([x,y],i)=>({x,y,alive:true,i}));
    let ball={x:360,y:468,z:0}; let dragging=false, start=null, aim=null, flying=false, throws=0, sunk=0, raf;

    function draw() {
      ctx.clearRect(0,0,c.width,c.height);
      ctx.fillStyle='#542514'; roundedRect(ctx,80,35,560,450,24,true);
      ctx.fillStyle='#f0e7d2'; ctx.globalAlpha=.09; for(let i=0;i<7;i++) ctx.fillRect(120+i*80,35,2,450); ctx.globalAlpha=1;
      ctx.fillStyle='#202823'; ctx.fillRect(80,250,560,3);
      cups.forEach(cp=>{if(!cp.alive)return; ctx.fillStyle='#d93939'; ctx.beginPath();ctx.ellipse(cp.x,cp.y,22,13,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.78;ctx.beginPath();ctx.ellipse(cp.x,cp.y-2,16,8,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;});
      if(dragging && start && aim){ctx.strokeStyle='#ffc857';ctx.lineWidth=3;ctx.setLineDash([8,7]);ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();ctx.setLineDash([]);}
      const scale=1+ball.z/90;
      ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.ellipse(ball.x,ball.y+8,12,5,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#f7f6ef';ctx.beginPath();ctx.arc(ball.x,ball.y,8*scale,0,Math.PI*2);ctx.fill();
      if(!flying && !dragging){ctx.fillStyle='#aab3ac';ctx.font='15px system-ui';ctx.textAlign='center';ctx.fillText('DRAG TO THROW',360,505);}
    }
    function resetBall(){ball={x:360,y:468,z:0};flying=false;draw();}
    function resolveThrow(vx,vy,vz){flying=true;let frames=0;function step(){frames++;ball.x+=vx;ball.y+=vy;ball.z+=vz;vz-=0.56;vx*=.997;vy*=.997;let hit=null;if(ball.z<24){for(const cp of cups){if(cp.alive && Math.hypot(ball.x-cp.x,ball.y-cp.y)<23){hit=cp;break;}}}if(hit){hit.alive=false;sunk++;ui.querySelector('#sunk').textContent=sunk;flying=false;draw();setTimeout(nextThrow,420);return;}if(ball.z<=0 && frames>8){ball.z=0;flying=false;draw();setTimeout(nextThrow,350);return;}draw();raf=requestAnimationFrame(step);}step();}
    function nextThrow(){throws++;ui.querySelector('#throws').textContent=throws;if(throws>=10 || sunk===10){const cpu=randi(3,8);const score=Math.min(10000,sunk*1000);finish(score,sunk<cpu,`CPU sunk ${cpu}`);return;}resetBall();}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-ball.x,p.y-ball.y)>45)return;c.setPointerCapture(e.pointerId);dragging=true;start={x:ball.x,y:ball.y};aim=p;draw();});
    c.addEventListener('pointermove',e=>{if(!dragging)return;aim=pointerPos(c,e);draw();});
    c.addEventListener('pointerup',e=>{if(!dragging)return;const p=pointerPos(c,e);dragging=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);if(mag<28 || dy>-10){aim=null;draw();return;}aim=null;const power=clamp(mag,35,230);resolveThrow(clamp(dx*.055,-9,9),clamp(dy*.055,-11,-2.2),clamp(5.5+power*.035,6,13));});
    draw();
  }

  // ---------------- BEER DIE ----------------
  function beerDie() {
    const ui=shell('Beer Die', 'Grab the die at your end of the table, drag upward, and release. Score by landing the die on the opponent half; corner cup hits are worth more. Six throws.');
    ui.innerHTML=`<div class="scoreline">Throw <span id="round">1</span>/6 · Points <span id="pts">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas><div class="throw-tip">Opponent half = 1 point · corner cup = 3 points.</div>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let die={x:360,y:460,z:0,r:0};let drag=false,start=null,aim=null,flying=false,round=0,points=0;
    const cups=[{x:145,y:90},{x:575,y:90}];
    function draw(){ctx.clearRect(0,0,720,520);ctx.fillStyle='#422b19';roundedRect(ctx,90,35,540,450,20,true);ctx.strokeStyle='#eee';ctx.globalAlpha=.35;ctx.strokeRect(90,35,540,450);ctx.beginPath();ctx.moveTo(90,260);ctx.lineTo(630,260);ctx.stroke();ctx.globalAlpha=1;cups.forEach(cp=>{ctx.fillStyle='#d33';ctx.beginPath();ctx.ellipse(cp.x,cp.y,20,12,0,0,Math.PI*2);ctx.fill();});if(drag&&aim){ctx.strokeStyle='#ffc857';ctx.lineWidth=3;ctx.setLineDash([7,6]);ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();ctx.setLineDash([]);}ctx.save();ctx.translate(die.x,die.y);ctx.rotate(die.r);const sz=18+die.z*.08;ctx.fillStyle='#f6f1df';ctx.fillRect(-sz/2,-sz/2,sz,sz);ctx.fillStyle='#111';for(const [x,y] of [[-4,-4],[4,4],[0,0]]){ctx.beginPath();ctx.arc(x,y,1.7,0,Math.PI*2);ctx.fill();}ctx.restore();}
    function reset(){die={x:360,y:460,z:0,r:0};flying=false;draw();}
    function next(){round++;if(round>=6){const cpu=randi(3,10);const score=Math.round(points/18*10000);finish(score,points<cpu,`You ${points} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function throwDie(vx,vy,vz){flying=true;let frames=0;function step(){frames++;die.x+=vx;die.y+=vy;die.z+=vz;die.r+=.24;vz-=.52;vx*=.998;vy*=.998;if(die.z<=0&&frames>8){die.z=0;let gained=0;for(const cp of cups){if(Math.hypot(die.x-cp.x,die.y-cp.y)<28)gained=3;}if(!gained && die.x>=90&&die.x<=630&&die.y>=35&&die.y<260)gained=1;points+=gained;ui.querySelector('#pts').textContent=points;draw();setTimeout(next,450);return;}draw();requestAnimationFrame(step);}step();}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-die.x,p.y-die.y)>50)return;c.setPointerCapture(e.pointerId);drag=true;start={x:die.x,y:die.y};aim=p;draw();});
    c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});
    c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<28||dy>-8){draw();return;}throwDie(clamp(dx*.05,-8,8),clamp(dy*.052,-10,-2),clamp(7+mag*.035,7,14));});draw();
  }

  // ---------------- FLIP CUP ----------------
  function flipCup() {
    const ui=shell('Flip Cup', 'Grab the cup and flick upward. A medium, mostly vertical flick gives one clean rotation and an upright landing. Land five cups before the CPU pace.');
    ui.innerHTML=`<div class="scoreline">Cup <span id="round">1</span>/5 · Landed <span id="landed">0</span></div><div class="flip-stage" id="stage"><div class="flip-table"></div><div class="flip-cup" id="cup">🥤</div></div><div class="throw-tip">Swipe upward on the cup and release.</div>`;
    const stage=ui.querySelector('#stage'),cup=ui.querySelector('#cup');let round=0,landed=0,drag=false,start=null,last=null,busy=false;
    function pos(e){const r=stage.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
    cup.addEventListener('pointerdown',e=>{if(busy)return;drag=true;start=pos(e);last=start;cup.setPointerCapture(e.pointerId);cup.classList.add('grabbed');});
    cup.addEventListener('pointermove',e=>{if(!drag)return;last=pos(e);const dy=clamp(last.y-start.y,-130,15),dx=clamp(last.x-start.x,-70,70);cup.style.transform=`translate(${dx*.25}px, ${dy*.22}px) rotate(${dx*.12}deg)`;});
    cup.addEventListener('pointerup',e=>{if(!drag)return;drag=false;busy=true;cup.classList.remove('grabbed');last=pos(e);const dx=last.x-start.x,dy=last.y-start.y;const upward=-dy;const good=upward>=65&&upward<=165&&Math.abs(dx)<65;const precision=clamp(1-Math.abs(upward-108)/100,0,1)*clamp(1-Math.abs(dx)/100,0,1);const rotations=good?360:(upward<65?170:540);cup.style.transition='transform .7s cubic-bezier(.2,.8,.25,1)';cup.style.transform=`translate(${dx*.35}px,-115px) rotate(${rotations*.6}deg)`;setTimeout(()=>{cup.style.transition='transform .45s ease-in';cup.style.transform=`translate(${dx*.18}px,0) rotate(${good?360:rotations}deg)`;setTimeout(()=>{if(good)landed++;round++;ui.querySelector('#landed').textContent=landed;if(round>=5){const cpu=randi(2,5);const score=Math.min(10000,landed*1800+Math.round(precision*1000));finish(score,landed<cpu,`You landed ${landed}; CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;cup.style.transition='none';cup.style.transform='';busy=false;},460);},700);});
  }

  // ---------------- KINGS CUP ----------------
  function kingsCup() {
    const ui=shell('Kings Cup', 'Classic common U.S. rules: draw clockwise from a 52-card ring. The first three Kings add to the center cup; the fourth King ends the game.');
    const rules={
      'A':['Waterfall','Everyone starts together; the drawer may stop first, then players stop in order.'],
      '2':['You','Choose another player to take the penalty/sip.'],
      '3':['Me','The drawer takes the penalty/sip.'],
      '4':['Floor','Everyone reaches for the floor; last person takes the penalty/sip.'],
      '5':['Guys','All guys take the penalty/sip.'],
      '6':['Chicks','All girls take the penalty/sip.'],
      '7':['Heaven','Everyone points upward; last person takes the penalty/sip.'],
      '8':['Mate','Choose a mate; when one of you takes a penalty/sip, the other joins.'],
      '9':['Rhyme','Start with a word and go around rhyming; first repeat/failure takes the penalty.'],
      '10':['Categories','Name a category; go around naming unique entries until someone fails or repeats.'],
      'J':['Make a Rule','Create a house rule that remains active for the rest of the game.'],
      'Q':['Question Master','You are Question Master until another Queen is drawn; anyone who answers your question takes the penalty.'],
      'K':["King's Cup",'Add to the center cup. The player who draws the fourth King gets the final penalty and the game ends.']
    };
    const suits=['♠','♥','♦','♣'],ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    let deck=[];for(const s of suits)for(const r of ranks)deck.push({r,s});for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
    let drawn=0,kings=0,penalties=0,activeRules=[];
    ui.innerHTML=`<div class="kings-layout"><div class="king-cup-wrap"><div class="king-cup"><div class="king-fill" id="fill"></div><span>👑</span></div><div><strong><span id="kings">0</span>/4 Kings</strong><br><span class="muted"><span id="left">52</span> cards left</span></div></div><div class="playing-card back" id="card">FW</div><div class="king-rule" id="rule"><h3>Draw a card</h3><p>Use the deck the same way you would around the table.</p></div></div><div class="button-row" style="justify-content:center"><button class="btn primary big-action" id="draw">DRAW CARD</button></div><details class="rules-sheet"><summary>Card rules</summary>${Object.entries(rules).map(([r,v])=>`<div><strong>${r}</strong><span>${v[0]}</span><small>${v[1]}</small></div>`).join('')}</details><div id="active-rules" class="active-rules"></div>`;
    function penaltyFor(r){if(r==='3')return 1;if(['4','7','9','10'].includes(r))return Math.random()<.38?1:0;if(r==='A')return Math.random()<.28?1:0;return 0;}
    ui.querySelector('#draw').onclick=()=>{if(!deck.length)return;const card=deck.pop();drawn++;const [name,text]=rules[card.r];const el=ui.querySelector('#card');el.className=`playing-card ${['♥','♦'].includes(card.s)?'red':''}`;el.innerHTML=`<b>${card.r}</b><span>${card.s}</span>`;ui.querySelector('#rule').innerHTML=`<h3>${name}</h3><p>${text}</p>`;ui.querySelector('#left').textContent=deck.length;penalties+=penaltyFor(card.r);if(card.r==='J'){activeRules.push(`Rule #${activeRules.length+1}`);ui.querySelector('#active-rules').textContent=`Active house rules: ${activeRules.join(', ')}`;}if(card.r==='K'){kings++;ui.querySelector('#kings').textContent=kings;ui.querySelector('#fill').style.height=`${kings*25}%`;if(kings===4){ui.querySelector('#draw').disabled=true;penalties+=2;const cpuPen=randi(3,9);const score=clamp(10000-penalties*900-drawn*12,0,10000);setTimeout(()=>finish(score,penalties>cpuPen,`Penalties: you ${penalties}, CPU ${cpuPen}`),550);}}};
  }

  // ---------------- QUARTERS ----------------
  function quarters() {
    const ui=shell('Quarters', 'Flick the quarter upward. It must bounce on the table once and then drop into the cup. Six attempts.');
    ui.innerHTML=`<div class="scoreline">Shot <span id="round">1</span>/6 · Sinks <span id="sinks">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let q={x:360,y:455,z:0};let drag=false,start=null,aim=null,flying=false,round=0,sinks=0,bounced=false;
    const cup={x:360,y:105};
    function draw(){ctx.clearRect(0,0,720,520);ctx.fillStyle='#59331c';roundedRect(ctx,70,40,580,440,18,true);ctx.fillStyle='#c33';ctx.beginPath();ctx.ellipse(cup.x,cup.y,37,18,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.75;ctx.beginPath();ctx.ellipse(cup.x,cup.y-2,28,11,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;if(drag&&aim){ctx.strokeStyle='#ffc857';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();}ctx.fillStyle='silver';ctx.beginPath();ctx.ellipse(q.x,q.y,14+q.z*.03,6+q.z*.015,0,0,Math.PI*2);ctx.fill();}
    function reset(){q={x:360,y:455,z:0};bounced=false;flying=false;draw();}
    function next(){round++;if(round>=6){const cpu=randi(1,5);finish(Math.min(10000,sinks*1650),sinks<cpu,`You ${sinks} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function fire(vx,vy,vz){flying=true;let frames=0;function step(){frames++;q.x+=vx;q.y+=vy;q.z+=vz;vz-=.62;if(q.z<=0&&frames>6){if(!bounced && q.y>190&&q.y<360&&q.x>80&&q.x<640){q.z=1;vz=Math.abs(vz)*.52;bounced=true;vy*=.74;}else{q.z=0;const hit=bounced&&Math.hypot(q.x-cup.x,(q.y-cup.y)*1.2)<34;if(hit){sinks++;ui.querySelector('#sinks').textContent=sinks;}draw();setTimeout(next,380);return;}}draw();requestAnimationFrame(step);}step();}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-q.x,p.y-q.y)>50)return;c.setPointerCapture(e.pointerId);drag=true;start={x:q.x,y:q.y};aim=p;});c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<30||dy>-8){draw();return;}fire(clamp(dx*.042,-6,6),clamp(dy*.04,-8,-2),clamp(5+mag*.025,5,10));});draw();
  }

  // ---------------- CORNHOLE ----------------
  function cornhole() {
    const ui=shell('Cornhole', 'Grab the bag, drag toward the board, and release. Four bags: 3 points in the hole, 1 point on the board.');
    ui.innerHTML=`<div class="scoreline">Bag <span id="round">1</span>/4 · Points <span id="pts">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let bag={x:360,y:470,z:0,r:0};let drag=false,start=null,aim=null,flying=false,round=0,pts=0;const board={x:235,y:55,w:250,h:210,hx:360,hy:105};
    function draw(){ctx.clearRect(0,0,720,520);ctx.fillStyle='#17331e';ctx.fillRect(0,0,720,520);ctx.fillStyle='#b9844b';roundedRect(ctx,board.x,board.y,board.w,board.h,12,true);ctx.fillStyle='#111';ctx.beginPath();ctx.ellipse(board.hx,board.hy,28,18,0,0,Math.PI*2);ctx.fill();if(drag&&aim){ctx.strokeStyle='#ffc857';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();}ctx.save();ctx.translate(bag.x,bag.y);ctx.rotate(bag.r);ctx.fillStyle='#f1efe5';roundedRect(ctx,-16,-16,32,32,5,true);ctx.restore();}
    function reset(){bag={x:360,y:470,z:0,r:0};flying=false;draw();}
    function next(){round++;if(round>=4){const cpu=randi(1,9);finish(Math.round(pts/12*10000),pts<cpu,`You ${pts} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function fire(vx,vy,vz){flying=true;let frames=0;function step(){frames++;bag.x+=vx;bag.y+=vy;bag.z+=vz;bag.r+=.12;vz-=.5;if(bag.z<=0&&frames>8){bag.z=0;let add=0;if(Math.hypot(bag.x-board.hx,(bag.y-board.hy)*1.1)<31)add=3;else if(bag.x>=board.x&&bag.x<=board.x+board.w&&bag.y>=board.y&&bag.y<=board.y+board.h)add=1;pts+=add;ui.querySelector('#pts').textContent=pts;draw();setTimeout(next,400);return;}draw();requestAnimationFrame(step);}step();}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-bag.x,p.y-bag.y)>55)return;c.setPointerCapture(e.pointerId);drag=true;start={x:bag.x,y:bag.y};aim=p;});c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<25||dy>-8){draw();return;}fire(clamp(dx*.045,-7,7),clamp(dy*.048,-9,-2),clamp(6+mag*.03,6,12));});draw();
  }

  // ---------------- SLAP CUP ----------------
  function slapCup() {
    const ui=shell('Slap Cup', 'Rapid bounce shots. Drag the ping-pong ball toward the cup and release; every sink advances to the next cup. Five attempts.');
    ui.innerHTML=`<div class="scoreline">Attempt <span id="round">1</span>/5 · Sinks <span id="sinks">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="420"></canvas>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let ball={x:360,y:365,z:0};let drag=false,start=null,aim=null,flying=false,round=0,sinks=0,bounced=false;let cupX=360;
    function draw(){ctx.clearRect(0,0,720,420);ctx.fillStyle='#4c2c18';ctx.fillRect(40,40,640,340);ctx.fillStyle='#d33';ctx.beginPath();ctx.ellipse(cupX,95,34,16,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.72;ctx.beginPath();ctx.ellipse(cupX,92,25,10,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;if(drag&&aim){ctx.strokeStyle='#ffc857';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(aim.x,aim.y);ctx.stroke();}ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ball.x,ball.y,9+ball.z*.03,0,Math.PI*2);ctx.fill();}
    function reset(){cupX=randi(270,450);ball={x:360,y:365,z:0};bounced=false;flying=false;draw();}
    function next(){round++;if(round>=5){const cpu=randi(1,5);finish(Math.min(10000,sinks*2000),sinks<cpu,`You ${sinks} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function fire(vx,vy,vz){flying=true;let frames=0;function step(){frames++;ball.x+=vx;ball.y+=vy;ball.z+=vz;vz-=.62;if(ball.z<=0&&frames>6){if(!bounced&&ball.y>165&&ball.y<270){ball.z=1;vz=Math.abs(vz)*.5;bounced=true;vy*=.76;}else{ball.z=0;const hit=bounced&&Math.hypot(ball.x-cupX,(ball.y-95)*1.2)<34;if(hit){sinks++;ui.querySelector('#sinks').textContent=sinks;}draw();setTimeout(next,280);return;}}draw();requestAnimationFrame(step);}step();}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-ball.x,p.y-ball.y)>50)return;c.setPointerCapture(e.pointerId);drag=true;start={x:ball.x,y:ball.y};aim=p;});c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<25||dy>-8){draw();return;}fire(clamp(dx*.046,-7,7),clamp(dy*.046,-8,-2),clamp(5.5+mag*.025,5.5,10));});draw();
  }

  switch (game) {
    case 'pong': cupPong(); break;
    case 'beer-die': beerDie(); break;
    case 'flip-cup': flipCup(); break;
    case 'kings': kingsCup(); break;
    case 'quarters': quarters(); break;
    case 'cornhole': cornhole(); break;
    case 'slap-cup': slapCup(); break;
    default: shell('Unknown game','This game is not configured yet.');
  }
})();
