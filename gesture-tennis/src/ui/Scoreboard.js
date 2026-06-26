// Scoreboard — renders tennis score into #scoreboard
//
// Expected score shape from GameState.getScore():
//   {
//     points:     { player: '30', ai: '15', isDeuce: bool },
//     games:      { player: 4, ai: 3 },
//     sets:       [{ player: 6, ai: 4 }, …],   // completed sets
//     inTiebreak: false,
//   }
//
// DOM structure (built once in constructor, updated in render()):
//   #scoreboard
//     table.sb-table
//       thead > tr: name-col | set cols… | GAME col | POINT col
//       tbody > tr#sb-player, tr#sb-ai
//         td.sb-name | td.sb-set… | td.sb-games | td.sb-pts

export class Scoreboard {
  constructor() {
    this._root = document.getElementById('scoreboard');
    this._setsShown = 0;   // how many set columns currently exist in the DOM

    this._root.innerHTML = '';
    this._buildTable();
  }

  // Update every visible cell to reflect current score.
  render(score) {
    const { points, games, sets, inTiebreak } = score;

    // Add new set columns if completed sets increased
    this._ensureSetColumns(sets.length);

    // Fill completed set cells (both rows)
    for (let i = 0; i < sets.length; i++) {
      this._cell('sb-setp', i).textContent = sets[i].player;
      this._cell('sb-seta', i).textContent = sets[i].ai;
    }

    // Current set header — e.g. "SET 2" or "TIEBREAK"
    const setIdx = sets.length;
    const setLabel = inTiebreak ? 'TIEBREAK' : `SET ${setIdx + 1}`;
    this._el('sb-curset-h').textContent = setLabel;

    // Current games
    this._el('sb-games-p').textContent = games.player;
    this._el('sb-games-a').textContent = games.ai;

    // Points — colour the cell for deuce/advantage
    const pp = this._el('sb-pts-p');
    const ap = this._el('sb-pts-a');
    pp.textContent = inTiebreak ? String(score.points.player) : points.player;
    ap.textContent = inTiebreak ? String(score.points.ai)     : points.ai;

    const deuceClass = points.isDeuce ? 'deuce' : '';
    const pAdvClass  = (!points.isDeuce && points.player === 'AD') ? 'advantage' : '';
    const aAdvClass  = (!points.isDeuce && points.ai     === 'AD') ? 'advantage' : '';

    pp.className = `sb-pts ${deuceClass}${pAdvClass}`.trim();
    ap.className = `sb-pts ${deuceClass}${aAdvClass}`.trim();
  }

  // ─── private ─────────────────────────────────────────────────────────────────

  _buildTable() {
    this._thead = document.createElement('thead');
    this._tbody = document.createElement('tbody');

    // ── header row ───────────────────────────────────────────────────────────
    this._headerRow = document.createElement('tr');
    this._addTh(this._headerRow, '');          // name col
    // set cols added dynamically via _ensureSetColumns
    // current set col (always visible)
    const curH = this._addTh(this._headerRow, 'SET 1');
    curH.id = 'sb-curset-h';
    this._addTh(this._headerRow, 'GAME');
    this._addTh(this._headerRow, 'POINT');
    this._thead.appendChild(this._headerRow);

    // ── player row ───────────────────────────────────────────────────────────
    this._rowPlayer = document.createElement('tr');
    this._rowPlayer.id = 'sb-row-player';
    this._addTd(this._rowPlayer, 'YOU', 'sb-name');
    // set cells inserted dynamically
    const gp = this._addTd(this._rowPlayer, '0', 'sb-games');
    gp.id = 'sb-games-p';
    const pp = this._addTd(this._rowPlayer, '0', 'sb-pts');
    pp.id = 'sb-pts-p';

    // ── AI row ────────────────────────────────────────────────────────────────
    this._rowAi = document.createElement('tr');
    this._rowAi.id = 'sb-row-ai';
    this._addTd(this._rowAi, 'AI', 'sb-name');
    // set cells inserted dynamically
    const ga = this._addTd(this._rowAi, '0', 'sb-games');
    ga.id = 'sb-games-a';
    const pa = this._addTd(this._rowAi, '0', 'sb-pts');
    pa.id = 'sb-pts-a';

    this._tbody.appendChild(this._rowPlayer);
    this._tbody.appendChild(this._rowAi);

    const table = document.createElement('table');
    table.className = 'sb-table';
    table.appendChild(this._thead);
    table.appendChild(this._tbody);
    this._root.appendChild(table);
  }

  // Insert set-score columns before the GAME and POINT columns (which are last).
  _ensureSetColumns(count) {
    while (this._setsShown < count) {
      const i = this._setsShown;

      // Header
      const th = this._addThBefore(
        this._headerRow,
        `S${i + 1}`,
        this._el('sb-curset-h')
      );
      th.className = 'sb-set-header';

      // Player cell
      const tdp = this._addTdBefore(this._rowPlayer, '–', 'sb-set', this._el('sb-games-p'));
      tdp.id = `sb-setp-${i}`;

      // AI cell
      const tda = this._addTdBefore(this._rowAi, '–', 'sb-set', this._el('sb-games-a'));
      tda.id = `sb-seta-${i}`;

      this._setsShown++;
    }
  }

  _el(id)         { return document.getElementById(id); }
  _cell(pfx, i)   { return document.getElementById(`${pfx}-${i}`); }

  _addTh(row, text) {
    const th = document.createElement('th');
    th.textContent = text;
    row.appendChild(th);
    return th;
  }

  _addTd(row, text, cls) {
    const td = document.createElement('td');
    td.className   = cls;
    td.textContent = text;
    row.appendChild(td);
    return td;
  }

  _addThBefore(row, text, refEl) {
    const th = document.createElement('th');
    th.textContent = text;
    row.insertBefore(th, refEl);
    return th;
  }

  _addTdBefore(row, text, cls, refEl) {
    const td = document.createElement('td');
    td.className   = cls;
    td.textContent = text;
    row.insertBefore(td, refEl);
    return td;
  }
}
