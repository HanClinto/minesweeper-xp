// [fork] Score services for the page (CHANGES.md): each finished game goes to one as it ends, and Best Times can show
// its fastest. A score service is an object with:
//
//   label                 "Family": the board's name ("the family board")
//   submit(game)          Promise of what became of a finished game (README.md, "Score service API"):
//                         { new_best, previous_best, best, rank, players, passed: [names], unlocked: [achievements] }
//   board(level, limit)   Promise of a level's board: { entries: fastest first, [{ name, seconds, date, mine }],
//                         my_best, my_rank, players }
//   me()                  Promise of { name }: who's playing, so nobody types their name
//
// ScoresApi(base) talks to the small HTTP API described in README.md.

async function json(res) {
  if (!res.ok) {
    let why = res.status === 401 || res.status === 403 ? 'Not signed in' : `Score service error ${res.status}`;
    try { why = (await res.json()).error || why; } catch { /* not JSON */ }
    const err = new Error(why);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function ScoresApi(base, { label = 'Family', game = 'minesweeper' } = {}) {
  base = String(base).replace(/\/$/, '');
  const opts = { credentials: 'same-origin' };
  return {
    label,
    submit: (g) => fetch(`${base}/${game}/games`, {
      ...opts, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(g),
    }).then(json),
    board: (level, limit = 10) => fetch(`${base}/${game}/boards/${level | 0}?limit=${limit | 0}`, opts).then(json),
    me: () => fetch(`${base}/me`, opts).then(json).then((j) => ({ name: j.first_name || j.name || '' })),
  };
}

// Finished games not yet sent (no connection, the service down): kept in this browser and sent at the next chance,
// oldest first. Each has a game_id, so a game sent twice counts once.
export function Outbox(key = 'winmine.outbox') {
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const write = (list) => { try { localStorage.setItem(key, JSON.stringify(list.slice(-200))); } catch { /* full or blocked */ } };
  return {
    add: (g) => write([...read(), g]),
    remove: (id) => write(read().filter((g) => g.game_id !== id)),
    list: read,
  };
}

export function newId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
