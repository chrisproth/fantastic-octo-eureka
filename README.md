# Frat Week

A self-hosted Flask party-game hub designed for a fantasy-football group. It has browser mini-games against a small CPU, asynchronous player-vs-player challenges, virtual FAAB wagering, persistent standings, player PINs, and a commissioner/admin control panel.

> FAAB in this project is virtual fantasy-football currency only. There is no cash wagering, deposits, withdrawals, or payment processing.

## Fixed Frat Week roster (2026-09-22)

This build contains a one-time roster migration. On the first boot of this version it upserts the requested players, sets their current/reset FAAB values, and sets their PINs. The migration is marked in the database so later Render restarts **do not reset FAAB again**.

| Login | Team / display name | PIN | FAAB |
|---|---|---:|---:|
| `mike` | Chase Emeka Ceedeez | `74534` | 395 |
| `goon` | D Henny in da butt | `4325` | 600 |
| `jack` | Jeremiah Smith Sucks | `34276` | 809 |
| `green` | JiSN My Pants | `23145231` | 320 |
| `chris` | Ryan Wingo | `6542` | 855 |
| `triz` | Seedlings of the West | `43125` | 511 |
| `lago` | Team Linguine32 | `2356` | 582 |
| `shaw` (or `Jake`) | Team ShawR Jake | `1542` | 580 |
| `boosta` | The Scent of Autumn | `2341234` | 763 |
| `joe` | Thorns of the East | `32456` | 596 |

Admin PIN: `1289371` (or whatever value you later set in Render as `ADMIN_PIN`).

## Interactive game controls

- **Cup Pong:** grab the ping-pong ball, drag toward the cup rack, and release. Ten throws; sunk cups disappear.
- **Beer Die:** grab and throw the die with a drag/release gesture. Landing on the opponent half scores; corner-cup hits score more.
- **Flip Cup:** swipe the cup upward. Flick height and side-to-side error determine whether it completes a clean rotation and lands upright.
- **Kings Cup:** full shuffled 52-card deck, central King's Cup, card-by-card actions, active house rules, and the game ends on the fourth King. This build uses the common U.S. mapping: A Waterfall, 2 You, 3 Me, 4 Floor, 5 Guys, 6 Chicks, 7 Heaven, 8 Mate, 9 Rhyme, 10 Categories, J Make a Rule, Q Question Master, K King's Cup.
- **Quarters:** flick the quarter; it must bounce once on the table before entering the cup.
- **Cornhole:** drag/release each bag; hole = 3, board = 1.
- **Slap Cup:** rapid bounce shots with a moving cup target.

All gesture games use Pointer Events, so the same controls work with a mouse or a touchscreen. PvP runs use the exact same game mechanics as CPU runs; the normalized run score is submitted once and locked.

## Included games

- Pong — mouse/touch paddle game vs CPU
- Beer Die — timing/accuracy meter
- Flip Cup — rotating-cup timing challenge
- Kings — card-draw score game
- Quarters — timing challenge
- Cornhole — four-throw timing challenge
- Slap Cup — reaction-time challenge

Every game can be used for CPU play. PvP uses the same browser skill run, normalizes the result to a score, and locks one score per player. Higher score wins the match.

## Main features

- Landing page with game cards and recent results
- Player login using username + hashed PIN
- Separate admin PIN
- Persistent FAAB balance, wins/losses, per-game stats, transactions, and match history
- Global leaderboard: overall W-L, CPU W-L, PvP W-L, win %, FAAB, net FAAB
- PvP challenge flow: choose game, opponent, and FAAB wager
- Escrow: challenger FAAB is held when the challenge is created; opponent stake is held when accepted
- Decline/cancel refunds the challenger
- Winner receives the full two-player pot
- Admin can create players, set exact FAAB balances, change PINs, reset one player's stats, reset all balances/stats, void active matches with refunds, export a full JSON backup, and restore that backup
- Audit log and FAAB transaction ledger
- `/health` endpoint for hosting checks

## Why the database setup matters on Render Free

Render's free web-service filesystem is ephemeral. A SQLite file created by the app can disappear after a redeploy, restart, or replacement instance. Therefore:

- **Local development:** SQLite is fine and is the automatic fallback.
- **Render Free:** set `DATABASE_URL` to an external PostgreSQL database. Neon works well for this and does not require a paid Render persistent disk.

All balance/stat/match changes are committed immediately to PostgreSQL. The app does not depend on a local save file for production state.

## Important technical limitations

