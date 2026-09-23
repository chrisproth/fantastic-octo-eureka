(() => {
  const root = document.getElementById('game-root');
  if (!root) return;
  const game = root.dataset.game;
  const mode = root.dataset.mode;
  const matchId = root.dataset.matchId;
  let submitted = false;

  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const rand = (a,b)=>a+Math.random()*(b-a);

  function shell(title, instructions) {
    root.innerHTML = `<div class="game-shell"><h2>${title}</h2><p class="muted">${instructions}</p><div id="game-ui"></div><div id="game-msg"></div></div>`;
    return document.getElementById('game-ui');
  }

  async function finish(score, cpuWon) {
    if (submitted) return;
    submitted = true;
    score = clamp(Math.round(score), 0, 10000);
    const msg = document.getElementById('game-msg');
    if (mode === 'cpu') {
      const won = !cpuWon;
      const res = await fetch(`/api/cpu-result/${game}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({won})});
      const data = await res.json();
      msg.innerHTML = `<section class="panel result"><h2 class="${won?'win':'loss'}">${won?'YOU WIN':'CPU WINS'}</h2><p>Your run score: <strong>${score}</strong></p><a class="btn" href="">Play Again</a> <a class="btn" href="/dashboard">Dashboard</a></section>`;
    } else {
      const res = await fetch(`/api/pvp/${matchId}/score`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score})});
      const data = await res.json();
      if (!data.ok) { msg.innerHTML = `<p class="loss">${data.error || 'Could not submit score.'}</p>`; return; }
      msg.innerHTML = `<section class="panel"><h2>Score locked: ${score}</h2><p>${data.status==='completed'?'Match complete.':'Waiting for opponent.'}</p><a class="btn primary" href="/pvp/${matchId}">Refresh Match</a></section>`;
    }
  }

  function meterGame(title, instructions, rounds=5) {
    const ui=shell(title,instructions); let round=0,total=0,dir=1,pos=0; let raf;
    ui.innerHTML=`<div class="scoreline">Round <span id="round">1</span> / ${rounds} · Score <span id="score">0</span></div><div class="meter"><div class="meter-zone"></div><div class="meter-marker" id="marker"></div></div><div class="button-row" style="justify-content:center"><button class="btn primary big-action" id="hit">LOCK IT</button></div>`;
    const marker=ui.querySelector('#marker');
    function loop(){pos+=dir*1.5;if(pos>=99||pos<=0)dir*=-1;marker.style.left=`${pos}%`;raf=requestAnimationFrame(loop)} loop();
    ui.querySelector('#hit').onclick=()=>{round++; const closeness=Math.max(0,1-Math.abs(pos-50)/50); total+=Math.round(closeness*1000);ui.querySelector('#score').textContent=total;if(round>=rounds){cancelAnimationFrame(raf);const cpu=Math.round(rounds*rand(480,780));finish(total,total<cpu);ui.querySelector('#hit').disabled=true;}else ui.querySelector('#round').textContent=round+1;};
  }

  function reactionGame() {
    const ui=shell('Slap Cup','Wait for GO. Clicking early hurts. Five reactions; lower time is converted into a higher score.');
    let round=0, times=[], armed=false, started=0, timer;
    ui.innerHTML=`<div class="scoreline">Reaction <span id="round">1</span> / 5</div><div class="arena" id="arena" style="display:grid;place-items:center"><button class="btn big-action" id="slap">WAIT...</button></div>`;
    const btn=ui.querySelector('#slap');
    function arm(){armed=false;btn.textContent='WAIT...';timer=setTimeout(()=>{armed=true;started=performance.now();btn.textContent='SLAP!';btn.classList.add('primary')},rand(900,2500));}
    btn.onclick=()=>{if(!armed){clearTimeout(timer);times.push(900);btn.textContent='TOO EARLY';btn.classList.remove('primary');setTimeout(next,500);return;}times.push(performance.now()-started);btn.classList.remove('primary');btn.textContent=`${Math.round(times.at(-1))} ms`;setTimeout(next,500)};
    function next(){round++;if(round>=5){const avg=times.reduce((a,b)=>a+b,0)/times.length;const score=clamp(7000-avg*10,0,5000);const cpuAvg=rand(250,520);finish(score,avg>cpuAvg);return;}ui.querySelector('#round').textContent=round+1;arm();} arm();
  }

  function kingsGame(){
    const ui=shell('Kings','Draw eight cards. Number cards score face value, face cards score 12, aces score 15, and kings score 20. Beat the CPU total.');
    let draws=0,total=0;const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];const suits=['♠','♥','♦','♣'];
    ui.innerHTML=`<div class="scoreline">Cards <span id="draws">0</span>/8 · Score <span id="score">0</span></div><div class="card-draw" id="card">🂠</div><button class="btn primary big-action" id="draw">DRAW CARD</button>`;
    ui.querySelector('#draw').onclick=()=>{const r=ranks[Math.floor(Math.random()*ranks.length)],s=suits[Math.floor(Math.random()*suits.length)];const val=r==='A'?15:r==='K'?20:(['J','Q'].includes(r)?12:Number(r));total+=val;draws++;ui.querySelector('#card').textContent=r+s;ui.querySelector('#draws').textContent=draws;ui.querySelector('#score').textContent=total;if(draws===8){ui.querySelector('#draw').disabled=true;const cpu=Math.round(rand(65,105));finish(total*45,total<cpu);}};
  }

  function pongGame(){
    const ui=shell('Pong','Move your mouse or finger vertically over the court. First to 5 wins.');
    ui.innerHTML=`<div class="scoreline">You <span id="you">0</span> · CPU <span id="cpu">0</span></div><canvas id="pong" width="720" height="360" class="arena" style="height:auto;max-width:100%"></canvas>`;
    const c=ui.querySelector('#pong'),ctx=c.getContext('2d');let py=140,cy=140,bx=360,by=180,vx=4.6,vy=3.2,ys=0,cs=0,running=true,ticks=0;
    function reset(dir){bx=360;by=180;vx=4.6*dir;vy=rand(-3.6,3.6)}
    function move(e){const rect=c.getBoundingClientRect();const y=(e.touches?e.touches[0].clientY:e.clientY)-rect.top;py=clamp(y/rect.height*c.height-45,0,c.height-90)}c.addEventListener('mousemove',move);c.addEventListener('touchmove',e=>{e.preventDefault();move(e)},{passive:false});
    function frame(){if(!running)return;ticks++;cy+=clamp(by-(cy+45),-2.6,2.6);bx+=vx;by+=vy;if(by<8||by>352)vy*=-1;if(bx<32&&bx>18&&by>py&&by<py+90&&vx<0){vx*=-1.04;bx=32}if(bx>688&&bx<702&&by>cy&&by<cy+90&&vx>0){vx*=-1.03;bx=688}if(bx<0){cs++;ui.querySelector('#cpu').textContent=cs;reset(1)}if(bx>720){ys++;ui.querySelector('#you').textContent=ys;reset(-1)}ctx.clearRect(0,0,720,360);ctx.fillStyle='#0b1710';ctx.fillRect(0,0,720,360);ctx.fillStyle='#74ff72';ctx.fillRect(20,py,10,90);ctx.fillRect(690,cy,10,90);ctx.beginPath();ctx.arc(bx,by,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#33443a';ctx.fillRect(358,0,4,360);if(ys>=5||cs>=5){running=false;finish(ys*1000+Math.max(0,500-cs*80),cs>ys);return}requestAnimationFrame(frame)}frame();
  }

  function flipCup(){
    const ui=shell('Flip Cup','Five flips. Stop the rotating cup as close to upright as possible.');let round=0,total=0,angle=0,speed=6.5,raf;
    ui.innerHTML=`<div class="scoreline">Flip <span id="r">1</span>/5 · Score <span id="score">0</span></div><div class="card-draw" id="cup">🥤</div><button class="btn primary big-action" id="flip">FLIP!</button>`;
    const cup=ui.querySelector('#cup');function loop(){angle=(angle+speed)%360;cup.style.transform=`rotate(${angle}deg)`;raf=requestAnimationFrame(loop)}loop();
    ui.querySelector('#flip').onclick=()=>{const d=Math.min(angle,360-angle);const pts=Math.round(Math.max(0,1000-d*7));total+=pts;round++;ui.querySelector('#score').textContent=total;speed=rand(5.3,8.3);if(round>=5){cancelAnimationFrame(raf);const cpu=Math.round(rand(2500,4300));finish(total,total<cpu);ui.querySelector('#flip').disabled=true}else ui.querySelector('#r').textContent=round+1;};
  }

  switch(game){
    case 'pong': pongGame(); break;
    case 'beer-die': meterGame('Beer Die','Stop the toss meter in the center sweet spot. Five tosses.',5); break;
    case 'flip-cup': flipCup(); break;
    case 'kings': kingsGame(); break;
    case 'quarters': meterGame('Quarters','Hit the center timing window. Six shots.',6); break;
    case 'cornhole': meterGame('Cornhole','Four bags. Center timing means a cleaner throw.',4); break;
    case 'slap-cup': reactionGame(); break;
  }
})();
