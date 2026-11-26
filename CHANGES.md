# Changes in this fork

HanClinto/minesweeper-xp is [Ozdotdotdot/minesweeper-xp](https://github.com/Ozdotdotdot/minesweeper-xp) (its commits
are this fork's first ones, unchanged) made to sit in a games site and to play well on phones. The game itself is
upstream's port of `WINMINE.EXE`; every change to the engine or the shell is marked `[fork]` in the code.

## The engine (`js/winmine.js`)

- **The field shown sideways**: `setTransposed(on)` draws the field with its rows as columns (a 30 × 16 Expert field
  as 16 × 30) and maps clicks back the same way (`cellAt(px, py)`, an instance method beside the original static
  one). The board, its coordinates, the mines and every rule are untouched; only `drawBlk` and the client-area size
  depend on it.
- **Hooks for the page**: `started()` at the first click of a game (when the timer starts), `over(win)` at the end of
  every game, won or lost (the original only reported wins, for its best times), and `flagsPlaced`, the flags put down
  in the current game.

## The page (`index.html`, `css/page.css`, `js/shell.js`, `js/scores.js`)

- **No desktop**: the XP desktop, taskbar, title bar and window dragging are gone. The page has a top bar (back, title,
  a status line, Leaderboard, How to play, Full screen, Home), the game's menu bar and field on the XP blue, and a line
  of the controls underneath (mouse or touch, whichever the device has). Game › Exit goes back.
- **As large as fits, sharp**: the engine draws the client area at its original size on a canvas of its own, and the
  page copies it to the visible canvas scaled to fit (at most 4×). When a whole number of device pixels per original
  pixel costs little, it uses that, unsmoothed; otherwise "sharp bilinear" (scaled up in whole pixels, then the last
  step down smoothed, which only softens pixel edges). The board is nudged onto the device-pixel grid after centring.
  Upstream scaled the whole window by a fraction when it didn't fit, which blurred it.
- **Sideways on tall screens**: when the field shown sideways would have squares at least 15% bigger, it's shown
  sideways (Expert on a phone held upright: squares about 21 points instead of 12). Turning the device mid-game
  redraws the same game the other way.
- **Controls**: keys for the square under the mouse: Space uncovers it, as a click does, Z marks it, as a
  right-click does, and X chords it, as Shift+click does (Space and X are held and let go like the button). Z and X
  still count toward XYZZY. On a touch screen a tap is a click (upstream also chorded a tap on a number) and a double
  tap on an open number chords it, as Shift+click does; the engine's `tap(px, py, chord)` takes which.
- **How to play** opens on the first visit.
- **Scores** (with `data-scores-api` on `<body>`): every finished game, won or lost, goes to the score service as it
  ends, under the signed-in name; one that can't be sent waits in the browser (`localStorage`) and goes later, and its
  `game_id` keeps it from counting twice. After a win a card says what it meant ("New personal best on Expert: 87
  seconds! You passed Sean. #1 of 3 in the family.") and shows achievements. A game where the XYZZY cheat showed a
  square is sent marked as such.
- **Nobody types their name**: with a signed-in player, a new best time is recorded under their first name without
  the name dialog. **Best Times** shows the family's fastest on each level (and your own best) instead of this
  browser's, with a link to the leaderboard. Without a score service both behave as the original.
- The hidden tab pauses the game as before, and also the clock used to break ties between equal times.

## Tests

`tests/fork.test.mjs` covers the engine changes (sideways drawing and clicks, the hooks); upstream's
`tests/engine.test.mjs` passes unchanged. `node --test tests/*.test.mjs` (Node 22).
