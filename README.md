# Minesweeper XP

Windows XP Minesweeper in the browser, rebuilt from the original `WINMINE.EXE`.

**This fork** (HanClinto/minesweeper-xp) fits the game to a page with a top bar, draws it sharp at any size, shows a
wide field sideways on a tall phone screen, and can send every finished game to a family score service.
[CHANGES.md](CHANGES.md) lists what changed; the rest of this README is upstream's, with the parts below added.
Upstream plays at https://minesweeper.ozairkhan.com; this fork at https://hanclinto.github.io/minesweeper-xp/.

The sprites, sounds, strings, menus and dialogs come straight from the executable's resources.
The game logic is a line-by-line port of the decompiled procedures: mine placement, the flood
fill, first-click mine relocation, chording, the mark cycle, the timer, best times, Custom Field
limits and the XYZZY cheat. [docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md) maps each
behaviour to its address in the binary.

## Controls

| Action | Mouse | Touch |
| --- | --- | --- |
| Uncover | Left click | Tap |
| Flag / ? / clear | Right click | Press and hold |
| Chord | Both buttons, middle button or Shift+click | Tap a number |
| New game | Smiley or F2 | Tap the smiley |

## Using it on a site (this fork)

The page is generic; a site switches on its parts with attributes on `<body>` in its copy of `index.html`:

| Attribute | What it does |
| --- | --- |
| `data-scores-api="/scores/api"` | Sends every finished game to that score service, and Best Times shows its fastest |
| `data-scores-label="Family"` | The board's name in the card and Best Times |
| `data-leaderboard="/scores/minesweeper"` | A Leaderboard link in the top bar and in Best Times |
| `data-back="/" data-back-label="Games"` | "‹ Games" in the top bar; Game › Exit goes there too |
| `data-home="https://..." data-home-label="Home"` | A Home link |

### Score service API

All under the `data-scores-api` address, same-site, with the browser's cookies (the service knows who's signed in):

- `GET me`: `{ "first_name": "Sean" }`, who's playing.
- `POST minesweeper/games` with a finished game:
  `{ "game_id", "level": 0-3 (Beginner, Intermediate, Expert, Custom), "width", "height", "mines", "won": bool,
  "seconds": the game's own timer (1-999), "ms": time actually played, "opened": squares uncovered, "toOpen": safe
  squares in all, "flags": flags put down, "xyzzy": bool (the cheat showed a square), "date": unix seconds }`.
  Answers `{ "new_best", "previous_best", "best", "rank", "players", "passed": [names], "unlocked": [{ "id", "icon",
  "title", "text" }] }`. The same `game_id` twice counts once.
- `GET minesweeper/boards/<level>?limit=N`: `{ "entries": [{ "name", "seconds", "date", "mine" }], "my_best",
  "my_rank", "players" }`, fastest first.

## Layout

```
index.html                 page and XP window chrome
css/xp.css                 Luna styling
js/winmine.js              game engine and renderer (port of WINMINE.EXE)
js/shell.js                menus, dialogs, input, settings; [fork] the page's layout, drawing and scores
js/scores.js               [fork] the score service client and the outbox
css/page.css               [fork] the page around the game
assets/                    resources extracted from WINMINE.EXE
tools/extract_resources.py regenerates assets/ from your own WINMINE.EXE
tests/                     engine tests (node --test tests/*.test.mjs); fork.test.mjs for this fork's changes
```

## Development

No build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
node --test tests/*.test.mjs
```

To regenerate the assets, put your own copy of `WINMINE.EXE` in `original/` (git-ignored) and run:

```sh
python3 -I tools/extract_resources.py original/WINMINE.EXE assets/
```

## Notice

Minesweeper and its artwork and sounds belong to Microsoft. This is a non-commercial fan
preservation project and is not affiliated with or endorsed by Microsoft. The original
binaries are not included in this repository. The port's code is released under the MIT
licence (see [LICENSE](LICENSE)); that licence does not cover the extracted assets.
