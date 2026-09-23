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
  const easeOut = t => 1 - Math.pow(1 - clamp(t,0,1), 3);

  function shell(title, instructions) {
    root.innerHTML = `<div class="game-shell"><h2>${title}</h2><p class="muted game-instructions">${instructions}</p><div id="game-ui"></div><div id="game-msg"></div></div>`;
    return document.getElementById('game-ui');
  }

  function popFeedback(ui, text, kind='good') {
    const old = ui.querySelector('.game-feedback');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = `game-feedback ${kind}`;
    el.textContent = text;
    ui.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 220); }, 650);
  }

  function bump(el) {
    if (!el) return;
    el.classList.remove('score-bump');
    void el.offsetWidth;
    el.classList.add('score-bump');
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
        msg.innerHTML = `<section class="panel result result-enter"><h2 class="${won?'win':'loss'}">${won?'YOU WIN':'CPU WINS'}</h2><p>Your run score: <strong>${score}</strong>${extra ? ` · ${extra}` : ''}</p><a class="btn" href="">Play Again</a> <a class="btn" href="/dashboard">Dashboard</a></section>`;
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
        msg.innerHTML = `<section class="panel result-enter"><h2>Score locked: ${score}</h2><p>${data.status==='completed'?'Match complete.':'Waiting for opponent.'}</p><a class="btn primary" href="/pvp/${matchId}">Refresh Match</a></section>`;
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

  function drawTrail(ctx, trail, baseRadius=8, color='255,255,255') {
    trail.forEach((p,i) => {
      const a = (i+1) / trail.length * .22;
      const r = baseRadius * (.35 + .65 * (i+1)/trail.length);
      ctx.fillStyle = `rgba(${color},${a})`;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
    });
  }

  function drawAimDots(ctx, start, aim, count=7) {
    if (!start || !aim) return;
    const dx=aim.x-start.x, dy=aim.y-start.y;
    ctx.fillStyle='rgba(255,200,87,.72)';
    for(let i=1;i<=count;i++){
      const t=i/(count+1);
      ctx.beginPath();
      ctx.arc(start.x+dx*t,start.y+dy*t,2.4+(1-t)*1.2,0,Math.PI*2);
      ctx.fill();
    }
  }

  function physicsRAF(stepFn) {
    let last = performance.now();
    function frame(now) {
      const dt = clamp((now-last)/16.6667, .25, 2.1);
      last = now;
      if (stepFn(dt, now) !== false) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------------- CUP PONG ----------------
  function cupPong() {
    const ui = shell('Cup Pong', 'Grab the ball, drag toward the rack, and release. You get 10 throws. A clean cup hit removes the cup.');
    ui.innerHTML = `<div class="scoreline">Throws <span id="throws">0</span>/10 · Cups sunk <span id="sunk">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas><div class="throw-tip">Drag upward to aim and set power. The dotted line shows your release direction.</div>`;
    const c=ui.querySelector('#arena'), ctx=c.getContext('2d');
    const cupLayout=[[360,72],[325,108],[395,108],[290,144],[360,144],[430,144],[255,180],[325,180],[395,180],[465,180]];
    let cups=cupLayout.map(([x,y],i)=>({x,y,alive:true,i,wobble:0}));
    let ball={x:360,y:468,z:0}; let dragging=false, start=null, aim=null, flying=false, throws=0, sunk=0;
    let trail=[], effects=[];

    function draw() {
      ctx.clearRect(0,0,c.width,c.height);
      const g=ctx.createLinearGradient(0,35,0,485);g.addColorStop(0,'#6a321a');g.addColorStop(1,'#3d1d12');ctx.fillStyle=g;roundedRect(ctx,80,35,560,450,24,true);
      ctx.fillStyle='#f0e7d2'; ctx.globalAlpha=.08; for(let i=0;i<7;i++) ctx.fillRect(120+i*80,35,2,450); ctx.globalAlpha=1;
      ctx.fillStyle='#202823'; ctx.fillRect(80,250,560,3);
      cups.forEach(cp=>{if(!cp.alive)return;ctx.save();ctx.translate(cp.x,cp.y);ctx.rotate(Math.sin(cp.wobble)*.08);ctx.fillStyle='#d93939';ctx.beginPath();ctx.ellipse(0,0,22,13,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.8;ctx.beginPath();ctx.ellipse(0,-2,16,8,0,0,Math.PI*2);ctx.fill();ctx.restore();ctx.globalAlpha=1;});
      effects.forEach(f=>{const a=1-f.t;ctx.strokeStyle=`rgba(116,255,114,${a})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(f.x,f.y,15+f.t*42,0,Math.PI*2);ctx.stroke();});
      if(dragging && start && aim) drawAimDots(ctx,start,aim,8);
      drawTrail(ctx,trail,7);
      const scale=1+ball.z/95;
      const shadow=clamp(1-ball.z/190,.2,1);ctx.fillStyle=`rgba(0,0,0,${.28*shadow})`;ctx.beginPath();ctx.ellipse(ball.x,ball.y+10,12*shadow,5*shadow,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#f7f6ef';ctx.beginPath();ctx.arc(ball.x,ball.y,8*scale,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.18)';ctx.stroke();
      if(!flying && !dragging){ctx.fillStyle='#aab3ac';ctx.font='700 15px system-ui';ctx.textAlign='center';ctx.fillText('GRAB + DRAG TO THROW',360,505);}
    }
    function resetBall(){ball={x:360,y:468,z:0};trail=[];flying=false;draw();}
    function resolveThrow(vx,vy,vz){
      flying=true;let frames=0;
      physicsRAF((dt)=>{frames+=dt;ball.x+=vx*dt;ball.y+=vy*dt;ball.z+=vz*dt;vz-=.56*dt;vx*=Math.pow(.997,dt);vy*=Math.pow(.997,dt);trail.push({x:ball.x,y:ball.y});if(trail.length>12)trail.shift();
        cups.forEach(cp=>{if(cp.wobble>0)cp.wobble+=.22*dt;});effects.forEach(f=>f.t+=.05*dt);effects=effects.filter(f=>f.t<1);
        let hit=null;if(ball.z<28&&vz<0){for(const cp of cups){if(cp.alive&&Math.hypot(ball.x-cp.x,ball.y-cp.y)<24){hit=cp;break;}}}
        if(hit){hit.alive=false;sunk++;effects.push({x:hit.x,y:hit.y,t:0});ui.querySelector('#sunk').textContent=sunk;bump(ui.querySelector('#sunk'));popFeedback(ui,'SPLASH!','good');flying=false;draw();setTimeout(nextThrow,460);return false;}
        if(ball.z<=0&&frames>8){ball.z=0;flying=false;popFeedback(ui,'RIM / MISS','neutral');draw();setTimeout(nextThrow,330);return false;}
        draw();return true;
      });
    }
    function nextThrow(){throws++;ui.querySelector('#throws').textContent=throws;bump(ui.querySelector('#throws'));if(throws>=10||sunk===10){const cpu=randi(3,8);const score=Math.min(10000,sunk*1000);finish(score,sunk<cpu,`CPU sunk ${cpu}`);return;}resetBall();}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-ball.x,p.y-ball.y)>48)return;c.setPointerCapture(e.pointerId);dragging=true;start={x:ball.x,y:ball.y};aim=p;draw();});
    c.addEventListener('pointermove',e=>{if(!dragging)return;aim=pointerPos(c,e);draw();});
    const release=e=>{if(!dragging)return;const p=pointerPos(c,e);dragging=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<28||dy>-10){draw();return;}const power=clamp(mag,35,230);resolveThrow(clamp(dx*.055,-9,9),clamp(dy*.055,-11,-2.2),clamp(5.5+power*.035,6,13));};
    c.addEventListener('pointerup',release);c.addEventListener('pointercancel',()=>{dragging=false;aim=null;draw();});draw();
  }

  // ---------------- BEER DIE ----------------
  function beerDie() {
    const ui=shell('Beer Die', 'Grab the die at your end, drag upward, and release. Score by landing on the opponent half; corner cup hits are worth more. Six throws.');
    ui.innerHTML=`<div class="scoreline">Throw <span id="round">1</span>/6 · Points <span id="pts">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas><div class="throw-tip">Opponent half = 1 point · corner cup = 3 points.</div>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let die={x:360,y:460,z:0,r:0};let drag=false,start=null,aim=null,flying=false,round=0,points=0,trail=[],flash=0;
    const cups=[{x:145,y:90},{x:575,y:90}];
    function draw(){ctx.clearRect(0,0,720,520);const tg=ctx.createLinearGradient(90,35,630,485);tg.addColorStop(0,'#53371e');tg.addColorStop(1,'#2f2116');ctx.fillStyle=tg;roundedRect(ctx,90,35,540,450,20,true);ctx.strokeStyle='#eee';ctx.globalAlpha=.28;ctx.strokeRect(90,35,540,450);ctx.beginPath();ctx.moveTo(90,260);ctx.lineTo(630,260);ctx.stroke();ctx.globalAlpha=1;cups.forEach(cp=>{ctx.fillStyle=flash>0?'#ff5858':'#d33';ctx.beginPath();ctx.ellipse(cp.x,cp.y,20,12,0,0,Math.PI*2);ctx.fill();});if(drag&&aim)drawAimDots(ctx,start,aim,8);drawTrail(ctx,trail,5,'246,241,223');const sh=clamp(1-die.z/200,.25,1);ctx.fillStyle=`rgba(0,0,0,${.32*sh})`;ctx.beginPath();ctx.ellipse(die.x,die.y+10,13*sh,6*sh,0,0,Math.PI*2);ctx.fill();ctx.save();ctx.translate(die.x,die.y);ctx.rotate(die.r);const sz=18+die.z*.075;ctx.fillStyle='#f6f1df';ctx.shadowColor='rgba(0,0,0,.28)';ctx.shadowBlur=die.z*.05;ctx.fillRect(-sz/2,-sz/2,sz,sz);ctx.shadowBlur=0;ctx.fillStyle='#111';for(const [x,y] of [[-4,-4],[4,4],[0,0]]){ctx.beginPath();ctx.arc(x,y,1.7,0,Math.PI*2);ctx.fill();}ctx.restore();}
    function reset(){die={x:360,y:460,z:0,r:0};trail=[];flying=false;draw();}
    function next(){round++;if(round>=6){const cpu=randi(3,10);const score=Math.round(points/18*10000);finish(score,points<cpu,`You ${points} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function throwDie(vx,vy,vz){flying=true;let frames=0;physicsRAF((dt)=>{frames+=dt;die.x+=vx*dt;die.y+=vy*dt;die.z+=vz*dt;die.r+=.24*dt;vz-=.52*dt;vx*=Math.pow(.998,dt);vy*=Math.pow(.998,dt);trail.push({x:die.x,y:die.y});if(trail.length>10)trail.shift();flash=Math.max(0,flash-.08*dt);if(die.z<=0&&frames>8){die.z=0;let gained=0;for(const cp of cups){if(Math.hypot(die.x-cp.x,die.y-cp.y)<29)gained=3;}if(!gained&&die.x>=90&&die.x<=630&&die.y>=35&&die.y<260)gained=1;points+=gained;ui.querySelector('#pts').textContent=points;bump(ui.querySelector('#pts'));flash=.7;popFeedback(ui,gained===3?'CUP! +3':gained===1?'TABLE! +1':'MISS',gained?'good':'neutral');draw();setTimeout(next,470);return false;}draw();return true;});}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-die.x,p.y-die.y)>50)return;c.setPointerCapture(e.pointerId);drag=true;start={x:die.x,y:die.y};aim=p;draw();});
    c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});
    c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<28||dy>-8){draw();return;}throwDie(clamp(dx*.05,-8,8),clamp(dy*.052,-10,-2),clamp(7+mag*.035,7,14));});
    c.addEventListener('pointercancel',()=>{drag=false;aim=null;draw();});draw();
  }

  // ---------------- FLIP CUP ----------------
  function flipCup() {
    const ui=shell('Flip Cup', 'Grab the cup and flick upward. A medium, mostly vertical flick gives one clean rotation and an upright landing. Land five cups before the CPU pace.');
    ui.innerHTML=`<div class="scoreline">Cup <span id="round">1</span>/5 · Landed <span id="landed">0</span></div><div class="flip-stage" id="stage"><div class="flip-table"></div><div class="flip-shadow" id="shadow"></div><div class="flip-cup" id="cup">🥤</div></div><div class="throw-tip">Swipe upward on the cup and release.</div>`;
    const stage=ui.querySelector('#stage'),cup=ui.querySelector('#cup'),shadow=ui.querySelector('#shadow');let round=0,landed=0,drag=false,start=null,last=null,busy=false,totalPrecision=0;
    function pos(e){const r=stage.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
    function settle(good,dx,precision){
      stage.classList.remove('flip-success','flip-miss');void stage.offsetWidth;stage.classList.add(good?'flip-success':'flip-miss');
      if(good){landed++;totalPrecision+=precision;ui.querySelector('#landed').textContent=landed;bump(ui.querySelector('#landed'));popFeedback(ui,'LANDED!','good');}else popFeedback(ui,'OFF THE RIM','neutral');
      round++;
      setTimeout(()=>{if(round>=5){const cpu=randi(2,5);const score=Math.min(10000,landed*1800+Math.round((totalPrecision/Math.max(1,landed))*1000));finish(score,landed<cpu,`You landed ${landed}; CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;cup.style.transition='none';shadow.style.transition='none';cup.style.transform='';shadow.style.transform='';shadow.style.opacity='.28';busy=false;},350);
    }
    cup.addEventListener('pointerdown',e=>{if(busy)return;drag=true;start=pos(e);last=start;cup.setPointerCapture(e.pointerId);cup.classList.add('grabbed');});
    cup.addEventListener('pointermove',e=>{if(!drag)return;last=pos(e);const dy=clamp(last.y-start.y,-140,15),dx=clamp(last.x-start.x,-75,75);cup.style.transform=`translate3d(${dx*.25}px,${dy*.22}px,0) rotate(${dx*.12}deg)`;shadow.style.transform=`translateX(${dx*.1}px) scale(${clamp(1+dy/260,.55,1.1)})`;});
    cup.addEventListener('pointerup',e=>{if(!drag)return;drag=false;busy=true;cup.classList.remove('grabbed');last=pos(e);const dx=last.x-start.x,dy=last.y-start.y;const upward=-dy;const good=upward>=64&&upward<=168&&Math.abs(dx)<64;const precision=clamp(1-Math.abs(upward-108)/100,0,1)*clamp(1-Math.abs(dx)/100,0,1);const rotations=good?360:(upward<64?170:540);cup.style.transition='transform .56s cubic-bezier(.15,.75,.2,1)';shadow.style.transition='transform .56s ease, opacity .56s ease';cup.style.transform=`translate3d(${dx*.34}px,-125px,0) rotate(${rotations*.62}deg) scale(1.05)`;shadow.style.transform='scale(.45)';shadow.style.opacity='.12';setTimeout(()=>{cup.style.transition='transform .38s cubic-bezier(.3,.7,.35,1.05)';shadow.style.transition='transform .38s ease, opacity .38s ease';cup.style.transform=`translate3d(${dx*.16}px,0,0) rotate(${good?360:rotations}deg)`;shadow.style.transform=`translateX(${dx*.08}px) scale(1)`;shadow.style.opacity='.28';setTimeout(()=>settle(good,dx,precision),390);},560);});
    cup.addEventListener('pointercancel',()=>{drag=false;busy=false;cup.classList.remove('grabbed');cup.style.transform='';});
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
    ui.innerHTML=`<div class="kings-layout"><div class="king-cup-wrap"><div class="king-cup" id="king-cup"><div class="king-fill" id="fill"></div><span>👑</span></div><div><strong><span id="kings">0</span>/4 Kings</strong><br><span class="muted"><span id="left">52</span> cards left</span></div></div><div class="card-slot"><div class="playing-card back" id="card">FW</div></div><div class="king-rule" id="rule"><h3>Draw a card</h3><p>Use the deck the same way you would around the table.</p></div></div><div class="button-row" style="justify-content:center"><button class="btn primary big-action" id="draw">DRAW CARD</button></div><details class="rules-sheet"><summary>Card rules</summary>${Object.entries(rules).map(([r,v])=>`<div><strong>${r}</strong><span>${v[0]}</span><small>${v[1]}</small></div>`).join('')}</details><div id="active-rules" class="active-rules"></div>`;
    function penaltyFor(r){if(r==='3')return 1;if(['4','7','9','10'].includes(r))return Math.random()<.38?1:0;if(r==='A')return Math.random()<.28?1:0;return 0;}
    ui.querySelector('#draw').onclick=()=>{if(!deck.length)return;const btn=ui.querySelector('#draw');btn.disabled=true;const card=deck.pop();drawn++;const [name,text]=rules[card.r];const el=ui.querySelector('#card');el.classList.add('card-flipping');setTimeout(()=>{el.className=`playing-card ${['♥','♦'].includes(card.s)?'red':''} card-flipping-in`;el.innerHTML=`<b>${card.r}</b><span>${card.s}</span>`;ui.querySelector('#rule').innerHTML=`<h3>${name}</h3><p>${text}</p>`;ui.querySelector('#rule').classList.remove('rule-enter');void ui.querySelector('#rule').offsetWidth;ui.querySelector('#rule').classList.add('rule-enter');ui.querySelector('#left').textContent=deck.length;penalties+=penaltyFor(card.r);if(card.r==='J'){activeRules.push(`Rule #${activeRules.length+1}`);ui.querySelector('#active-rules').textContent=`Active house rules: ${activeRules.join(', ')}`;}if(card.r==='K'){kings++;ui.querySelector('#kings').textContent=kings;bump(ui.querySelector('#kings'));ui.querySelector('#fill').style.height=`${kings*25}%`;const kc=ui.querySelector('#king-cup');kc.classList.remove('king-pulse');void kc.offsetWidth;kc.classList.add('king-pulse');popFeedback(ui,kings===4?'FOURTH KING!':'KING TO THE CUP','good');if(kings===4){penalties+=2;const cpuPen=randi(3,9);const score=clamp(10000-penalties*900-drawn*12,0,10000);setTimeout(()=>finish(score,penalties>cpuPen,`Penalties: you ${penalties}, CPU ${cpuPen}`),800);return;}}setTimeout(()=>{btn.disabled=false;el.classList.remove('card-flipping-in');},330);},170);};
  }

  // ---------------- QUARTERS ----------------
  function quarters() {
    const ui=shell('Quarters', 'Flick the quarter upward. It must bounce on the table once and then drop into the cup. Six attempts.');
    ui.innerHTML=`<div class="scoreline">Shot <span id="round">1</span>/6 · Sinks <span id="sinks">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas><div class="throw-tip">Aim for the bounce zone, then let the quarter carry into the cup.</div>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let q={x:360,y:455,z:0,r:0};let drag=false,start=null,aim=null,flying=false,round=0,sinks=0,bounced=false,trail=[],rings=[];
    const cup={x:360,y:105};
    function draw(){ctx.clearRect(0,0,720,520);const g=ctx.createLinearGradient(70,40,650,480);g.addColorStop(0,'#6a3d20');g.addColorStop(1,'#3d2418');ctx.fillStyle=g;roundedRect(ctx,70,40,580,440,18,true);ctx.fillStyle='rgba(116,255,114,.06)';roundedRect(ctx,105,190,510,170,14,true);ctx.strokeStyle='rgba(116,255,114,.18)';ctx.setLineDash([8,8]);ctx.strokeRect(105,190,510,170);ctx.setLineDash([]);ctx.fillStyle='#c33';ctx.beginPath();ctx.ellipse(cup.x,cup.y,37,18,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.75;ctx.beginPath();ctx.ellipse(cup.x,cup.y-2,28,11,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;if(drag&&aim)drawAimDots(ctx,start,aim,8);drawTrail(ctx,trail,5,'210,210,210');rings.forEach(r=>{ctx.strokeStyle=`rgba(255,200,87,${1-r.t})`;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(r.x,r.y,12+r.t*35,5+r.t*15,0,0,Math.PI*2);ctx.stroke();});ctx.save();ctx.translate(q.x,q.y);ctx.rotate(q.r);ctx.fillStyle='#c9c9c9';ctx.beginPath();ctx.ellipse(0,0,14+q.z*.025,6+q.z*.012,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#f5f5f5';ctx.stroke();ctx.restore();}
    function reset(){q={x:360,y:455,z:0,r:0};bounced=false;trail=[];rings=[];flying=false;draw();}
    function next(){round++;if(round>=6){const cpu=randi(1,5);finish(Math.min(10000,sinks*1650),sinks<cpu,`You ${sinks} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function fire(vx,vy,vz){flying=true;let frames=0;physicsRAF((dt)=>{frames+=dt;q.x+=vx*dt;q.y+=vy*dt;q.z+=vz*dt;q.r+=.23*dt;vz-=.62*dt;trail.push({x:q.x,y:q.y});if(trail.length>11)trail.shift();rings.forEach(r=>r.t+=.06*dt);rings=rings.filter(r=>r.t<1);if(q.z<=0&&frames>6){if(!bounced&&q.y>180&&q.y<365&&q.x>80&&q.x<640){q.z=.5;vz=Math.abs(vz)*.72+1.1;bounced=true;vy*=.86;rings.push({x:q.x,y:q.y,t:0});popFeedback(ui,'BOUNCE','neutral');}else{q.z=0;const hit=bounced&&Math.hypot(q.x-cup.x,(q.y-cup.y)*1.2)<35;if(hit){sinks++;ui.querySelector('#sinks').textContent=sinks;bump(ui.querySelector('#sinks'));popFeedback(ui,'SINK!','good');}else popFeedback(ui,'MISS','neutral');draw();setTimeout(next,410);return false;}}draw();return true;});}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-q.x,p.y-q.y)>50)return;c.setPointerCapture(e.pointerId);drag=true;start={x:q.x,y:q.y};aim=p;draw();});c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<30||dy>-8){draw();return;}fire(clamp(dx*.042,-6,6),clamp(dy*.04,-8,-2),clamp(5+mag*.025,5,10));});c.addEventListener('pointercancel',()=>{drag=false;aim=null;draw();});draw();
  }

  // ---------------- CORNHOLE ----------------
  function cornhole() {
    const ui=shell('Cornhole', 'Grab the bag, drag toward the board, and release. Four bags: 3 points in the hole, 1 point on the board.');
    ui.innerHTML=`<div class="scoreline">Bag <span id="round">1</span>/4 · Points <span id="pts">0</span></div><canvas class="arena throw-arena" id="arena" width="720" height="520"></canvas>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');let bag={x:360,y:470,z:0,r:0,squish:1};let drag=false,start=null,aim=null,flying=false,round=0,pts=0,trail=[],holeGlow=0;const board={x:235,y:55,w:250,h:210,hx:360,hy:105};
    function draw(){ctx.clearRect(0,0,720,520);const grass=ctx.createLinearGradient(0,0,0,520);grass.addColorStop(0,'#21482a');grass.addColorStop(1,'#102919');ctx.fillStyle=grass;ctx.fillRect(0,0,720,520);ctx.fillStyle='#b9844b';ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=18;roundedRect(ctx,board.x,board.y,board.w,board.h,12,true);ctx.shadowBlur=0;ctx.fillStyle=holeGlow>0?'#4f1717':'#111';ctx.beginPath();ctx.ellipse(board.hx,board.hy,28+holeGlow*5,18+holeGlow*3,0,0,Math.PI*2);ctx.fill();if(drag&&aim)drawAimDots(ctx,start,aim,8);drawTrail(ctx,trail,7,'241,239,229');const sh=clamp(1-bag.z/170,.2,1);ctx.fillStyle=`rgba(0,0,0,${.25*sh})`;ctx.beginPath();ctx.ellipse(bag.x,bag.y+12,18*sh,7*sh,0,0,Math.PI*2);ctx.fill();ctx.save();ctx.translate(bag.x,bag.y);ctx.rotate(bag.r);ctx.scale(1+(1-bag.squish)*.22,bag.squish);ctx.fillStyle='#f1efe5';roundedRect(ctx,-16,-16,32,32,5,true);ctx.restore();}
    function reset(){bag={x:360,y:470,z:0,r:0,squish:1};trail=[];holeGlow=0;flying=false;draw();}
    function next(){round++;if(round>=4){const cpu=randi(1,9);finish(Math.round(pts/12*10000),pts<cpu,`You ${pts} – CPU ${cpu}`);return;}ui.querySelector('#round').textContent=round+1;reset();}
    function fire(vx,vy,vz){flying=true;let frames=0;physicsRAF((dt)=>{frames+=dt;bag.x+=vx*dt;bag.y+=vy*dt;bag.z+=vz*dt;bag.r+=.12*dt;vz-=.5*dt;trail.push({x:bag.x,y:bag.y});if(trail.length>12)trail.shift();holeGlow=Math.max(0,holeGlow-.05*dt);if(bag.z<=0&&frames>8){bag.z=0;let add=0;if(Math.hypot(bag.x-board.hx,(bag.y-board.hy)*1.1)<31)add=3;else if(bag.x>=board.x&&bag.x<=board.x+board.w&&bag.y>=board.y&&bag.y<=board.y+board.h)add=1;pts+=add;ui.querySelector('#pts').textContent=pts;bump(ui.querySelector('#pts'));bag.squish=.55;holeGlow=add===3?1:0;popFeedback(ui,add===3?'CORNHOLE! +3':add===1?'ON THE BOARD +1':'OFF BOARD',add?'good':'neutral');draw();setTimeout(()=>{bag.squish=1;next();},430);return false;}draw();return true;});}
    c.addEventListener('pointerdown',e=>{if(flying)return;const p=pointerPos(c,e);if(Math.hypot(p.x-bag.x,p.y-bag.y)>55)return;c.setPointerCapture(e.pointerId);drag=true;start={x:bag.x,y:bag.y};aim=p;draw();});c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<25||dy>-8){draw();return;}fire(clamp(dx*.045,-7,7),clamp(dy*.048,-9,-2),clamp(6+mag*.03,6,12));});c.addEventListener('pointercancel',()=>{drag=false;aim=null;draw();});draw();
  }

  // ---------------- SLAP CUP ----------------
  function slapCup() {
    const ui=shell('Slap Cup', 'Bounce the ping-pong ball once, sink it, then slap the cup immediately. Complete five cups as fast as possible.');
    ui.innerHTML=`<div class="slap-hud"><div class="scoreline">Cups <span id="sinks">0</span>/5</div><div class="scoreline">Time <span id="time">30.0</span>s</div>${mode==='cpu'?'<div class="scoreline">CPU <span id="cpu">0</span>/5</div>':''}</div><canvas class="arena throw-arena slap-arena" id="arena" width="720" height="440"></canvas><div class="throw-tip" id="slap-tip">Grab the ball and flick it toward the cup. It must bounce once on the table.</div>`;
    const c=ui.querySelector('#arena'),ctx=c.getContext('2d');
    let ball={x:360,y:382,z:0};let drag=false,start=null,aim=null,flying=false,bounced=false,awaitingSlap=false;
    let sinks=0,shots=0,hits=0,trail=[],rings=[],cupX=360,cupPulse=0,cupSlide=0;
    let started=false,startTime=0,deadline=0,timerRAF=0,cpuCups=0,cpuNext=0,finished=false,lastSlapAt=0;
    const TOTAL=5, LIMIT=30000, cupY=98;

    function chooseCup(){let next=randi(245,475);if(Math.abs(next-cupX)<65)next=clamp(next+(next<360?90:-90),225,495);cupX=next;cupSlide=1;cupPulse=.7;}
    function startClock(){if(started)return;started=true;startTime=performance.now();deadline=startTime+LIMIT;cpuNext=startTime+rand(4300,6500);timerRAF=requestAnimationFrame(tickClock);}
    function scoreNow(now=performance.now()){
      const elapsed=started?Math.min(LIMIT,now-startTime):0;
      const remain=Math.max(0,LIMIT-elapsed);
      const accuracy=shots?hits/shots:0;
      if(sinks>=TOTAL)return clamp(6200+remain/LIMIT*3000+accuracy*800,0,10000);
      return clamp(sinks*1500+accuracy*900+remain/LIMIT*400,0,9999);
    }
    function endRun(cpuWonOverride=null){if(finished)return;finished=true;cancelAnimationFrame(timerRAF);const now=performance.now();const score=scoreNow(now);if(mode==='cpu'){let cpuWon=cpuWonOverride;if(cpuWon===null){cpuWon=cpuCups>sinks||(cpuCups===sinks&&sinks<TOTAL);}finish(score,cpuWon,`You ${sinks} cups · CPU ${cpuCups}`);}else finish(score,false,`${sinks}/5 cups`);}
    function tickClock(now){if(finished)return;const left=Math.max(0,deadline-now);ui.querySelector('#time').textContent=(left/1000).toFixed(1);if(mode==='cpu'&&started&&now>=cpuNext&&cpuCups<TOTAL){cpuCups++;ui.querySelector('#cpu').textContent=cpuCups;bump(ui.querySelector('#cpu'));cpuNext=now+rand(3900,6100);if(cpuCups>=TOTAL){popFeedback(ui,'CPU FINISHED','bad');setTimeout(()=>endRun(true),350);return;}}if(left<=0){endRun(null);return;}timerRAF=requestAnimationFrame(tickClock);}

    function draw(){
      ctx.clearRect(0,0,720,440);
      const table=ctx.createLinearGradient(0,45,0,400);table.addColorStop(0,'#674020');table.addColorStop(1,'#3d2517');ctx.fillStyle=table;roundedRect(ctx,38,42,644,350,22,true);
      ctx.fillStyle='rgba(255,255,255,.045)';for(let y=80;y<390;y+=52)ctx.fillRect(38,y,644,2);
      ctx.fillStyle='rgba(116,255,114,.05)';roundedRect(ctx,80,175,560,135,14,true);ctx.strokeStyle='rgba(116,255,114,.18)';ctx.setLineDash([10,9]);ctx.strokeRect(80,175,560,135);ctx.setLineDash([]);
      const slideOffset=cupSlide*90*(cupX<360?-1:1);ctx.save();ctx.translate(slideOffset,0);const pulse=1+cupPulse*.08;ctx.translate(cupX,cupY);ctx.scale(pulse,pulse);ctx.fillStyle=awaitingSlap?'#ff5b4d':'#d33';ctx.shadowColor=awaitingSlap?'rgba(255,91,77,.7)':'rgba(0,0,0,.25)';ctx.shadowBlur=awaitingSlap?24:8;ctx.beginPath();ctx.ellipse(0,0,36,17,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.78;ctx.beginPath();ctx.ellipse(0,-3,27,11,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.restore();ctx.shadowBlur=0;
      if(awaitingSlap){ctx.fillStyle='rgba(255,200,87,.95)';ctx.font='900 22px system-ui';ctx.textAlign='center';ctx.fillText('SLAP!',cupX,cupY+64);ctx.strokeStyle=`rgba(255,200,87,${.45+.3*Math.sin(performance.now()/90)})`;ctx.lineWidth=4;ctx.beginPath();ctx.arc(cupX,cupY,52+5*Math.sin(performance.now()/110),0,Math.PI*2);ctx.stroke();}
      if(drag&&aim)drawAimDots(ctx,start,aim,9);
      rings.forEach(r=>{ctx.strokeStyle=`rgba(255,200,87,${1-r.t})`;ctx.lineWidth=2.5;ctx.beginPath();ctx.ellipse(r.x,r.y,10+r.t*36,4+r.t*16,0,0,Math.PI*2);ctx.stroke();});
      drawTrail(ctx,trail,6);
      if(!awaitingSlap){const sh=clamp(1-ball.z/120,.22,1);ctx.fillStyle=`rgba(0,0,0,${.3*sh})`;ctx.beginPath();ctx.ellipse(ball.x,ball.y+9,12*sh,5*sh,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ball.x,ball.y,9+ball.z*.025,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.18)';ctx.stroke();}
      if(!flying&&!drag&&!awaitingSlap&&!finished){ctx.fillStyle='#aab3ac';ctx.font='700 14px system-ui';ctx.textAlign='center';ctx.fillText('BOUNCE ZONE',360,298);}
    }
    function resetBall(){ball={x:360,y:382,z:0};trail=[];rings=[];bounced=false;flying=false;draw();}
    function successfulSink(){flying=false;awaitingSlap=true;hits++;cupPulse=1;ui.querySelector('#slap-tip').textContent='SUNK — tap/click the glowing cup to slap it!';popFeedback(ui,'SUNK! NOW SLAP','good');draw();}
    function slapCupNow(){if(!awaitingSlap||finished)return;awaitingSlap=false;sinks++;lastSlapAt=performance.now();ui.querySelector('#sinks').textContent=sinks;bump(ui.querySelector('#sinks'));cupPulse=1;popFeedback(ui,'SLAP!','good');if(sinks>=TOTAL){ui.querySelector('#slap-tip').textContent='Finished!';setTimeout(()=>endRun(false),300);return;}chooseCup();ui.querySelector('#slap-tip').textContent='Next cup — bounce it and sink it.';setTimeout(resetBall,260);}
    function miss(){flying=false;popFeedback(ui,bounced?'JUST MISSED':'NEEDS A BOUNCE','neutral');ui.querySelector('#slap-tip').textContent='Try again — one table bounce, then into the cup.';setTimeout(resetBall,260);}
    function fire(vx,vy,vz){
      startClock();shots++;flying=true;let frames=0,descending=false;
      physicsRAF((dt)=>{if(finished)return false;frames+=dt;ball.x+=vx*dt;ball.y+=vy*dt;ball.z+=vz*dt;vz-=.58*dt;descending=vz<0;trail.push({x:ball.x,y:ball.y});if(trail.length>12)trail.shift();rings.forEach(r=>r.t+=.075*dt);rings=rings.filter(r=>r.t<1);cupPulse=Math.max(0,cupPulse-.045*dt);cupSlide=Math.max(0,cupSlide-.08*dt);
        // Once the ball has bounced, capture it while descending through the cup opening.
        if(bounced&&descending&&ball.y<=cupY+50&&ball.y>=cupY-36&&Math.abs(ball.x-cupX)<36&&ball.z<80){ball.x+=(cupX-ball.x)*.45;ball.y+=(cupY-ball.y)*.45;ball.z=Math.max(0,ball.z-3*dt);draw();successfulSink();return false;}
        if(ball.z<=0&&frames>5){
          if(!bounced&&ball.y>150&&ball.y<325&&ball.x>70&&ball.x<650){ball.z=.6;vz=Math.abs(vz)*.72+.65;vy*=.92;bounced=true;rings.push({x:ball.x,y:ball.y,t:0});popFeedback(ui,'BOUNCE!','neutral');}
          else {ball.z=0;draw();miss();return false;}
        }
        if(ball.y<-30||ball.x<-40||ball.x>760){miss();return false;}
        draw();return true;
      });
    }
    c.addEventListener('pointerdown',e=>{const p=pointerPos(c,e);if(awaitingSlap){if(Math.hypot(p.x-cupX,p.y-cupY)<72)slapCupNow();return;}if(flying||finished)return;if(Math.hypot(p.x-ball.x,p.y-ball.y)>52)return;c.setPointerCapture(e.pointerId);drag=true;start={x:ball.x,y:ball.y};aim=p;draw();});
    c.addEventListener('pointermove',e=>{if(drag){aim=pointerPos(c,e);draw();}});
    c.addEventListener('pointerup',e=>{if(!drag)return;const p=pointerPos(c,e);drag=false;const dx=p.x-start.x,dy=p.y-start.y,mag=Math.hypot(dx,dy);aim=null;if(mag<30||dy>-12){draw();return;}const side=(cupX-360)*.020;fire(clamp(dx*.048+side*.15,-8,8),clamp(dy*.052,-9.2,-3.2),clamp(6.4+mag*.031,7.0,12.2));});
    c.addEventListener('pointercancel',()=>{drag=false;aim=null;draw();});
    function animateIdle(){if(finished)return;cupPulse=Math.max(0,cupPulse-.03);cupSlide=Math.max(0,cupSlide-.05);if(awaitingSlap||cupSlide>0||cupPulse>0)draw();requestAnimationFrame(animateIdle);}requestAnimationFrame(animateIdle);draw();
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
