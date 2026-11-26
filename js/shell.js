// Window chrome, menus, dialogs and input for the WINMINE.EXE port.
// [fork] Here the game fills a page with a top bar (index.html) instead of a window on an XP desktop: it's drawn as
// large as fits, in whole pixels, sideways when that makes it bigger, and each finished game can go to a score
// service. CHANGES.md lists what changed.
import { Minesweeper, REVEALED, LEVELS, CUSTOM, SOUND_TICK, SOUND_WIN, SOUND_LOSE, clientWidth, clientHeight } from './winmine.js';
import { ScoresApi, Outbox, newId } from './scores.js';

// String table (RT_STRING block 1).
const STR = {
  title: 'Minesweeper',
  seconds: '%d seconds',
  anonymous: 'Anonymous',
  fastest: [
    'You have the fastest time\nfor beginner level.\nPlease enter your name.',
    'You have the fastest time\nfor intermediate level.\nPlease enter your name.',
    'You have the fastest time\nfor expert level.\nPlease enter your name.',
  ],
  credits: 'by Robert Donner and Curt Johnson',
};

// ---- preferences (registry values in HKCU\Software\Microsoft\winmine) ------

const STORAGE_KEY = 'winmine';
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function loadPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { /* private mode or corrupt data: use defaults */ }
  // Defaults and ranges from sub_1002bc2.
  const num = (k, def, lo, hi) => (Number.isInteger(saved[k]) ? clamp(saved[k], lo, hi) : def);
  const name = (k) => (typeof saved[k] === 'string' ? saved[k].slice(0, 32) : STR.anonymous);
  return {
    difficulty: num('difficulty', 0, 0, 3),
    height: num('height', 9, 9, 25),
    width: num('width', 9, 9, 30),
    mines: num('mines', 10, 10, 999),
    mark: num('mark', 1, 0, 1),
    sound: num('sound', 0, 0, 1),
    color: num('color', 1, 0, 1),
    times: [num('time1', 999, 0, 999), num('time2', 999, 0, 999), num('time3', 999, 0, 999)],
    names: [name('name1'), name('name2'), name('name3')],
  };
}