1. **Free Render can sleep.** The first request after inactivity may take longer while the service wakes up.
2. **No paid persistent disk is used.** PostgreSQL is the durable source of truth.
3. **PvP is asynchronous, not WebSocket real-time.** Each player opens the match and submits a run. This avoids adding a realtime service and behaves better with sleeping/free hosting.
4. **Browser-game scores are casual-trust scores.** The server prevents duplicate submissions and caps accepted score values, but a determined player can manipulate browser JavaScript/devtools. For a friends-only fantasy league this is usually acceptable. A serious anti-cheat version would move more game simulation/validation server-side.
5. **Active challenges can be abandoned.** Admin has a Void + Refund control for pending/active matches.
6. **Changing schema later needs care.** `db.create_all()` creates missing tables but is not a full migration system. If you make substantial model changes later, add Alembic/Flask-Migrate.
7. **Use a stable `SECRET_KEY`.** If it changes, existing sessions are invalidated. This does not affect database balances.

## Local Windows setup

Open PowerShell in the project folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY="local-dev-secret-change-this"
$env:ADMIN_PIN="2468"
$env:STARTING_FAAB="1000"
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

Admin page:

```text
http://127.0.0.1:5000/admin
```

The local SQLite database is created automatically at `instance/frat_week.db` by Flask-SQLAlchemy.

## Render Free deployment with Neon PostgreSQL

### 1. Create a Neon database

1. Create a free Neon project.
2. Copy the PostgreSQL connection string. Use the pooled connection string if Neon offers one.
3. Make sure the URL includes SSL, normally `?sslmode=require`.

Example shape:

```text
postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

### 2. Push this folder to GitHub

Your repository root should contain:

```text
app.py
requirements.txt
render.yaml
templates/
static/
```

Do **not** commit real secrets or your real `.env` file.

### 3. Create the Render service

The included `render.yaml` uses:

```text
Build: pip install -r requirements.txt
Start: gunicorn app:app --workers 2 --threads 4 --timeout 120
Plan: Free
```

In Render, set these environment variables:

```text
DATABASE_URL=<your Neon connection string>
ADMIN_PIN=<your private commissioner PIN>
SECRET_KEY=<long random value>
STARTING_FAAB=1000
COOKIE_SECURE=1
```

If Render generates `SECRET_KEY` from the blueprint, leave it stable after the first deployment.

### 4. Deploy

On first boot the app runs `db.create_all()` and creates the tables in PostgreSQL. No local `.db` file is required in production.

### 5. Create your players

1. Open `/admin`.
2. Sign in with `ADMIN_PIN`.
3. Create each fantasy manager with a username, display name, PIN, and starting FAAB.
4. Give the player their username and PIN.

## How PvP FAAB wagering works

Example: Chris challenges Jake for 50 FAAB.

1. Chris creates the challenge. Chris immediately goes from 1000 to 950; 50 is effectively in escrow.
2. Jake accepts. Jake goes from 1000 to 950; another 50 enters escrow.
3. Both players complete one game run.
4. If Chris wins, Chris receives the 100-FAAB pot and ends at 1050. Jake remains at 950.
5. The leaderboard records a +50 net result for Chris and -50 for Jake relative to the start of that wager.

If Jake declines before accepting, Chris's 50 is refunded. If a match is stuck, the admin can void it and refund the appropriate escrowed players.

## Recommended first changes

- Change `ADMIN_PIN` immediately.
- Set a long stable `SECRET_KEY`.
- Create all league managers from the admin panel.
- Decide whether league starting FAAB should be 100, 200, 1000, etc.
- If you want stronger anti-cheat later, move PvP scoring to server-generated round inputs instead of trusting a browser score.


## Backup / restore

The admin **Export JSON Backup** includes player records, hashed player PINs, FAAB balances, per-game stats, matches, transactions, and audit history. The admin restore form performs a full state replacement and requires the exact confirmation phrase `IMPORT FRAT WEEK`. Keep exported backup files private: although PINs are not stored as plaintext, short PIN hashes should still be treated as sensitive authentication data.

## Gameplay polish update (v3)

- Slap Cup is now a 30-second rapid race: bounce once, sink, then click/tap the glowing cup to slap it and advance. The bounce physics were reworked so successful shots can actually carry from the bounce zone into the cup.
- Canvas game physics now use frame-time normalization, so throws run at the same speed on 60 Hz, 120 Hz, and other refresh-rate displays.
- Cup Pong, Beer Die, Quarters, and Cornhole now have motion trails, softer shadows, impact feedback, score animations, and smoother release/landing animation.
- Flip Cup now has smoother 3D-style movement, a moving shadow, and success/miss feedback.
- Kings Cup now animates card flips, rule changes, and King/cup events.
