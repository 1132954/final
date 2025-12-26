(() => {
  "use strict";

  // ========= Config =========
  const N = 9;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const KOMI = 6.5; // 白貼目

  // Canvas + layout
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  // UI refs
  const turnText = document.getElementById("turnText");
  const turnDot  = document.getElementById("turnDot");
  const capBEl   = document.getElementById("capB");
  const capWEl   = document.getElementById("capW");
  const passEl   = document.getElementById("passCount");
  const warningEl= document.getElementById("warning");

  const btnPass  = document.getElementById("btnPass");
  const btnUndo  = document.getElementById("btnUndo");
  const btnNew   = document.getElementById("btnNew");

  const overlay  = document.getElementById("overlay");
  const btnScore = document.getElementById("btnScore");
  const btnBack  = document.getElementById("btnBackToGame");
  const btnNew2  = document.getElementById("btnNew2");
  const scoreBEl = document.getElementById("scoreB");
  const scoreWEl = document.getElementById("scoreW");
  const scoreDetailEl = document.getElementById("scoreDetail");

  // ========= State =========
  let board;
  let toPlay;
  let captures = { [BLACK]: 0, [WHITE]: 0 };
  let consecutivePasses = 0;
  let lastMove = null;
  let history = [];
  let prevPosStr = "";
  let inScoring = false;
  let dead = new Set();

  // Hover preview (UI/UX +)
  let hover = null; // {x,y} or null

  // Capture animation (UI/UX +)
  let capAnims = []; // [{x,y,color,t0,dur}]
  let rafId = null;

  // Warning helper (讓錯誤提示停留一下，不要瞬間被 updateUI 洗掉)
  let warningTimer = null;
  function showWarning(msg){
    warningEl.textContent = msg;
    if (warningTimer) clearTimeout(warningTimer);
    warningTimer = setTimeout(() => {
      warningTimer = null;
      updateUI();
    }, 2500);
  }

  // ========= Helpers =========
  const key = (x,y) => `${x},${y}`;
  const inBounds = (x,y) => x>=0 && x<N && y>=0 && y<N;
  const opp = (c) => c === BLACK ? WHITE : (c === WHITE ? BLACK : EMPTY);

  function cloneBoard(b){
    return b.map(row => row.slice());
  }

  function boardToString(b){
    let s = "";
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++) s += b[y][x];
    }
    return s;
  }

  function neighbors(x,y){
    const res = [];
    if(inBounds(x-1,y)) res.push([x-1,y]);
    if(inBounds(x+1,y)) res.push([x+1,y]);
    if(inBounds(x,y-1)) res.push([x,y-1]);
    if(inBounds(x,y+1)) res.push([x,y+1]);
    return res;
  }

  function getGroupAndLiberties(b, sx, sy){
    const color = b[sy][sx];
    if(color === EMPTY) return { stones: [], liberties: new Set() };

    const seen = new Set();
    const stones = [];
    const liberties = new Set();
    const stack = [[sx,sy]];
    seen.add(key(sx,sy));

    while(stack.length){
      const [x,y] = stack.pop();
      stones.push([x,y]);

      for(const [nx,ny] of neighbors(x,y)){
        const v = b[ny][nx];
        if(v === EMPTY){
          liberties.add(key(nx,ny));
        }else if(v === color){
          const k = key(nx,ny);
          if(!seen.has(k)){
            seen.add(k);
            stack.push([nx,ny]);
          }
        }
      }
    }
    return { stones, liberties };
  }

  function removeStones(b, stones){
    for(const [x,y] of stones) b[y][x] = EMPTY;
  }

  function tryPlay(b, x, y, color){
    if(!inBounds(x,y)) return { ok:false, reason:"out_of_bounds" };
    if(b[y][x] !== EMPTY) return { ok:false, reason:"occupied" };

    const b2 = cloneBoard(b);
    b2[y][x] = color;

    // capture adjacent opponent groups with 0 liberties
    let capturedCount = 0;
    const capturedStones = [];
    for(const [nx,ny] of neighbors(x,y)){
      if(b2[ny][nx] === opp(color)){
        const g = getGroupAndLiberties(b2, nx, ny);
        if(g.liberties.size === 0){
          capturedCount += g.stones.length;
          capturedStones.push(...g.stones);
          removeStones(b2, g.stones);
        }
      }
    }

    // suicide check
    const myGroup = getGroupAndLiberties(b2, x, y);
    if(myGroup.liberties.size === 0){
      return { ok:false, reason:"suicide" };
    }

    return { ok:true, b2, capturedCount, capturedStones };
  }

  function isLegalMove(b, x, y, color){
    const r = tryPlay(b, x, y, color);
    if(!r.ok) return { ok:false, reason:r.reason };

    // simple ko: forbid returning to immediate previous position
    const posStr = boardToString(r.b2);
    if(prevPosStr && posStr === prevPosStr){
      return { ok:false, reason:"ko" };
    }
    return { ok:true, next:r };
  }

  // ========= Drawing =========
  function computeGeometry(){
    const w = canvas.width, h = canvas.height;
    const pad = Math.floor(Math.min(w,h) * 0.08);
    const size = Math.min(w,h) - pad*2;
    const step = size / (N-1);
    return { pad, size, step, w, h };
  }

  function toBoardCoord(px, py){
    const { pad, step } = computeGeometry();
    const x = Math.round((px - pad) / step);
    const y = Math.round((py - pad) / step);
    if(!inBounds(x,y)) return null;

    const cx = pad + x*step, cy = pad + y*step;
    const dist2 = (px-cx)*(px-cx) + (py-cy)*(py-cy);
    if(dist2 > (step*0.45)*(step*0.45)) return null;
    return { x, y };
  }

  function drawBoard(){
    const { pad, step, w, h } = computeGeometry();
    ctx.clearRect(0,0,w,h);

    // grid lines
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.floor(step*0.06));
    ctx.strokeStyle = "rgba(20,20,20,.85)";

    for(let i=0;i<N;i++){
      const p = pad + i*step;
      // vertical
      ctx.beginPath();
      ctx.moveTo(p, pad);
      ctx.lineTo(p, pad + step*(N-1));
      ctx.stroke();
      // horizontal
      ctx.beginPath();
      ctx.moveTo(pad, p);
      ctx.lineTo(pad + step*(N-1), p);
      ctx.stroke();
    }

    // star points (9x9)
    const stars = [[2,2],[2,6],[4,4],[6,2],[6,6]];
    ctx.fillStyle = "rgba(15,15,15,.85)";
    for(const [sx,sy] of stars){
      const x = pad + sx*step, y = pad + sy*step;
      ctx.beginPath();
      ctx.arc(x,y, Math.max(2, step*0.08), 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    // scoring overlay hint
    if(inScoring){
      drawTerritoryOverlay();
    }

    // capture fade-out animation layer
    drawCaptureAnims();

    // stones
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        const c = board[y][x];
        if(c !== EMPTY){
          drawStone(x,y,c);
          if(inScoring && dead.has(key(x,y))){
            drawDeadMark(x,y);
          }
        }
      }
    }

    // last move marker
    if(lastMove){
      drawLastMoveMarker(lastMove.x, lastMove.y, lastMove.color);
    }

    // hover preview (only user's turn)
    if(!inScoring && toPlay === BLACK && hover){
      const legal = isLegalMove(board, hover.x, hover.y, BLACK);
      if(legal.ok){
        drawGhostStone(hover.x, hover.y, BLACK);
      }
    }
  }

  function drawStone(x,y,color){
    const { pad, step } = computeGeometry();
    const cx = pad + x*step, cy = pad + y*step;
    const r = step*0.42;

    ctx.save();
    // shadow
    ctx.beginPath();
    ctx.arc(cx + r*0.08, cy + r*0.10, r*0.98, 0, Math.PI*2);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fill();

    // body gradient
    const g = ctx.createRadialGradient(cx - r*0.3, cy - r*0.35, r*0.1, cx, cy, r);
    if(color === BLACK){
      g.addColorStop(0, "rgba(255,255,255,.18)");
      g.addColorStop(0.35, "rgba(40,40,40,1)");
      g.addColorStop(1, "rgba(10,10,10,1)");
    }else{
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.5, "rgba(235,235,235,1)");
      g.addColorStop(1, "rgba(200,200,200,1)");
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, step*0.05);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.stroke();

    ctx.restore();
  }

  function drawGhostStone(x, y, color){
    const { pad, step } = computeGeometry();
    const cx = pad + x*step, cy = pad + y*step;
    const r = step*0.42;

    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = (color === BLACK) ? "rgba(10,10,10,1)" : "rgba(245,245,245,1)";
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, step*0.05);
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.stroke();
    ctx.restore();
  }

  function drawCaptureAnims(){
    if(capAnims.length === 0) return;

    const now = performance.now();
    const { pad, step } = computeGeometry();

    capAnims = capAnims.filter(a => now - a.t0 < a.dur);

    for(const a of capAnims){
      const t = (now - a.t0) / a.dur;      // 0..1
      const alpha = Math.max(0, 1 - t);
      const r = step*0.42 * (1 + t*0.10);

      const cx = pad + a.x*step, cy = pad + a.y*step;

      ctx.save();
      ctx.globalAlpha = 0.55 * alpha;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = (a.color === BLACK) ? "rgba(10,10,10,1)" : "rgba(245,245,245,1)";
      ctx.fill();

      ctx.restore();
    }

    if(capAnims.length > 0){
      if(rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => drawBoard());
    }else{
      if(rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function drawLastMoveMarker(x,y,color){
    const { pad, step } = computeGeometry();
    const cx = pad + x*step, cy = pad + y*step;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, step*0.12, 0, Math.PI*2);
    ctx.fillStyle = (color === BLACK) ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.55)";
    ctx.fill();
    ctx.restore();
  }

  function drawDeadMark(x,y){
    const { pad, step } = computeGeometry();
    const cx = pad + x*step, cy = pad + y*step;
    ctx.save();
    ctx.strokeStyle = "rgba(255,107,107,.85)";
    ctx.lineWidth = Math.max(2, step*0.08);
    const r = step*0.18;
    ctx.beginPath();
    ctx.moveTo(cx-r, cy-r);
    ctx.lineTo(cx+r, cy+r);
    ctx.moveTo(cx+r, cy-r);
    ctx.lineTo(cx-r, cy+r);
    ctx.stroke();
    ctx.restore();
  }

  function drawTerritoryOverlay(){
    const terr = computeTerritoryPreviewCells();
    const { pad, step } = computeGeometry();

    ctx.save();
    ctx.globalAlpha = 0.18;
    for(const [k, owner] of terr){
      const [xStr,yStr] = k.split(",");
      const x = +xStr, y = +yStr;
      const cx = pad + x*step, cy = pad + y*step;
      ctx.beginPath();
      ctx.arc(cx, cy, step*0.20, 0, Math.PI*2);
      ctx.fillStyle = owner === BLACK ? "#000" : "#fff";
      ctx.fill();
    }
    ctx.restore();
  }

  // ========= Game flow =========
  function resetGame(){
    board = Array.from({length:N}, () => Array(N).fill(EMPTY));
    toPlay = BLACK;
    captures[BLACK] = 0;
    captures[WHITE] = 0;
    consecutivePasses = 0;
    lastMove = null;
    history = [];
    prevPosStr = "";
    inScoring = false;
    dead.clear();
    hover = null;
    capAnims = [];
    overlay.classList.add("hidden");
    updateUI();
    drawBoard();
  }

  function pushHistory(){
    history.push({
      board: cloneBoard(board),
      toPlay,
      captures: { [BLACK]: captures[BLACK], [WHITE]: captures[WHITE] },
      consecutivePasses,
      lastMove: lastMove ? {...lastMove} : null,
      prevPosStr
    });
  }

  function popHistory(){
    const h = history.pop();
    if(!h) return;
    board = cloneBoard(h.board);
    toPlay = h.toPlay;
    captures[BLACK] = h.captures[BLACK];
    captures[WHITE] = h.captures[WHITE];
    consecutivePasses = h.consecutivePasses;
    lastMove = h.lastMove ? {...h.lastMove} : null;
    prevPosStr = h.prevPosStr;
    hover = null;
    updateUI();
    drawBoard();
  }

  function updateUI(){
    capBEl.textContent = String(captures[BLACK]);
    capWEl.textContent = String(captures[WHITE]);
    passEl.textContent = String(consecutivePasses);

    if(toPlay === BLACK){
      turnText.textContent = "輪到：黑（你）";
      turnDot.style.background = "#111";
      turnDot.style.borderColor = "rgba(255,255,255,.35)";
    }else{
      turnText.textContent = "輪到：白（電腦）";
      turnDot.style.background = "#fff";
      turnDot.style.borderColor = "rgba(0,0,0,.35)";
    }

    if(inScoring){
      warningEl.textContent = "終局決算模式：點棋串標記死棋，再按結算。";
      return;
    }

    const warn = detectAtariWarnings(board);
    warningEl.textContent = warn;
  }

  function detectAtariWarnings(b){
    const seen = new Set();
    let blackAtari = 0, whiteAtari = 0;

    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        const c = b[y][x];
        if(c === EMPTY) continue;
        const k = key(x,y);
        if(seen.has(k)) continue;
        const g = getGroupAndLiberties(b,x,y);
        for(const [sx,sy] of g.stones) seen.add(key(sx,sy));
        if(g.liberties.size === 1){
          if(c === BLACK) blackAtari++;
          else whiteAtari++;
        }
      }
    }

    if(blackAtari === 0 && whiteAtari === 0) return "";
    let msg = "⚠ 叫吃：";
    const parts = [];
    if(blackAtari>0) parts.push(`黑方有 ${blackAtari} 串只剩 1 氣`);
    if(whiteAtari>0) parts.push(`白方有 ${whiteAtari} 串只剩 1 氣`);
    return msg + parts.join("；");
  }

  function endByPasses(){
    inScoring = true;
    hover = null;
    overlay.classList.remove("hidden");
    updateUI();
    drawBoard();
    showScore(computeFinalScore());
  }

  function showScore(s){
  scoreBEl.textContent = String(s.blackTotal);
  scoreWEl.textContent = String(s.whiteTotal);

  scoreDetailEl.innerHTML =
    `黑：地盤 <b>${s.blackTerritory}</b> + 白死子 <b>${s.whiteDeadCount}</b> + 提子 <b>${captures[BLACK]}</b><br>` +
    `白：地盤 <b>${s.whiteTerritory}</b> + 黑死子 <b>${s.blackDeadCount}</b> + 提子 <b>${captures[WHITE]}</b> + 貼目 <b>${KOMI}</b><br>` ;
}

  // ========= Move handlers =========
  function playMove(x,y,color){
    const legal = isLegalMove(board, x, y, color);
    if(!legal.ok){
      if(color === BLACK){
        let msg = "";
        if(legal.reason === "occupied") msg = "這裡已經有棋子。";
        else if(legal.reason === "suicide") msg = "禁著點：不可自殺。";
        else if(legal.reason === "ko") msg = "禁著點：劫（ko）不可立即回到上一手局面。";
        else msg = "不合法落子。";
        showWarning("⚠ " + msg);
      }
      return false;
    }

    pushHistory();

    const { b2, capturedCount, capturedStones } = legal.next;

    // simple ko reference: store previous position
    prevPosStr = boardToString(board);

    board = b2;

    // capture animation
    if(capturedCount > 0 && capturedStones && capturedStones.length){
      const t0 = performance.now();
      for(const [cx, cy] of capturedStones){
        capAnims.push({ x: cx, y: cy, color: opp(color), t0, dur: 240 });
      }
      if(!rafId){
        rafId = requestAnimationFrame(() => drawBoard());
      }
    }

    if(capturedCount > 0){
      captures[color] += capturedCount;
    }
    consecutivePasses = 0;

    lastMove = { x, y, color };
    toPlay = opp(color);

    hover = null;
    updateUI();
    drawBoard();
    return true;
  }

  function passTurn(){
    if(inScoring) return;
    pushHistory();

    prevPosStr = boardToString(board);
    lastMove = null;
    hover = null;

    consecutivePasses += 1;
    toPlay = opp(toPlay);

    updateUI();
    drawBoard();

    if(consecutivePasses >= 2){
      endByPasses();
      return;
    }

    if(toPlay === WHITE){
      setTimeout(computerPlay, 220);
    }
  }

  // ========= AI (simple heuristic) =========
  function listLegalMoves(b, color){
    const res = [];
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(b[y][x] !== EMPTY) continue;
        const legal = isLegalMove(b, x, y, color);
        if(legal.ok) res.push({x,y, next: legal.next});
      }
    }
    return res;
  }

  function countOpponentAtari(b, colorJustPlayed){
    const opponent = opp(colorJustPlayed);
    const seen = new Set();
    let cnt = 0;
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(b[y][x] !== opponent) continue;
        const k = key(x,y);
        if(seen.has(k)) continue;
        const g = getGroupAndLiberties(b,x,y);
        for(const [sx,sy] of g.stones) seen.add(key(sx,sy));
        if(g.liberties.size === 1) cnt++;
      }
    }
    return cnt;
  }

  function evaluateMoveForAI(move){
    const { x,y, next } = move;
    const { b2, capturedCount } = next;

    const g = getGroupAndLiberties(b2, x, y);
    const libs = g.liberties.size;

    let score = 0;
    score += capturedCount * 12;
    score += Math.min(6, libs) * 1.2;

    if(libs === 1) score -= 8; // avoid self-atari

    const cx = (N-1)/2, cy = (N-1)/2;
    const dist = Math.abs(x-cx) + Math.abs(y-cy);
    score += (N - dist) * 0.15;

    score += countOpponentAtari(b2, WHITE) * 0.9;
    score += Math.random() * 0.25;
    return score;
  }

  function computerPlay(){
    if(inScoring) return;
    if(toPlay !== WHITE) return;

    const moves = listLegalMoves(board, WHITE);
    if(moves.length === 0){
      passTurn();
      return;
    }

    let best = moves[0];
    let bestScore = -Infinity;
    for(const m of moves){
      const sc = evaluateMoveForAI(m);
      if(sc > bestScore){
        bestScore = sc;
        best = m;
      }
    }

    playMove(best.x, best.y, WHITE);
  }

  // ========= Scoring =========
  function stoneAtScoring(x,y){
    const v = board[y][x];
    if(v === EMPTY) return EMPTY;
    if(dead.has(key(x,y))) return EMPTY;
    return v;
  }

  function countDead(color){
    let cnt = 0;
    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(board[y][x] === color && dead.has(key(x,y))) cnt++;
      }
    }
    return cnt;
  }

  function computeFinalScore(){
    const visited = new Set();
    let blackTerritory = 0, whiteTerritory = 0;

    const blackDeadCount = countDead(BLACK);
    const whiteDeadCount = countDead(WHITE);

    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(stoneAtScoring(x,y) !== EMPTY) continue;
        const k0 = key(x,y);
        if(visited.has(k0)) continue;

        const q = [[x,y]];
        visited.add(k0);
        const region = [];
        const border = new Set();

        while(q.length){
          const [cx,cy] = q.pop();
          region.push([cx,cy]);

          for(const [nx,ny] of neighbors(cx,cy)){
            const v = stoneAtScoring(nx,ny);
            if(v === EMPTY){
              const kk = key(nx,ny);
              if(!visited.has(kk)){
                visited.add(kk);
                q.push([nx,ny]);
              }
            }else{
              border.add(v);
            }
          }
        }

        if(border.size === 1){
          const owner = [...border][0];
          if(owner === BLACK) blackTerritory += region.length;
          if(owner === WHITE) whiteTerritory += region.length;
        }
      }
    }

    const blackTotal = blackTerritory + whiteDeadCount + captures[BLACK];
    const whiteTotal = whiteTerritory + blackDeadCount + captures[WHITE] + KOMI;

    return {
      blackTerritory, whiteTerritory,
      blackDeadCount, whiteDeadCount,
      blackTotal, whiteTotal
    };
  }

  function computeTerritoryPreviewCells(){
    const visited = new Set();
    const territoryCells = [];

    for(let y=0;y<N;y++){
      for(let x=0;x<N;x++){
        if(stoneAtScoring(x,y) !== EMPTY) continue;
        const k0 = key(x,y);
        if(visited.has(k0)) continue;

        const q = [[x,y]];
        visited.add(k0);
        const region = [];
        const border = new Set();

        while(q.length){
          const [cx,cy] = q.pop();
          region.push([cx,cy]);

          for(const [nx,ny] of neighbors(cx,cy)){
            const v = stoneAtScoring(nx,ny);
            if(v === EMPTY){
              const kk = key(nx,ny);
              if(!visited.has(kk)){
                visited.add(kk);
                q.push([nx,ny]);
              }
            }else{
              border.add(v);
            }
          }
        }

        if(border.size === 1){
          const owner = [...border][0];
          for(const [rx,ry] of region){
            territoryCells.push([key(rx,ry), owner]);
          }
        }
      }
    }
    return territoryCells;
  }

  function toggleDeadGroupAt(x,y){
    const v = board[y][x];
    if(v === EMPTY) return;

    const g = getGroupAndLiberties(board, x, y);

    let allDead = true;
    for(const [sx,sy] of g.stones){
      if(!dead.has(key(sx,sy))){
        allDead = false;
        break;
      }
    }

    for(const [sx,sy] of g.stones){
      const k = key(sx,sy);
      if(allDead) dead.delete(k);
      else dead.add(k);
    }
  }

  // ========= Events =========
  function onCanvasClick(ev){
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const py = (ev.clientY - rect.top)  * (canvas.height / rect.height);

    const p = toBoardCoord(px,py);
    if(!p) return;

    if(inScoring){
      if(board[p.y][p.x] !== EMPTY){
        toggleDeadGroupAt(p.x,p.y);
        drawBoard();
        showScore(computeFinalScore());
      }
      return;
    }

    if(toPlay !== BLACK) return;
    const ok = playMove(p.x, p.y, BLACK);
    if(ok && toPlay === WHITE){
      setTimeout(computerPlay, 220);
    }
  }

  btnPass.addEventListener("click", () => {
    if(inScoring) return;
    passTurn();
  });

  btnUndo.addEventListener("click", () => {
    if(inScoring) return;
    if(history.length === 0) return;

    popHistory();
    if(toPlay === WHITE && history.length > 0){
      popHistory();
    }
  });

  btnNew.addEventListener("click", resetGame);
  btnNew2.addEventListener("click", resetGame);

  btnScore.addEventListener("click", () => {
    if(!inScoring) return;
    showScore(computeFinalScore());
  });

  btnBack.addEventListener("click", () => {
    inScoring = false;
    dead.clear();
    overlay.classList.add("hidden");
    updateUI();
    drawBoard();
  });

  canvas.addEventListener("click", onCanvasClick);

  // hover preview events
  canvas.addEventListener("mousemove", (ev) => {
    if(inScoring || toPlay !== BLACK) { hover = null; return; }

    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const py = (ev.clientY - rect.top)  * (canvas.height / rect.height);

    const p = toBoardCoord(px, py);
    if(!p){
      if(hover){ hover = null; drawBoard(); }
      return;
    }

    if(!hover || hover.x !== p.x || hover.y !== p.y){
      hover = { x: p.x, y: p.y };
      drawBoard();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if(hover){
      hover = null;
      drawBoard();
    }
  });

  // ========= Resize (robust) =========
  function resizeCanvas(){
    const parent = canvas.parentElement || document.body;
    const rect = parent.getBoundingClientRect();
    const size = Math.max(520, Math.min(Math.floor(rect.width) - 28, 900));

    canvas.width = size;
    canvas.height = size;

    drawBoard();
  }

  window.addEventListener("resize", resizeCanvas);

  // ========= Init =========
  resetGame();
  resizeCanvas();
})();