function savePrefs(p) {
  const data = {
    difficulty: p.difficulty, height: p.height, width: p.width, mines: p.mines,
    mark: p.mark, sound: p.sound, color: p.color,
    time1: p.times[0], time2: p.times[1], time3: p.times[2],
    name1: p.names[0], name2: p.names[1], name3: p.names[2],
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// ---- assets ----------------------------------------------------------------

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

async function loadSprites() {
  const names = ['blocks', 'led', 'faces'];
  const [color, mono] = await Promise.all(['', '_mono'].map(async (suffix) => {
    const imgs = await Promise.all(names.map((n) => loadImage(`assets/${n}${suffix}.png`)));
    return Object.fromEntries(names.map((n, i) => [n, imgs[i]]));
  }));
  return { color, mono };
}

const sounds = {
  [SOUND_TICK]: new Audio('assets/tick.wav'),
  [SOUND_WIN]: new Audio('assets/win.wav'),
  [SOUND_LOSE]: new Audio('assets/lose.wav'),
};
function playSound(id) {
  // PlaySound(..., SND_ASYNC | SND_RESOURCE): a new sound cuts off the previous one.
  for (const a of Object.values(sounds)) a.pause();
  const a = sounds[id];
  a.currentTime = 0;
  a.play().catch(() => {});
}

// ---- elements --------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const win = $('#window');
const canvas = $('#board');   // [fork] what's shown; the engine draws on `client`
const stage = $('#stage');
const cheatPixel = $('#cheat-pixel');
const cfg = document.body.dataset;

const prefs = loadPrefs();
let game;

// ---- [fork] drawing and layout ----------------------------------------------
// The engine draws the client area at its original size, on a canvas of its own. The page shows that on #board as
// large as fits: in whole device pixels when that costs little (crisp, like the original at 2x or 3x), otherwise
// "sharp bilinear", which scales up in whole pixels and smooths only the last step down, so just the edges of the
// pixels blend. A wide field on a tall screen is shown sideways (the engine's setTransposed), when that makes the
// squares clearly bigger.

const client = document.createElement('canvas');
client.width = canvas.width;
client.height = canvas.height;
const view = canvas.getContext('2d');
let sharp = null;
let fit = 1;            // CSS pixels per client-area pixel
const MAX_FIT = 4;      // a Beginner field on a big monitor needn't fill it
let dirty = false;

{
  const ctx = client.getContext('2d');
  for (const m of ['drawImage', 'fillRect']) {
    const f = ctx[m].bind(ctx);
    ctx[m] = (...args) => { f(...args); invalidate(); };
  }
}

function invalidate() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(present);
}

function present() {
  dirty = false;
  const dpr = window.devicePixelRatio || 1;
  let s = fit * dpr;
  const k = Math.floor(s);
  if (k >= 1 && (k / s >= 0.92 || dpr < 1.5)) s = k;
  const w = Math.round(client.width * s), h = Math.round(client.height * s);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w / dpr}px`;
    canvas.style.height = `${h / dpr}px`;
  }
  if (Number.isInteger(s)) {
    view.imageSmoothingEnabled = false;
    view.drawImage(client, 0, 0, w, h);
  } else {
    const n = Math.max(1, Math.ceil(s));
    sharp ??= document.createElement('canvas');
    if (sharp.width !== client.width * n || sharp.height !== client.height * n) {
      sharp.width = client.width * n;
      sharp.height = client.height * n;
    }
    const sc = sharp.getContext('2d');
    sc.imageSmoothingEnabled = false;
    sc.drawImage(client, 0, 0, sharp.width, sharp.height);
    view.imageSmoothingEnabled = true;
    view.imageSmoothingQuality = 'high';
    view.drawImage(sharp, 0, 0, w, h);
  }
}

function layout() {
  if (!game || !game.width) return;
  const pad = Math.min(stage.clientWidth, stage.clientHeight) < 500 ? 4 : 12;
  const chromeW = win.offsetWidth - canvas.offsetWidth, chromeH = win.offsetHeight - canvas.offsetHeight;
  const availW = stage.clientWidth - 2 * pad - chromeW, availH = stage.clientHeight - 2 * pad - chromeH;
  const fitFor = (cols, rows) => Math.min(availW / clientWidth(cols), availH / clientHeight(rows));
  const across = fitFor(game.width, game.height), sideways = fitFor(game.height, game.width);
  const turn = game.transposed ? !(across > sideways * 1.15) : sideways > across * 1.15;
  if (turn !== game.transposed) {
    game.setTransposed(turn);   // calls back here through resized()
    return;
  }
  fit = Math.max(0.25, Math.min(turn ? sideways : across, MAX_FIT));
  present();
  snap();
}

// Centring can leave the board between device pixels, which would blur it again: nudge it onto the pixel grid.
function snap() {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.transform = '';
  const r = canvas.getBoundingClientRect();
  const dx = (Math.round(r.left * dpr) - r.left * dpr) / dpr, dy = (Math.round(r.top * dpr) - r.top * dpr) / dpr;
  if (dx || dy) canvas.style.transform = `translate(${dx}px, ${dy}px)`;
}

new ResizeObserver(() => layout()).observe(stage);

function makeDraggable(frame, handle, onMove) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = frame.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      frame.style.left = `${clamp(ev.clientX - dx, -r.width + 60, window.innerWidth - 60)}px`;
      frame.style.top = `${clamp(ev.clientY - dy, 0, window.innerHeight - 50)}px`;
      onMove?.();
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
}

function setActive(active) {
  win.classList.toggle('inactive', !active);
}

function exitGame() {
  closeMenus();
  if (cfg.back) location.href = cfg.back;
  else if (history.length > 1) history.back();
}

document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) {
    game.pause();
    pauseClock();
  } else {
    game.resume();
    resumeClock();
  }
});

// ---- menus -----------------------------------------------------------------

const menuBar = $('.menu-bar', win);
let openMenu = null;

function closeMenus() {
  if (!openMenu) return;
  openMenu.classList.remove('open');
  openMenu = null;
}

function showMenu(item) {
  if (openMenu === item) return;
  closeMenus();
  item.classList.add('open');
  openMenu = item;
}

for (const item of menuBar.querySelectorAll('.menu')) {
  const label = $('.menu-label', item);
  label.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (openMenu === item) closeMenus();
    else showMenu(item);
  });
  label.addEventListener('pointerenter', () => { if (openMenu) showMenu(item); });
}

document.addEventListener('pointerdown', (e) => {
  if (openMenu && !e.target.closest('.menu')) closeMenus();
});

function updateMenus() {   // sub_1001516
  for (const el of menuBar.querySelectorAll('[data-level]'))
    el.classList.toggle('checked', Number(el.dataset.level) === prefs.difficulty);
  $('[data-cmd="marks"]').classList.toggle('checked', !!prefs.mark);
  $('[data-cmd="color"]').classList.toggle('checked', !!prefs.color);
  $('[data-cmd="sound"]').classList.toggle('checked', !!prefs.sound);
}

const commands = {
  new: () => game.newGame(),
  level: (el) => {   // menu ids 0x209..0x20b
    const lvl = Number(el.dataset.level);
    if (lvl === CUSTOM) return customDialog();
    prefs.difficulty = lvl;
    [prefs.mines, prefs.height, prefs.width] = LEVELS[lvl];
    savePrefs(prefs);
    updateMenus();
    game.newGame();
  },
  marks: () => { prefs.mark ^= 1; savePrefs(prefs); updateMenus(); },
  color: () => { prefs.color ^= 1; savePrefs(prefs); updateMenus(); game.paint(); },
  sound: () => { prefs.sound ^= 1; savePrefs(prefs); updateMenus(); },
  best: () => bestTimesDialog(),
  exit: () => exitGame(),
  help: () => helpDialog('mine_object'),
  search: () => helpDialog('mine_play'),
  usinghelp: () => helpDialog('using_help'),
  about: () => aboutDialog(),
};

menuBar.addEventListener('click', (e) => {
  const el = e.target.closest('[data-cmd]');
  if (!el) return;
  closeMenus();
  commands[el.dataset.cmd](el);
});

// ---- dialogs ---------------------------------------------------------------

const dialogLayer = $('#dialogs');

function openDialog({ title, body, buttons, className = '', onClose }) {
  closeMenus();
  const frame = document.createElement('div');
  frame.className = `xp-window dialog ${className}`;
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-modal', 'true');
  frame.innerHTML = `
    <div class="title-bar"><span class="title-text"></span>
      <div class="title-controls"><button class="ctl close" aria-label="Close"></button></div>
    </div>
    <div class="dialog-body"></div>`;
  $('.title-text', frame).textContent = title;
  if (!title) frame.classList.add('untitled');
  $('.dialog-body', frame).append(body);

  const layer = document.createElement('div');
  layer.className = 'modal';
  layer.append(frame);
  dialogLayer.append(layer);
  setActive(false);

  const close = (result) => {
    layer.remove();
    if (!dialogLayer.children.length) setActive(true);
    onClose?.(result);
  };
  $('.ctl.close', frame).addEventListener('click', () => close(null));
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(null); }
  });
  if (buttons) {
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    for (const [label, handler, isDefault] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      if (isDefault) b.classList.add('default');
      b.addEventListener('click', () => handler(close));
      row.append(b);
    }
    $('.dialog-body', frame).append(row);
    frame.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        row.querySelector('.default')?.click();
      }
    });
  }

  const r = frame.getBoundingClientRect();
  const wr = win.getBoundingClientRect();
  frame.style.left = `${clamp(wr.left + (wr.width - r.width) / 2, 0, Math.max(0, window.innerWidth - r.width))}px`;
  frame.style.top = `${clamp(wr.top + (wr.height - r.height) / 2, 0, Math.max(0, window.innerHeight - r.height))}px`;
  makeDraggable(frame, $('.title-bar', frame));
  (frame.querySelector('input') || frame.querySelector('.default') || frame).focus();
  return close;
}

const h = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
};

// Custom Field (dialog 80, handler sub_10015a6; caller sub_1001b49).
function customDialog() {
  const field = (label, value) => {
    const input = h('input', { type: 'text', inputMode: 'numeric', value: String(value), maxLength: 3 });
    return [h('label', {}, label, input), input];
  };
  const [hl, hi] = field('Height:', prefs.height);
  const [wl, wi] = field('Width:', prefs.width);
  const [ml, mi] = field('Mines:', prefs.mines);
  const body = h('div', { className: 'custom-fields' }, hl, wl, ml);
  // GetDlgItemInt returns 0 for non-numeric text, which the clamp then raises to the minimum.
  const read = (input, lo, hi) => clamp(/^\s*\d+\s*$/.test(input.value) ? parseInt(input.value, 10) : 0, lo, hi);
  const finish = () => {
    // The original switches to Custom and starts a new game even when cancelled.
    prefs.difficulty = CUSTOM;
    savePrefs(prefs);
    updateMenus();
    game.newGame();
  };
  openDialog({
    title: 'Custom Field',
    body,
    className: 'custom-dialog',
    buttons: [
      ['OK', (close) => {
        prefs.height = read(hi, 9, 24);
        prefs.width = read(wi, 9, 30);
        prefs.mines = read(mi, 10, Math.min(999, (prefs.height - 1) * (prefs.width - 1)));
        close(true);
      }, true],
      ['Cancel', (close) => close(false)],
    ],
    onClose: finish,
  });
}

// Fastest Mine Sweepers (dialog 700, handler sub_10016fa).
// [fork] With a score service it shows the family's fastest on each level, and your own best, instead of this
// browser's.
function bestTimesDialog() {
  if (family) return familyBestDialog();
  localBestDialog();
}

function familyBestDialog() {
  const rows = ['Beginner:', 'Intermediate:', 'Expert:'].map((label) => {
    const time = h('span', { className: 'time', textContent: '…' });
    const name = h('span', { className: 'name' });
    return [h('div', { className: 'best-row' }, h('span', { className: 'level' }, label), time, name), time, name];
  });
  const note = h('p', { className: 'note', textContent: `The ${family.label.toLowerCase()}'s fastest.` });
  const body = h('div', { className: 'best-times' }, h('fieldset', {}, ...rows.map(([row]) => row)), note);
  const buttons = [['OK', (close) => close(true), true]];
  if (cfg.leaderboard) buttons.unshift(['Leaderboard', () => { location.href = cfg.leaderboard; }]);
  openDialog({ title: 'Fastest Mine Sweepers', body, className: 'best-dialog', buttons });
  Promise.all([0, 1, 2].map((lvl) => family.board(lvl, 1))).then((boards) => {
    const mine = [];
    boards.forEach((b, i) => {
      const [, time, name] = rows[i];
      const top = b.entries?.[0];
      time.textContent = top ? STR.seconds.replace('%d', top.seconds) : '—';
      name.textContent = top ? top.name : 'Nobody yet';
      if (b.my_best != null) mine.push(`${LEVEL_NAMES[i]} ${b.my_best}`);
    });
    if (mine.length) note.textContent += ` Yours: ${mine.join(', ')}.`;
  }, () => {
    note.textContent = 'The family board can\'t be reached right now.';
    rows.forEach(([, time, name], i) => {
      time.textContent = STR.seconds.replace('%d', prefs.times[i]);
      name.textContent = prefs.names[i];
    });
  });
}

