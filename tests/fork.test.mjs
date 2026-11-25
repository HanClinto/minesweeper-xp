// Tests for this fork's changes to the engine (CHANGES.md): the field shown sideways, and the hooks the page uses.
//   node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Minesweeper, MINE, REVEALED } from '../js/winmine.js';

globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};

// A canvas that records where each 16 x 16 square is drawn
function recordingCanvas() {
  const blits = [];
  return {
    blits, width: 0, height: 0,
    getContext: () => new Proxy({}, {
      get: (_, name) => (name === 'drawImage'
        ? (img, sx, sy, sw, sh, dx, dy) => { if (sw === 16) blits.push([dx, dy]); }
        : () => {}),
      set: () => true,
    }),
  };
}

function makeGame(overrides = {}) {
  const events = { resized: [], started: 0, over: [], wins: [] };
  const canvas = recordingCanvas();
  const prefs = { difficulty: 2, height: 16, width: 30, mines: 99, mark: 1, sound: 0, color: 1,
                  times: [999, 999, 999], names: ['', '', ''], ...overrides };
  const g = new Minesweeper(canvas, { color: {}, mono: {} }, prefs, {
    sound: () => {},
    resized: (w, h) => events.resized.push([w, h]),
    won: (lvl, t) => events.wins.push([lvl, t]),
    started: () => events.started++,
    over: (win) => events.over.push(win),
  });
  g.newGame();
  return { g, events, canvas };
}

function layMines(g, coords) {
  for (let y = 1; y <= g.height; y++)
    for (let x = 1; x <= g.width; x++) g.board[y * 32 + x] &= ~MINE;
  for (const [x, y] of coords) g.board[y * 32 + x] |= MINE;
  g.prefs.mines = coords.length;
  g.minesLeft = coords.length;
  g.toReveal = g.width * g.height - coords.length;
}

// The centre of a square in client pixels, as drawn: (x, y) is the board's square, shown at (y, x) when sideways
const at = (g, x, y) => {
  const [dx, dy] = g.transposed ? [y, x] : [x, y];
  return [(dx << 4) - 4 + 8, (dy << 4) + 39 + 8];
};
const click = (g, x, y) => { g.leftDown(...at(g, x, y), false); g.up(...at(g, x, y)); };

test('sideways: the client area swaps to the field as shown, and back', () => {
  const { g, events } = makeGame();
  assert.deepEqual([g.canvas.width, g.canvas.height], [30 * 16 + 24, 16 * 16 + 67]);
  g.setTransposed(true);
  assert.deepEqual([g.canvas.width, g.canvas.height], [16 * 16 + 24, 30 * 16 + 67]);
  assert.deepEqual(events.resized.at(-1), [16 * 16 + 24, 30 * 16 + 67]);
  assert.equal(g.width, 30, 'the board itself is unchanged');
  g.setTransposed(false);
  assert.deepEqual([g.canvas.width, g.canvas.height], [30 * 16 + 24, 16 * 16 + 67]);
});

test('sideways: a new game keeps the sideways client area', () => {
  const { g } = makeGame();
  g.setTransposed(true);
  g.newGame();
  assert.deepEqual([g.canvas.width, g.canvas.height], [16 * 16 + 24, 30 * 16 + 67]);
});

test('sideways: squares are drawn with rows and columns swapped', () => {
  const { g, canvas } = makeGame();
  g.setTransposed(true);
  canvas.blits.length = 0;
  g.drawBlk(5, 2);
  assert.deepEqual(canvas.blits, [[(2 << 4) - 4, (5 << 4) + 39]]);
});

test('sideways: clicks map back to the same square of the board', () => {
  const { g } = makeGame();
  layMines(g, [[30, 16]]);
  g.setTransposed(true);
  click(g, 3, 7);
  assert.ok(g.cell(3, 7) & REVEALED);
  assert.deepEqual(g.cellAt(...at(g, 30, 1)), [30, 1]);
  // the same play gives the same board either way round
  const { g: h } = makeGame();
  layMines(h, [[30, 16]]);
  click(h, 3, 7);
  assert.deepEqual(Array.from(g.board), Array.from(h.board));
});

test('sideways: flags and chords land on the square under the finger', () => {
  const { g } = makeGame({ height: 9, width: 9, mines: 10, difficulty: 0 });
  layMines(g, [[1, 1]]);
  g.setTransposed(true);
  click(g, 2, 2);   // a 1: opens just itself
  assert.ok(g.cell(2, 2) & REVEALED);
  assert.ok(!(g.cell(2, 1) & REVEALED));
  g.rightDown(...at(g, 1, 1), false);
  assert.equal(g.minesLeft, 0);
  assert.equal(g.flagsPlaced, 1);
  g.tap(...at(g, 2, 2));   // its mine is flagged: opens what's around it
  assert.ok(g.cell(2, 1) & REVEALED);
});

test('hooks: started on the first click, over with the result, flags counted per game', () => {
  const { g, events } = makeGame({ height: 9, width: 9, mines: 10, difficulty: 0 });
  layMines(g, [[1, 1]]);
  g.rightDown(...at(g, 9, 9), false);
  g.rightDown(...at(g, 9, 9), false);   // a flag, then a ?
  assert.equal(g.flagsPlaced, 1);
  click(g, 5, 5);   // opens everything: a win
  assert.equal(events.started, 1);
  assert.deepEqual(events.over, [true]);
  assert.deepEqual(events.wins, [[0, 1]]);
  g.newGame();
  assert.equal(g.flagsPlaced, 0);
  layMines(g, [[1, 1]]);
  click(g, 2, 2);
  click(g, 1, 1);   // a mine: a loss
  assert.deepEqual(events.over, [true, false]);
  assert.equal(events.started, 2);
});
