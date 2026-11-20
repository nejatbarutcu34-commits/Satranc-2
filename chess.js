// Satranç kuralları motoru. Hem tarayıcıda hem Node.js sunucusunda kullanılır.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Kareler: index = satır*8 + sütun, satır 0 = 8. rank (siyahın tarafı)
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const on = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;

  function initialState() {
    const board = new Array(64).fill(null);
    START.split('/').forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += +ch;
        else { board[r * 8 + f] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); f++; }
      }
    });
    return { board, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, ep: -1, half: 0, full: 1 };
  }

  function attacked(board, sq, by) {
    const r = sq >> 3, f = sq & 7;
    const pd = by === 'w' ? -1 : 1;
    for (const df of [-1, 1]) {
      const rr = r - pd, ff = f + df;
      if (on(rr, ff) && board[rr * 8 + ff] === by + 'P') return true;
    }
    for (const [dr, df] of KN) {
      const rr = r + dr, ff = f + df;
      if (on(rr, ff) && board[rr * 8 + ff] === by + 'N') return true;
    }
    for (const [dr, df] of KG) {
      const rr = r + dr, ff = f + df;
      if (on(rr, ff) && board[rr * 8 + ff] === by + 'K') return true;
    }
    for (const [dr, df] of KG) {
      const diag = dr !== 0 && df !== 0;
      let rr = r + dr, ff = f + df;
      while (on(rr, ff)) {
        const p = board[rr * 8 + ff];
        if (p) {
          if (p[0] === by && (p[1] === 'Q' || (diag ? p[1] === 'B' : p[1] === 'R'))) return true;
          break;
        }
        rr += dr; ff += df;
      }
    }
    return false;
  }

  const opp = c => (c === 'w' ? 'b' : 'w');
  const findKing = (board, c) => board.indexOf(c + 'K');
  const inCheck = (board, c) => attacked(board, findKing(board, c), opp(c));

  function pseudo(s) {
    const { board, turn: me } = s;
    const moves = [];
    const dir = me === 'w' ? -1 : 1;
    const promoRow = me === 'w' ? 0 : 7;
    const pushP = (from, to) => {
      if ((to >> 3) === promoRow) for (const promo of ['Q', 'R', 'B', 'N']) moves.push({ from, to, promo });
      else moves.push({ from, to });
    };
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p || p[0] !== me) continue;
      const r = i >> 3, f = i & 7, t = p[1];
      if (t === 'P') {
        const r1 = r + dir;
        if (on(r1, f) && !board[r1 * 8 + f]) {
          pushP(i, r1 * 8 + f);
          const start = me === 'w' ? 6 : 1;
          if (r === start && !board[(r + 2 * dir) * 8 + f]) moves.push({ from: i, to: (r + 2 * dir) * 8 + f });
        }
        for (const df of [-1, 1]) {
          const ff = f + df;
          if (!on(r1, ff)) continue;
          const to = r1 * 8 + ff, q = board[to];
          if (q && q[0] !== me) pushP(i, to);
          else if (!q && to === s.ep) moves.push({ from: i, to });
        }
      } else if (t === 'N' || t === 'K') {
        for (const [dr, df] of t === 'N' ? KN : KG) {
          const rr = r + dr, ff = f + df;
          if (!on(rr, ff)) continue;
          const q = board[rr * 8 + ff];
          if (!q || q[0] !== me) moves.push({ from: i, to: rr * 8 + ff });
        }
        if (t === 'K') {
          const base = me === 'w' ? 60 : 4, en = opp(me);
          if (i === base && !attacked(board, base, en)) {
            if (s.castling[me + 'K'] && board[base + 3] === me + 'R' && !board[base + 1] && !board[base + 2] &&
                !attacked(board, base + 1, en) && !attacked(board, base + 2, en))
              moves.push({ from: i, to: base + 2 });
            if (s.castling[me + 'Q'] && board[base - 4] === me + 'R' && !board[base - 1] && !board[base - 2] && !board[base - 3] &&
                !attacked(board, base - 1, en) && !attacked(board, base - 2, en))
              moves.push({ from: i, to: base - 2 });
          }
        }
      } else {
        for (const [dr, df] of KG) {
          const diag = dr !== 0 && df !== 0;
          if (t === 'B' && !diag) continue;
          if (t === 'R' && diag) continue;
          let rr = r + dr, ff = f + df;
          while (on(rr, ff)) {
            const q = board[rr * 8 + ff];
            if (!q) moves.push({ from: i, to: rr * 8 + ff });
            else { if (q[0] !== me) moves.push({ from: i, to: rr * 8 + ff }); break; }
            rr += dr; ff += df;
          }
        }
      }
    }
    return moves;
  }

  function apply(s, m) {
    const board = s.board.slice();
    const p = board[m.from], me = p[0], target = board[m.to];
    const c = Object.assign({}, s.castling);
    board[m.to] = p; board[m.from] = null;
    if (p[1] === 'P') {
      if (m.to === s.ep && !target && (m.from & 7) !== (m.to & 7)) board[(m.from >> 3) * 8 + (m.to & 7)] = null; // en passant
      if (m.promo) board[m.to] = me + m.promo;
    }
    if (p[1] === 'K') {
      c[me + 'K'] = false; c[me + 'Q'] = false;
      if (m.to - m.from === 2) { board[m.from + 1] = board[m.from + 3]; board[m.from + 3] = null; }
      if (m.from - m.to === 2) { board[m.from - 1] = board[m.from - 4]; board[m.from - 4] = null; }
    }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) c.wK = false; if (sq === 56) c.wQ = false;
      if (sq === 7) c.bK = false; if (sq === 0) c.bQ = false;
    }
    return {
      board, turn: opp(me), castling: c,
      ep: p[1] === 'P' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1,
      half: p[1] === 'P' || target ? 0 : s.half + 1,
      full: me === 'b' ? s.full + 1 : s.full,
    };
  }

  function legal(s) {
    return pseudo(s).filter(m => !inCheck(apply(s, m).board, s.turn));
  }

  function insufficient(board) {
    const rest = board.filter(p => p && p[1] !== 'K');
    return rest.length === 0 || (rest.length === 1 && (rest[0][1] === 'B' || rest[0][1] === 'N'));
  }

  // 'playing' | 'checkmate' | 'stalemate' | 'draw50' | 'insufficient'
  function status(s) {
    if (legal(s).length === 0) return inCheck(s.board, s.turn) ? 'checkmate' : 'stalemate';
    if (insufficient(s.board)) return 'insufficient';
    if (s.half >= 100) return 'draw50';
    return 'playing';
  }

  return { initialState, legal, apply, status, inCheck, findKing };
});