function localBestDialog() {
  const rows = ['Beginner:', 'Intermediate:', 'Expert:'].map((label, i) => {
    const time = h('span', { className: 'time' });
    const name = h('span', { className: 'name' });
    return [h('div', { className: 'best-row' }, h('span', { className: 'level' }, label), time, name), time, name];
  });
  const refresh = () => rows.forEach(([, time, name], i) => {
    time.textContent = STR.seconds.replace('%d', prefs.times[i]);
    name.textContent = prefs.names[i];
  });
  refresh();
  const reset = h('button', { textContent: 'Reset Scores' });
  reset.addEventListener('click', () => {
    prefs.times = [999, 999, 999];
    prefs.names = [STR.anonymous, STR.anonymous, STR.anonymous];
    savePrefs(prefs);
    refresh();
  });
  const body = h('div', { className: 'best-times' },
    h('fieldset', {}, ...rows.map(([row]) => row)));
  openDialog({
    title: 'Fastest Mine Sweepers',
    body,
    className: 'best-dialog',
    buttons: [['OK', (close) => close(true), true]],
  });
  $('.best-dialog .dialog-buttons').prepend(reset);
}

// Name entry (dialog 600, handler sub_100181f), shown after a record time.
function nameDialog(level, then) {
  const input = h('input', { type: 'text', maxLength: 32, value: prefs.names[level] });
  const body = h('div', { className: 'name-entry' }, h('p', { textContent: STR.fastest[level] }), input);
  openDialog({
    title: '',
    body,
    className: 'name-dialog',
    buttons: [['OK', (close) => close(true), true]],
    onClose: () => {
      prefs.names[level] = input.value.slice(0, 32);
      savePrefs(prefs);
      then();
    },
  });
  input.select();
}

