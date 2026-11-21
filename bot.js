// Yapay zeka rakipler. Tarayıcıda (bot-worker.js içinde) ve Node.js'te çalışır.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chess.js'));
  else root.Bot = factory(root.Chess);
})(typeof self !== 'undefined' ? self : this, function (C) {
  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  // Taş konum tabloları (beyaz açısından, 0. satır = 8. yatay)
  const PST = {
    P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  };
  // Oyun sonu şahı: merkeze çıksın
  const KE = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

  // Karakterler
  //  peynir: tamamen rastgele oynar ama asla mat (ve pat) etmez
  //  fiko:   sadece malzemeye bakar (bedava taşı yer, taşını korur), plan yapmaz, mat görürse mat eder
  //  ismail: açılış kurallarını bilir (orta piyon, atlar, filler, rok), 4 hamle ileriyi hesaplar
  //  fisher: ismail'in hepsi + ezber açılışlar (Kralın Atı, Hollanda), 6 hamle ileriyi hesaplar
  const LEVELS = {
    peynir: { random: true },
    fiko:   { depth: 2, time: 300,  noise: 4,  material: true, mateIn1: true },
    ismail: { depth: 4, time: 1200, noise: 15, opening: true },
    fisher: { depth: 6, time: 2200, noise: 0,  opening: true, book: true },
  };

  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Değerlendirme ----------
  function evaluate(s) {
    const b = s.board;
    let np = 0, sc = 0;
    for (let i = 0; i < 64; i++) { const p = b[i]; if (p && p[1] !== 'P' && p[1] !== 'K') np += VAL[p[1]]; }
    const endgame = np <= 2400;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const t = p[1], white = p[0] === 'w';
      const idx = white ? i : (7 - (i >> 3)) * 8 + (i & 7);
      const v = VAL[t] + (t === 'K' && endgame ? KE : PST[t])[idx];
      sc += white ? v : -v;
    }
    return s.turn === 'w' ? sc : -sc;
  }
  function evalMaterial(s) {
    let sc = 0;
    for (const p of s.board) if (p && p[1] !== 'K') sc += p[0] === 'w' ? VAL[p[1]] : -VAL[p[1]];
    return s.turn === 'w' ? sc : -sc;
  }
  let evalFn = evaluate;

  // ---------- Arama ----------
  function order(s, moves) {
    return moves.map(m => {
      const victim = s.board[m.to], mover = s.board[m.from];
      let sc = 0;
      if (victim) sc = 10 * VAL[victim[1]] - VAL[mover[1]] / 10;
      else if (mover[1] === 'P' && m.to === s.ep) sc = 900;
      if (m.promo) sc += VAL[m.promo];
      return [sc, m];
    }).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  }

  let deadline = 0, nodes = 0, aborted = false;

  function search(s, depth, alpha, beta, ply) {
    if ((++nodes & 127) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    if (depth === 0) return evalFn(s);
    const moves = C.legal(s);
    if (!moves.length) return C.inCheck(s.board, s.turn) ? -99000 + ply : 0;
    if (s.half >= 100) return 0;
    let best = -Infinity;
    for (const m of order(s, moves)) {
      const sc = -search(C.apply(s, m), depth - 1, -beta, -alpha, ply + 1);
      if (aborted) return 0;
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Her hamlenin gerçek puanı (tam pencere). Süre yetmezse null.
  function fullScores(s, moves, depth, timeMs) {
    deadline = Date.now() + timeMs; aborted = false; nodes = 0;
    const out = [];
    for (const m of moves) {
      const sc = -search(C.apply(s, m), depth - 1, -Infinity, Infinity, 1);
      if (aborted) return null;
      out.push(sc);
    }
    return out;
  }

  // ---------- Ezber açılışlar (Fisher) ----------
  const sqOf = t => (8 - Number(t[1])) * 8 + (t.charCodeAt(0) - 97);
  const keyOf = s => s.board.map(p => p || '--').join('') + s.turn +
    (s.castling.wK ? 'K' : '') + (s.castling.wQ ? 'Q' : '') + (s.castling.bK ? 'k' : '') + (s.castling.bQ ? 'q' : '') + s.ep;
  // 'both': iki renk için de kayıtlı, 'b': sadece siyahın hamleleri (Hollanda savunması)
  const BOOK_LINES = [
    // Kralın Atı açılışı: 1.e4 e5 2.Nf3 Nc6
    ['both', 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8'],            // İtalyan (Giuoco Pianissimo)
    ['both', 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6 e1g1 e8g8'],            // İtalyan, Nf6 ile
    ['both', 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8'], // İspanyol (Ruy Lopez)
    ['both', 'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7 d1e2 f6d5 c2c4 c8a6'], // İskoç
    ['both', 'e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 f1b5 f8b4 e1g1 e8g8 d2d3 d7d6 c1g5 b4c3 b2c3 d8e7'], // Dört At
    // Hollanda savunması (siyah): 1.d4 f5
    ['b', 'd2d4 f7f5 g2g3 g8f6 f1g2 e7e6 g1f3 f8e7 e1g1 e8g8 c2c4 d7d6 b1c3 d8e8'],
    ['b', 'd2d4 f7f5 c2c4 g8f6 b1c3 e7e6 g1f3 f8e7 g2g3 e8g8 f1g2 d7d6 e1g1 d8e8'],
    ['b', 'd2d4 f7f5 g1f3 g8f6 g2g3 e7e6 f1g2 f8e7 e1g1 e8g8 c2c4 d7d6 b1c3 d8e8'],
  ];
  const book = new Map();
  const bookErrors = [];
  for (const [mode, text] of BOOK_LINES) {
    let s = C.initialState();
    for (const t of text.split(' ')) {
      const from = sqOf(t.slice(0, 2)), to = sqOf(t.slice(2, 4));
      if (mode === 'both' || s.turn === 'b') {
        const k = keyOf(s);
        if (!book.has(k)) book.set(k, new Set());
        book.get(k).add(from + ':' + to);
      }
      const m = C.legal(s).find(x => x.from === from && x.to === to);
      if (!m) { bookErrors.push(text + ' @ ' + t); break; }
      s = C.apply(s, m);
    }
  }
  function bookMove(s) {
    const set = book.get(keyOf(s));
    if (!set) return null;
    const opts = C.legal(s).filter(m => set.has(m.from + ':' + m.to));
    return opts.length ? pick(opts) : null;
  }

  // ---------- Açılış kuralları (İsmail, Fisher) ----------
  // 1) orta piyon (önce şahın önündeki), 2) atlar, 3) filler, 4) rok.
  // Hamle ancak güvenliyse oynanır: arama, o hamlede malzeme kaybı görmüyorsa.
  function openingMove(s, L, scale) {
    if (s.full > 12 || C.inCheck(s.board, s.turn)) return null;
    const me = s.turn, b = s.board;
    const home = me === 'w' ? 7 : 0, pawnRow = me === 'w' ? 6 : 1, dev = me === 'w' ? 5 : 2;
    const moves = C.legal(s);
    let cand = [];

    if (b[pawnRow * 8 + 4] === me + 'P' && b[pawnRow * 8 + 3] === me + 'P') {
      const dbl = f => moves.filter(m => m.from === pawnRow * 8 + f && Math.abs(m.to - m.from) === 16);
      cand = Math.random() < 0.75 ? dbl(4) : dbl(3);
    }
    if (!cand.length) { // atlar: c3/f3 ya da c6/f6
      cand = moves.filter(m => b[m.from] === me + 'N' && (m.from === home * 8 + 1 || m.from === home * 8 + 6) &&
        (m.to === dev * 8 + 2 || m.to === dev * 8 + 5));
    }
    if (!cand.length) { // filler: kenar olmayan, 2-4 sıra ilerideki karelere
      cand = moves.filter(m => b[m.from] === me + 'B' && (m.from === home * 8 + 2 || m.from === home * 8 + 5) &&
        Math.abs((m.to >> 3) - home) >= 2 && Math.abs((m.to >> 3) - home) <= 4 && (m.to & 7) >= 1 && (m.to & 7) <= 6);
    }
    if (!cand.length) { // rok: önce şah tarafı
      const castles = moves.filter(m => b[m.from] === me + 'K' && Math.abs(m.to - m.from) === 2);
      cand = castles.filter(m => m.to > m.from);
      if (!cand.length) cand = castles;
    }
    if (!cand.length) return null;

    // Güvenlik testi sadece malzemeye bakar: hamle taş kaybettirmiyorsa (ve bedava taşı kaçırmıyorsa) güvenlidir
    const prevEval = evalFn;
    evalFn = evalMaterial;
    const scores = fullScores(s, moves, Math.min(L.depth, 4), L.time * scale * 1.5);
    evalFn = prevEval;
    if (!scores) return null;
    const best = Math.max.apply(null, scores);
    const safe = cand.filter(m => scores[moves.indexOf(m)] >= best - 30);
    return safe.length ? pick(safe) : null;
  }

  // ---------- Hamle seçimi ----------
  function choose(s, id, timeScale) {
    const L = LEVELS[id] || LEVELS.ismail;
    const scale = timeScale || 1;
    let moves = C.legal(s);
    if (!moves.length) return null;

    if (L.random) { // Eğitimci Peynir: tamamen rastgele, ama asla mat (ya da pat) etmez
      const safe = moves.filter(m => {
        const st = C.status(C.apply(s, m));
        return st !== 'checkmate' && st !== 'stalemate';
      });
      return pick(safe.length ? safe : moves);
    }
    if (L.mateIn1) { // Fiko: mat görürse mat eder
      const mates = moves.filter(m => C.status(C.apply(s, m)) === 'checkmate');
      if (mates.length) return pick(mates);
    }
    if (moves.length === 1) return moves[0];
    if (L.book) { const bm = bookMove(s); if (bm) return bm; }

    evalFn = L.material ? evalMaterial : evaluate;
    if (L.opening) { const om = openingMove(s, L, scale); if (om) return om; }

    moves = order(s, moves);
    deadline = Date.now() + L.time * scale;
    aborted = false;
    nodes = 0;
    let best = moves[0];
    for (let d = 1; d <= L.depth; d++) {
      let alpha = -Infinity, curBest = null, curScore = -Infinity;
      for (const m of moves) {
        const child = C.apply(s, m);
        const sc = L.noise
          ? -search(child, d - 1, -Infinity, Infinity, 1) + (Math.random() * 2 - 1) * L.noise
          : -search(child, d - 1, -Infinity, -alpha, 1);
        if (aborted) break;
        if (sc > curScore) { curScore = sc; curBest = m; }
        if (sc > alpha) alpha = sc;
      }
      if (aborted) break;
      best = curBest;
      moves = [curBest].concat(moves.filter(m => m !== curBest));
      if (Math.abs(curScore) > 90000) break; // mat bulundu
    }
    return best;
  }

  return { choose, evaluate, PST, KE, _book: book, _bookErrors: bookErrors };
});