function aboutDialog() {   // sub_1003d1d -> ShellAbout
  const body = h('div', { className: 'about' },
    h('img', { src: 'assets/icon48.png', alt: '', width: 48, height: 48 }),
    h('div', {},
      h('p', {}, h('b', { textContent: STR.title })),
      h('p', { textContent: STR.credits }),
      h('hr'),
      h('p', { className: 'port-note', innerHTML: 'Browser port reverse-engineered from the original <code>WINMINE.EXE</code>. <a href="https://github.com/Ozdotdotdot/minesweeper-xp" target="_blank" rel="noopener">Source on GitHub</a>.' })));
  openDialog({ title: `About ${STR.title}`, body, className: 'about-dialog', buttons: [['OK', (close) => close(true), true]] });
}

// Help viewer, content recovered from WINMINE.CHM.
const HELP = {
  mine_object: ['Minesweeper overview', `
    <h1>Minesweeper overview</h1>
    <p>The object of Minesweeper is to locate all the mines as quickly as possible without uncovering any of them. If you uncover a mine, you lose the game.</p>`],
  mine_play: ['Play Minesweeper', `
    <p class="proclabel">To play Minesweeper</p>
    <ol><li>On the <b>Game</b> menu, click <b>New</b>.</li>
    <li>To start the timer, click any square on the playing field.</li></ol>
    <p class="note">Notes</p>
    <ul><li>You can uncover a square by clicking it. If you uncover a mine, you lose the game.</li>
    <li>If a number appears on a square, it indicates how many mines are in the eight squares that surround the numbered one.</li>
    <li>To mark a square you suspect contains a mine, right-click it.</li>
    <li>The game area consists of the playing field, a mine counter, and a timer.</li></ul>`],
  mine_customize_field: ['Customize the playing field', `
    <p class="proclabel">To customize the playing field</p>
    <ol><li>On the <b>Game</b> menu, click <b>Custom</b>.</li>
    <li>Customize the size of the field by specifying the number of squares to display vertically and horizontally, and specify the number of mines to place on the field.</li></ol>`],
  mine_tips: ['Strategies and tips', `
    <h1>Strategies and tips</h1>
    <ul><li>If you are uncertain about a square, right-click it twice to mark it with a question mark (?). Later, you can either mark the square as a mine or remove the markings by right-clicking the square again once or twice.</li>
    <li>If you have marked all the mines around a numbered square, you can uncover the remaining squares around it by clicking the numbered square with the left and right mouse buttons simultaneously. If not all mines surrounding the numbered square have been marked, the remaining covered or unmarked squares will appear to be depressed (or flash) when the numbered square is clicked with both buttons simultaneously.</li>
    <li>Look for common patterns in numbers, which often indicate a corresponding pattern of mines. For example, the pattern 2-3-2 at the edge of a group of uncovered squares indicates a row of three mines next to the three numbers.</li></ul>`],
  using_help: ['Using the Help Viewer', `
    <h1>Using the Help Viewer</h1>
    <p>The Help viewer topics live in <code>nthelp.chm</code>, a shared Windows help file that was not part of this archive.</p>
    <p>Choose a topic on the left to read the Minesweeper help.</p>`],
  browser: ['Playing in the browser', `
    <h1>Playing in the browser</h1>
    <ul><li><b>Chord</b> (open the squares around a number): press both mouse buttons, the middle button, or Shift+click.</li>
    <li>Keys for the square under the mouse: <b>Space</b> uncovers it, as a click does; <b>Z</b> marks it, as a right-click does; <b>X</b> chords it, as Shift+click does.</li>
    <li><b>Touch screens</b>: tap to uncover, press and hold to mark, double-tap a number to chord it.</li>
    <li><b>F2</b> starts a new game. Best times and settings are stored in this browser.</li></ul>`],
};

function helpDialog(topic) {
  const toc = h('ul', { className: 'help-toc' });
  const content = h('div', { className: 'help-content' });
  const show = (key) => {
    content.innerHTML = HELP[key][1];
    for (const li of toc.querySelectorAll('.page')) li.classList.toggle('selected', li.dataset.topic === key);
  };
  const book = (label, keys) => h('li', { className: 'book' }, h('span', { textContent: label }),
    h('ul', {}, ...keys.map((k) => {
      const li = h('li', { className: 'page', textContent: HELP[k][0] });
      li.dataset.topic = k;
      li.addEventListener('click', () => show(k));
      return li;
    })));
  toc.append(
    book('Minesweeper', ['mine_object', 'mine_play', 'mine_customize_field', 'mine_tips', 'browser']),
    book('Using the Help Viewer', ['using_help']));
  openDialog({ title: 'Minesweeper Help', body: h('div', { className: 'help-viewer' }, toc, content), className: 'help-dialog' });
  show(topic);
}

// ---- board input -----------------------------------------------------------

function boardPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) * client.width / r.width),   // [fork] the engine's client area
          Math.floor((e.clientY - r.top) * client.height / r.height)];
}

const modalOpen = () => dialogLayer.children.length > 0;

let mouseCaptured = false;
canvas.addEventListener('mousedown', (e) => {
  if (modalOpen()) return;
  e.preventDefault();
  closeMenus();
  const [px, py] = boardPoint(e);
  if (e.button === 0) {
    // MK_RBUTTON | MK_SHIFT start a chord (0x1001fca).
    if (game.leftDown(px, py, (e.buttons & 2) !== 0 || e.shiftKey)) mouseCaptured = true;
  } else if (e.button === 2) {
    game.rightDown(px, py, (e.buttons & 1) !== 0);
    if (game.tracking) mouseCaptured = true;
  } else if (e.button === 1) {
    game.middleDown(px, py);
    if (game.tracking) mouseCaptured = true;
  }
});

window.addEventListener('mousemove', (e) => {
  const [px, py] = boardPoint(e);
  if (mouseCaptured) game.move(px, py);
  updateCheat(px, py, e.ctrlKey);
});

// [fork] Where the mouse is over the field, for the keys that act there (Space, Z, X).
let mouseAt = null;
canvas.addEventListener('mousemove', (e) => { mouseAt = boardPoint(e); });
canvas.addEventListener('mouseleave', () => { mouseAt = null; });

window.addEventListener('mouseup', (e) => {
  if (!mouseCaptured) return;
  mouseCaptured = false;
  const [px, py] = boardPoint(e);
  game.up(px, py);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('auxclick', (e) => e.preventDefault());

// Touch: tap to uncover, long-press to mark, [fork] double tap to chord (Shift+click).
const LONG_PRESS_MS = 400;
const DOUBLE_TAP_MS = 300;   // [fork] from the first tap's lift to the second's touch
let touch = null;
let lastTap = null;   // [fork] { x, y, at, open }: the square of the last tap, and whether it was already open
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || modalOpen()) return;
  e.preventDefault();   // suppress the compatibility mouse events
  closeMenus();
  const [px, py] = boardPoint(e);
  if (game.inFace(px, py)) {
    game.leftDown(px, py, false);
    touch = { id: e.pointerId, face: true };
    return;
  }
  touch = { id: e.pointerId, px, py, down: e.timeStamp, timer: setTimeout(() => {
    if (!touch) return;
    touch.flagged = true;
    const [x, y] = game.cellAt(touch.px, touch.py);   // [fork] sideways too
    if (game.playing) {
      game.cycleMark(x, y);
      navigator.vibrate?.(15);
    }
  }, LONG_PRESS_MS) };
});
canvas.addEventListener('pointermove', (e) => {
  if (!touch || touch.id !== e.pointerId || touch.face) return;
  const [px, py] = boardPoint(e);
  if (Math.abs(px - touch.px) > 8 || Math.abs(py - touch.py) > 8) {
    clearTimeout(touch.timer);
    touch = null;
  }
});
const endTouch = (e) => {
  if (!touch || touch.id !== e.pointerId) return;
  const t = touch;
  touch = null;
  const [px, py] = boardPoint(e);
  if (t.face) {
    game.up(px, py);
    return;
  }
  clearTimeout(t.timer);
  if (t.flagged || e.type !== 'pointerup') {
    lastTap = null;
    return;
  }
  // [fork] A second tap on the same open square chords it. A square the first tap uncovered isn't chorded, as
  // Shift+click on a covered square does nothing.
  const [x, y] = game.cellAt(t.px, t.py);
  const open = game.inRange(x, y) && (game.cell(x, y) & REVEALED) !== 0;
  const second = lastTap && lastTap.x === x && lastTap.y === y && lastTap.open && t.down - lastTap.at < DOUBLE_TAP_MS;
  game.tap(t.px, t.py, !!second);
  lastTap = second ? null : { x, y, at: e.timeStamp, open };
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);

// ---- keyboard: accelerators and the XYZZY cheat (WM_KEYDOWN, 0x1001c9a) ----

const XYZZY = 'XYZZY';
let xyzzy = 0;   // 0x1005154: 0..5 while typing, 5 = armed, 0x11 = always on

function updateCheat(px, py, ctrl) {
  if (xyzzy !== 0x11 && !(xyzzy === 5 && ctrl)) {
    cheatPixel.hidden = true;
    return;
  }
  const mine = game.mineAt(px, py);
  if (mine === null) return;   // the original leaves the pixel as it was
  if (game.playing) cheated = true;   // [fork] such a game doesn't go on the boards
  cheatPixel.hidden = false;
  cheatPixel.style.background = mine ? '#000' : '#fff';
}

// [fork] Keys for the square under the mouse: Space is a click there, Z a right-click, X a Shift+click. Space and X
// are held like the button: down presses the square (X: the squares around it), up uncovers (X: clears around the
// number). Z and X are also in XYZZY: they still count toward it, and act only when the mouse is over the field.
let keyHeld = null;   // ' ' or 'x' while one is pressing the field
function boardKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('button, a, input, select, textarea')) return false;
  const k = e.key.toLowerCase();
  if (k !== ' ' && k !== 'z' && k !== 'x') return false;
  if (k === ' ') e.preventDefault();   // no scrolling
  if (e.repeat || !mouseAt || mouseCaptured) return k === ' ';
  e.preventDefault();
  closeMenus();
  if (k === ' ' || k === 'x') {
    if (game.leftDown(...mouseAt, k === 'x' || e.shiftKey)) {
      mouseCaptured = true;
      keyHeld = k;
    }
  } else {
    game.rightDown(...mouseAt, false);
  }
  return k === ' ';
}
document.addEventListener('keyup', (e) => {
  if (!keyHeld || e.key.toLowerCase() !== keyHeld) return;
  keyHeld = null;
  mouseCaptured = false;
  game.up(...(mouseAt || [-1, -1]));
});
window.addEventListener('mouseup', () => { keyHeld = null; });   // a mouse button let go ends it too

document.addEventListener('keydown', (e) => {
  if (modalOpen()) return;
  if (boardKey(e)) return;   // Space: nothing else to do; Z and X go on to the cheat
  if (e.key === 'F2') {
    e.preventDefault();
    game.newGame();
  } else if (e.key === 'F1') {
    e.preventDefault();
    helpDialog('mine_object');
  } else if (e.key === 'Escape') {
    closeMenus();
  } else if (e.key === 'Shift') {
    if (xyzzy >= 5) xyzzy ^= 0x14;
  } else if (xyzzy < 5 && e.key.length === 1) {
    xyzzy = e.key.toUpperCase() === XYZZY[xyzzy] ? xyzzy + 1 : 0;
  }
});

// ---- [fork] the top bar, How to play ------------------------------------------

function link(id, href, label) {
  const a = $(`#${id}`);
  if (!href) return;
  a.href = href;
  if (label) a.textContent = label;
  a.hidden = false;
}
link('back', cfg.back, cfg.backLabel && `‹ ${cfg.backLabel}`);
link('leaderboard', cfg.leaderboard);
link('home', cfg.home, cfg.homeLabel);

const statusEl = $('#status');
let statusTimer = 0;
function status(text, kind, ms) {
  statusEl.textContent = text || '';
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
  clearTimeout(statusTimer);
  if (ms) statusTimer = setTimeout(() => status(idleStatus()), ms);
}

$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else stage.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
});
if (!document.fullscreenEnabled) $('#fullscreen').disabled = true;

const help = $('#help');
function toggleHelp(show) {
  help.hidden = show === undefined ? !help.hidden : !show;
}
$('#howto').addEventListener('click', () => toggleHelp());
help.addEventListener('click', (e) => { if (e.target === help || e.target.closest('.close')) toggleHelp(false); });
try {
  if (!localStorage.getItem('winmine.helped')) {
    toggleHelp(true);
    localStorage.setItem('winmine.helped', '1');
  }
} catch { /* storage blocked */ }
// Clicking the top bar mustn't leave a button holding Space or Enter
for (const b of document.querySelectorAll('.bar button')) b.addEventListener('mouseup', () => b.blur());

// ---- [fork] scores ------------------------------------------------------------
// Each finished game (won or lost, from the first click) goes to the score service as it ends, under the signed-in
// name. One that can't be sent waits in this browser and goes later.

const LEVEL_NAMES = ['Beginner', 'Intermediate', 'Expert', 'Custom'];
const family = cfg.scoresApi ? ScoresApi(cfg.scoresApi, { label: cfg.scoresLabel || 'Family' }) : null;
const outbox = Outbox();
let player = '';
let cheated = false;

// Time actually played, without a hidden tab's: for ties at the same second
let playMs = 0, clockFrom = 0;
function pauseClock() { if (clockFrom) { playMs += performance.now() - clockFrom; clockFrom = 0; } }
function resumeClock() { if (inGame && !document.hidden) clockFrom = performance.now(); }
let inGame = false;

function idleStatus() {
  const pending = outbox.list().length;
  if (pending) return `${pending} game${pending > 1 ? 's' : ''} waiting to be sent`;
  if (family && player) return `Playing as ${player}`;
  return '';
}

if (family) {
  $('.scores-note').hidden = false;
  family.me().then((me) => { player = me.name || ''; status(idleStatus()); }, () => { /* signed out */ });
}

let sending = false;
async function flush() {
  if (!family || sending) return;
  const list = outbox.list();
  if (!list.length) return;
  sending = true;
  const g = list[0];
  try {
    const result = await family.submit(g);
    outbox.remove(g.game_id);
    sending = false;
    if (!g.late) showResult(g, result);
    else status(idleStatus());
    flush();
  } catch (err) {
    sending = false;
    if (err && err.status >= 400 && err.status < 500 && ![401, 403, 429].includes(err.status)) {
      outbox.remove(g.game_id);   // the service won't take it (malformed): don't keep trying
      status(`The score service turned the game down: ${err.message}`, 'warn', 8000);
    } else {
      status(`${idleStatus()} (no connection to the score service)`, 'warn');
    }
  }
}
window.addEventListener('online', flush);
setInterval(flush, 60000);
for (const g of outbox.list()) g.late = true;   // games from an earlier visit go quietly (no card)
setTimeout(flush, 2000);

function gameStarted() {
  inGame = true;
  playMs = 0;
  clockFrom = 0;
  resumeClock();
  cheated = xyzzy === 0x11;
  hideCard();
}

function gameOver(won) {
  pauseClock();
  inGame = false;
  if (!family) return;
  outbox.add({
    game_id: newId(), level: prefs.difficulty, width: game.width, height: game.height, mines: prefs.mines,
    won, seconds: game.timer, ms: Math.round(playMs), opened: game.revealed, toOpen: game.toReveal,
    flags: game.flagsPlaced, xyzzy: cheated, date: Math.floor(Date.now() / 1000),
  });
  flush();
}

const card = $('#card');
let cardTimer = 0;
function showResult(g, r) {
  const unlocked = (r.unlocked || []).slice().reverse();   // the hardest first
  const level = LEVEL_NAMES[g.level];
  const secs = (n) => `${n} second${n === 1 ? '' : 's'}`;
  const lines = [];
  if (g.won && g.level !== CUSTOM && !g.xyzzy) {
    if (r.new_best && r.previous_best != null) lines.push(`<b>New personal best on ${level}: ${secs(g.seconds)}!</b>`);
    else if (r.new_best) lines.push(`<b>Your first win on ${level}: ${secs(g.seconds)}.</b>`);
    else lines.push(`${level} in ${secs(g.seconds)}${r.best != null ? ` (your best: ${r.best})` : ''}.`);
    if (r.passed?.length) lines.push(`You passed ${esc(listOf(r.passed))}.`);
    if (r.rank && r.players > 1) lines.push(`#${r.rank} of ${r.players} in the ${esc(family.label.toLowerCase())}.`);
  } else if (g.won) {
    lines.push(`Cleared in ${secs(g.seconds)}.`);
  }
  if (!lines.length && !unlocked.length) {
    status(idleStatus());
    return;
  }
  let html = lines.length ? `<div class="card-head">${lines.join(' ')}</div>` : '';
  unlocked.slice(0, 3).forEach((a, i) => {
    html += `<div class="unlock"${!lines.length && !i ? ' style="margin-top:0;padding-top:0;border-top:0"' : ''}>` +
      `<span class="icon">${esc(a.icon || '🏆')}</span><span><b>${esc(a.title)}</b><br>${esc(a.text || '')}</span></div>`;
  });
  if (unlocked.length > 3) {
    const more = unlocked.length - 3;
    html += `<div class="unlock more">and ${more} more achievement${more > 1 ? 's' : ''}` +
      `${cfg.leaderboard ? ` (<a href="${esc(cfg.leaderboard)}" target="_blank">see them all</a>)` : ''}</div>`;
  }
  card.innerHTML = html;
  card.hidden = false;
  card.classList.remove('gone');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(hideCard, 9000 + 3000 * Math.min(unlocked.length, 3));
  status(g.won ? `Sent to the ${family.label.toLowerCase()} board ✓` : idleStatus(), g.won ? 'ok' : '', 6000);
}
function hideCard() {
  if (card.hidden) return;
  card.classList.add('gone');
  setTimeout(() => { card.hidden = true; }, 400);
}
card.addEventListener('click', hideCard);
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const listOf = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

// ---- start -----------------------------------------------------------------

(async () => {
  status('Loading…');
  const sprites = await loadSprites();
  game = new Minesweeper(client, sprites, prefs, {   // [fork] draws on `client`, shown on #board
    sound: playSound,
    resized: () => layout(),
    won: (level, time) => {
      if (level !== CUSTOM && time < prefs.times[level]) {   // sub_100347c
        prefs.times[level] = time;
        if (player) {
          prefs.names[level] = player;   // [fork] the signed-in name: nobody types who they are
          savePrefs(prefs);
        } else {
          savePrefs(prefs);
          nameDialog(level, bestTimesDialog);
        }
      }
    },
    started: gameStarted,   // [fork]
    over: gameOver,         // [fork]
  });
  updateMenus();
  game.newGame();
  layout();
  status(idleStatus());
})();
