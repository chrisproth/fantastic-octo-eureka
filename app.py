import json
import os
import secrets
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask, abort, flash, jsonify, redirect, render_template, request,
    send_file, session, url_for
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint, or_, text
from werkzeug.security import check_password_hash, generate_password_hash


GAMES = {
    "pong": {"name": "Pong", "icon": "🏓", "description": "Arcade pong against the house CPU."},
    "beer-die": {"name": "Beer Die", "icon": "🎲", "description": "Timing-and-accuracy die toss challenge."},
    "flip-cup": {"name": "Flip Cup", "icon": "🥤", "description": "Reaction game: nail five clean flips."},
    "kings": {"name": "Kings", "icon": "🃏", "description": "Draw through a chaotic deck and outscore the CPU."},
    "quarters": {"name": "Quarters", "icon": "🪙", "description": "Hit the timing window and sink the quarter."},
    "cornhole": {"name": "Cornhole", "icon": "🌽", "description": "Dial in power and accuracy for four bags."},
    "slap-cup": {"name": "Slap Cup", "icon": "⚡", "description": "Pure reaction speed against a tiny CPU."},
}

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.getenv("COOKIE_SECURE", "0") == "1"

_db_url = os.getenv("DATABASE_URL", "sqlite:///frat_week.db")
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = _db_url

db = SQLAlchemy(app)


def utcnow():
    return datetime.now(timezone.utc)


class Player(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(40), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(80), nullable=False)
    pin_hash = db.Column(db.String(255), nullable=False)
    faab_balance = db.Column(db.Integer, nullable=False, default=1000)
    starting_faab = db.Column(db.Integer, nullable=False, default=1000)
    wins = db.Column(db.Integer, nullable=False, default=0)
    losses = db.Column(db.Integer, nullable=False, default=0)
    cpu_wins = db.Column(db.Integer, nullable=False, default=0)
    cpu_losses = db.Column(db.Integer, nullable=False, default=0)
    pvp_wins = db.Column(db.Integer, nullable=False, default=0)
    pvp_losses = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    stats = db.relationship("GameStat", backref="player", cascade="all, delete-orphan", lazy=True)


class GameStat(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    player_id = db.Column(db.Integer, db.ForeignKey("player.id"), nullable=False)
    game = db.Column(db.String(40), nullable=False)
    wins = db.Column(db.Integer, nullable=False, default=0)
    losses = db.Column(db.Integer, nullable=False, default=0)
    faab_won = db.Column(db.Integer, nullable=False, default=0)
    faab_lost = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (UniqueConstraint("player_id", "game", name="uq_player_game"),)


class Match(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    game = db.Column(db.String(40), nullable=False)
    challenger_id = db.Column(db.Integer, db.ForeignKey("player.id"), nullable=False)
    opponent_id = db.Column(db.Integer, db.ForeignKey("player.id"), nullable=False)
    wager = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default="pending")
    challenger_score = db.Column(db.Integer)
    opponent_score = db.Column(db.Integer)
    winner_id = db.Column(db.Integer, db.ForeignKey("player.id"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at = db.Column(db.DateTime(timezone=True))
    token = db.Column(db.String(64), nullable=False, default=lambda: secrets.token_hex(16))

    challenger = db.relationship("Player", foreign_keys=[challenger_id])
    opponent = db.relationship("Player", foreign_keys=[opponent_id])
    winner = db.relationship("Player", foreign_keys=[winner_id])


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    player_id = db.Column(db.Integer, db.ForeignKey("player.id"), nullable=False)
    amount = db.Column(db.Integer, nullable=False)
    balance_after = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(255), nullable=False)
    match_id = db.Column(db.Integer, db.ForeignKey("match.id"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    player = db.relationship("Player")
    match = db.relationship("Match")


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    actor = db.Column(db.String(80), nullable=False)
    action = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


def current_player():
    pid = session.get("player_id")
    return db.session.get(Player, pid) if pid else None


def player_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_player():
            flash("Sign in with your player PIN first.", "warning")
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("is_admin"):
            flash("Admin PIN required.", "danger")
            return redirect(url_for("admin_login"))
        return fn(*args, **kwargs)
    return wrapper


def get_stat(player_id, game):
    stat = GameStat.query.filter_by(player_id=player_id, game=game).first()
    if not stat:
        stat = GameStat(player_id=player_id, game=game)
        db.session.add(stat)
        db.session.flush()
    return stat


def record_transaction(player, amount, reason, match_id=None):
    player.faab_balance += amount
    db.session.add(Transaction(
        player_id=player.id,
        amount=amount,
        balance_after=player.faab_balance,
        reason=reason,
        match_id=match_id,
    ))


def record_result(player, game, won, pvp=False, faab_delta=0):
    stat = get_stat(player.id, game)
    if won:
        player.wins += 1
        stat.wins += 1
        if pvp:
            player.pvp_wins += 1
        else:
            player.cpu_wins += 1
        if faab_delta > 0:
            stat.faab_won += faab_delta
    else:
        player.losses += 1
        stat.losses += 1
        if pvp:
            player.pvp_losses += 1
        else:
            player.cpu_losses += 1
        if faab_delta < 0:
            stat.faab_lost += abs(faab_delta)


@app.context_processor
def inject_globals():
    return {"current_player": current_player(), "games": GAMES}


@app.get("/")
def index():
    leaders = Player.query.order_by(Player.wins.desc(), Player.faab_balance.desc(), Player.display_name.asc()).limit(10).all()
    recent = Match.query.filter_by(status="completed").order_by(Match.completed_at.desc()).limit(8).all()
    return render_template("index.html", leaders=leaders, recent=recent)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip().lower()
        pin = request.form.get("pin", "")
        player = Player.query.filter_by(username=username).first()
        if player and check_password_hash(player.pin_hash, pin):
            session.clear()
            session["player_id"] = player.id
            flash(f"Welcome back, {player.display_name}.", "success")
            return redirect(request.args.get("next") or url_for("dashboard"))
        flash("Invalid player name or PIN.", "danger")
    return render_template("login.html")


@app.get("/logout")
def logout():
    session.clear()
    flash("Logged out.", "success")
    return redirect(url_for("index"))


@app.get("/dashboard")
@player_required
def dashboard():
    player = current_player()
    incoming = Match.query.filter_by(opponent_id=player.id, status="pending").order_by(Match.created_at.desc()).all()
    active = Match.query.filter(
        Match.status == "active",
        or_(Match.challenger_id == player.id, Match.opponent_id == player.id),
    ).order_by(Match.created_at.desc()).all()
    history = Match.query.filter(
        Match.status == "completed",
        or_(Match.challenger_id == player.id, Match.opponent_id == player.id),
    ).order_by(Match.completed_at.desc()).limit(15).all()
    stats = {s.game: s for s in player.stats}
    return render_template("dashboard.html", player=player, incoming=incoming, active=active, history=history, stats=stats)


@app.get("/leaderboard")
def leaderboard():
    players = Player.query.order_by(Player.wins.desc(), Player.losses.asc(), Player.faab_balance.desc()).all()
    return render_template("leaderboard.html", players=players)


@app.get("/play/<game>")
@player_required
def play_game(game):
    if game not in GAMES:
        abort(404)
    return render_template("play.html", game_key=game, game=GAMES[game], mode="cpu")


@app.post("/api/cpu-result/<game>")
@player_required
def cpu_result(game):
    if game not in GAMES:
        return jsonify({"ok": False, "error": "Unknown game"}), 404
    payload = request.get_json(silent=True) or {}
    won = bool(payload.get("won"))
    player = current_player()
    record_result(player, game, won=won, pvp=False)
    db.session.add(AuditLog(actor=player.username, action=f"CPU result: {game} {'win' if won else 'loss'}"))
    db.session.commit()
    return jsonify({
        "ok": True,
        "wins": player.wins,
        "losses": player.losses,
        "faab": player.faab_balance,
    })


@app.route("/pvp/new", methods=["GET", "POST"])
@player_required
def pvp_new():
    player = current_player()
    opponents = Player.query.filter(Player.id != player.id).order_by(Player.display_name.asc()).all()
    if request.method == "POST":
        game = request.form.get("game", "")
        try:
            opponent_id = int(request.form.get("opponent_id", "0"))
            wager = int(request.form.get("wager", "0"))
        except ValueError:
            opponent_id, wager = 0, -1
        opponent = db.session.get(Player, opponent_id)
        if game not in GAMES or not opponent or opponent.id == player.id:
            flash("Choose a valid game and opponent.", "danger")
        elif wager < 0:
            flash("Wager cannot be negative.", "danger")
        elif wager > player.faab_balance:
            flash("You do not have enough FAAB for that wager.", "danger")
        else:
            match = Match(game=game, challenger_id=player.id, opponent_id=opponent.id, wager=wager, status="pending")
            db.session.add(match)
            db.session.flush()
            if wager:
                record_transaction(player, -wager, f"PVP wager escrow vs {opponent.display_name}", match.id)
            db.session.add(AuditLog(actor=player.username, action=f"Created match #{match.id}: {game} vs {opponent.username}, wager {wager}"))
            db.session.commit()
            flash("Challenge sent. Your wager is held until the match is accepted, declined, or completed.", "success")
            return redirect(url_for("pvp_match", match_id=match.id))
    return render_template("pvp_new.html", player=player, opponents=opponents)


def ensure_match_member(match):
    player = current_player()
    if player.id not in (match.challenger_id, match.opponent_id):
        abort(403)
    return player


@app.post("/pvp/<int:match_id>/accept")
@player_required
def pvp_accept(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    player = current_player()
    if match.opponent_id != player.id or match.status != "pending":
        abort(403)
    if player.faab_balance < match.wager:
        flash("You do not have enough FAAB to accept this wager.", "danger")
        return redirect(url_for("dashboard"))
    if match.wager:
        record_transaction(player, -match.wager, f"PVP wager escrow vs {match.challenger.display_name}", match.id)
    match.status = "active"
    db.session.add(AuditLog(actor=player.username, action=f"Accepted match #{match.id}"))
    db.session.commit()
    flash("Challenge accepted. Both players can now play their run.", "success")
    return redirect(url_for("pvp_match", match_id=match.id))


@app.post("/pvp/<int:match_id>/decline")
@player_required
def pvp_decline(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    player = current_player()
    if match.opponent_id != player.id or match.status != "pending":
        abort(403)
    if match.wager:
        record_transaction(match.challenger, match.wager, f"Refund: match #{match.id} declined", match.id)
    match.status = "cancelled"
    db.session.add(AuditLog(actor=player.username, action=f"Declined match #{match.id}"))
    db.session.commit()
    flash("Challenge declined; challenger escrow was refunded.", "success")
    return redirect(url_for("dashboard"))


@app.post("/pvp/<int:match_id>/cancel")
@player_required
def pvp_cancel(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    player = ensure_match_member(match)
    if match.challenger_id != player.id or match.status != "pending":
        abort(403)
    if match.wager:
        record_transaction(player, match.wager, f"Refund: match #{match.id} cancelled", match.id)
    match.status = "cancelled"
    db.session.add(AuditLog(actor=player.username, action=f"Cancelled match #{match.id}"))
    db.session.commit()
    flash("Challenge cancelled and escrow refunded.", "success")
    return redirect(url_for("dashboard"))


@app.get("/pvp/<int:match_id>")
@player_required
def pvp_match(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    player = ensure_match_member(match)
    my_score = match.challenger_score if player.id == match.challenger_id else match.opponent_score
    other = match.opponent if player.id == match.challenger_id else match.challenger
    other_score = match.opponent_score if player.id == match.challenger_id else match.challenger_score
    return render_template("pvp_match.html", match=match, player=player, other=other, my_score=my_score, other_score=other_score)


@app.post("/api/pvp/<int:match_id>/score")
@player_required
def pvp_score(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    player = ensure_match_member(match)
    if match.status != "active":
        return jsonify({"ok": False, "error": "Match is not active"}), 409
    payload = request.get_json(silent=True) or {}
    try:
        score = int(payload.get("score"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid score"}), 400
    if not 0 <= score <= 10000:
        return jsonify({"ok": False, "error": "Score out of range"}), 400

    if player.id == match.challenger_id:
        if match.challenger_score is not None:
            return jsonify({"ok": False, "error": "Score already submitted"}), 409
        match.challenger_score = score
    else:
        if match.opponent_score is not None:
            return jsonify({"ok": False, "error": "Score already submitted"}), 409
        match.opponent_score = score

    if match.challenger_score is not None and match.opponent_score is not None:
        # Ties resolve deterministically from the server-held match token so the client cannot choose the tiebreak.
        if match.challenger_score == match.opponent_score:
            challenger_wins = int(match.token[-2:], 16) % 2 == 0
        else:
            challenger_wins = match.challenger_score > match.opponent_score
        winner = match.challenger if challenger_wins else match.opponent
        loser = match.opponent if challenger_wins else match.challenger
        match.winner_id = winner.id
        match.status = "completed"
        match.completed_at = utcnow()
        if match.wager:
            record_transaction(winner, match.wager * 2, f"PVP pot won vs {loser.display_name}", match.id)
        record_result(winner, match.game, True, pvp=True, faab_delta=match.wager)
        record_result(loser, match.game, False, pvp=True, faab_delta=-match.wager)
        db.session.add(AuditLog(actor="system", action=f"Completed match #{match.id}; winner {winner.username}"))

    db.session.commit()
    return jsonify({"ok": True, "status": match.status, "winner_id": match.winner_id})


@app.get("/api/pvp/<int:match_id>/status")
@player_required
def pvp_status(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    ensure_match_member(match)
    return jsonify({
        "status": match.status,
        "challenger_score": match.challenger_score,
        "opponent_score": match.opponent_score,
        "winner_id": match.winner_id,
    })


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        supplied = request.form.get("pin", "")
        configured = os.getenv("ADMIN_PIN", "change-me")
        if secrets.compare_digest(supplied, configured):
            session.clear()
            session["is_admin"] = True
            flash("Admin mode enabled.", "success")
            return redirect(url_for("admin"))
        flash("Invalid admin PIN.", "danger")
    return render_template("admin_login.html")


@app.get("/admin/logout")
def admin_logout():
    session.clear()
    flash("Admin logged out.", "success")
    return redirect(url_for("index"))


@app.get("/admin")
@admin_required
def admin():
    players = Player.query.order_by(Player.display_name.asc()).all()
    matches = Match.query.order_by(Match.created_at.desc()).limit(30).all()
    txns = Transaction.query.order_by(Transaction.created_at.desc()).limit(40).all()
    audits = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(40).all()
    return render_template("admin.html", players=players, matches=matches, txns=txns, audits=audits)


@app.post("/admin/player/create")
@admin_required
def admin_create_player():
    username = request.form.get("username", "").strip().lower()
    display_name = request.form.get("display_name", "").strip()
    pin = request.form.get("pin", "").strip()
    try:
        faab = int(request.form.get("faab", os.getenv("STARTING_FAAB", "1000")))
    except ValueError:
        faab = -1
    if not username.replace("-", "").replace("_", "").isalnum() or not display_name or len(pin) < 4 or faab < 0:
        flash("Use a simple username, display name, PIN of at least 4 characters, and non-negative FAAB.", "danger")
    elif Player.query.filter_by(username=username).first():
        flash("That username already exists.", "danger")
    else:
        p = Player(username=username, display_name=display_name, pin_hash=generate_password_hash(pin), faab_balance=faab, starting_faab=faab)
        db.session.add(p)
        db.session.add(AuditLog(actor="admin", action=f"Created player {username} with {faab} FAAB"))
        db.session.commit()
        flash(f"Created {display_name}.", "success")
    return redirect(url_for("admin"))


@app.post("/admin/player/<int:player_id>/balance")
@admin_required
def admin_set_balance(player_id):
    player = db.session.get(Player, player_id) or abort(404)
    try:
        new_balance = int(request.form.get("balance", ""))
    except ValueError:
        new_balance = -1
    if new_balance < 0:
        flash("Balance must be zero or greater.", "danger")
    else:
        delta = new_balance - player.faab_balance
        record_transaction(player, delta, "Admin set balance")
        db.session.add(AuditLog(actor="admin", action=f"Set {player.username} balance to {new_balance}"))
        db.session.commit()
        flash(f"{player.display_name} now has {new_balance} FAAB.", "success")
    return redirect(url_for("admin"))


@app.post("/admin/player/<int:player_id>/pin")
@admin_required
def admin_set_pin(player_id):
    player = db.session.get(Player, player_id) or abort(404)
    pin = request.form.get("pin", "").strip()
    if len(pin) < 4:
        flash("PIN must be at least 4 characters.", "danger")
    else:
        player.pin_hash = generate_password_hash(pin)
        db.session.add(AuditLog(actor="admin", action=f"Changed PIN for {player.username}"))
        db.session.commit()
        flash(f"PIN updated for {player.display_name}.", "success")
    return redirect(url_for("admin"))


@app.post("/admin/player/<int:player_id>/reset-stats")
@admin_required
def admin_reset_player_stats(player_id):
    player = db.session.get(Player, player_id) or abort(404)
    player.wins = player.losses = player.cpu_wins = player.cpu_losses = player.pvp_wins = player.pvp_losses = 0
    for stat in player.stats:
        stat.wins = stat.losses = stat.faab_won = stat.faab_lost = 0
    db.session.add(AuditLog(actor="admin", action=f"Reset stats for {player.username}"))
    db.session.commit()
    flash(f"Stats reset for {player.display_name}.", "success")
    return redirect(url_for("admin"))


@app.post("/admin/reset-all")
@admin_required
def admin_reset_all():
    confirm = request.form.get("confirm", "")
    if confirm != "RESET FRAT WEEK":
        flash('Type exactly "RESET FRAT WEEK" to confirm.', "danger")
        return redirect(url_for("admin"))
    for p in Player.query.all():
        delta = p.starting_faab - p.faab_balance
        if delta:
            record_transaction(p, delta, "Admin full reset")
        p.wins = p.losses = p.cpu_wins = p.cpu_losses = p.pvp_wins = p.pvp_losses = 0
        for stat in p.stats:
            stat.wins = stat.losses = stat.faab_won = stat.faab_lost = 0
    db.session.add(AuditLog(actor="admin", action="Reset all player balances and stats"))
    db.session.commit()
    flash("All balances and stats reset. Match history was preserved.", "success")
    return redirect(url_for("admin"))


@app.post("/admin/match/<int:match_id>/void")
@admin_required
def admin_void_match(match_id):
    match = db.session.get(Match, match_id) or abort(404)
    if match.status not in ("pending", "active"):
        flash("Only pending or active matches can be voided.", "danger")
        return redirect(url_for("admin"))
    if match.wager:
        record_transaction(match.challenger, match.wager, f"Admin void refund: match #{match.id}", match.id)
        if match.status == "active":
            record_transaction(match.opponent, match.wager, f"Admin void refund: match #{match.id}", match.id)
    match.status = "cancelled"
    db.session.add(AuditLog(actor="admin", action=f"Voided match #{match.id}"))
    db.session.commit()
    flash(f"Match #{match.id} voided and escrow refunded.", "success")
    return redirect(url_for("admin"))


@app.get("/admin/export")
@admin_required
def admin_export():
    data = {
        "format": "frat-week-backup-v1",
        "exported_at": utcnow().isoformat(),
        "players": [
            {
                "id": p.id,
                "username": p.username,
                "display_name": p.display_name,
                "pin_hash": p.pin_hash,
                "faab_balance": p.faab_balance,
                "starting_faab": p.starting_faab,
                "wins": p.wins,
                "losses": p.losses,
                "cpu_wins": p.cpu_wins,
                "cpu_losses": p.cpu_losses,
                "pvp_wins": p.pvp_wins,
                "pvp_losses": p.pvp_losses,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in Player.query.order_by(Player.id.asc()).all()
        ],
        "game_stats": [
            {
                "id": s.id,
                "player_id": s.player_id,
                "game": s.game,
                "wins": s.wins,
                "losses": s.losses,
                "faab_won": s.faab_won,
                "faab_lost": s.faab_lost,
            }
            for s in GameStat.query.order_by(GameStat.id.asc()).all()
        ],
        "matches": [
            {
                "id": m.id,
                "game": m.game,
                "challenger_id": m.challenger_id,
                "opponent_id": m.opponent_id,
                "wager": m.wager,
                "status": m.status,
                "challenger_score": m.challenger_score,
                "opponent_score": m.opponent_score,
                "winner_id": m.winner_id,
                "created_at": m.created_at.isoformat() if m.created_at else None,
                "completed_at": m.completed_at.isoformat() if m.completed_at else None,
                "token": m.token,
            }
            for m in Match.query.order_by(Match.id.asc()).all()
        ],
        "transactions": [
            {
                "id": t.id,
                "player_id": t.player_id,
                "amount": t.amount,
                "balance_after": t.balance_after,
                "reason": t.reason,
                "match_id": t.match_id,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in Transaction.query.order_by(Transaction.id.asc()).all()
        ],
        "audit_logs": [
            {"id": a.id, "actor": a.actor, "action": a.action, "created_at": a.created_at.isoformat() if a.created_at else None}
            for a in AuditLog.query.order_by(AuditLog.id.asc()).all()
        ],
    }
    path = "/tmp/frat_week_export.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return send_file(path, as_attachment=True, download_name="frat_week_export.json")


def _parse_iso(value):
    if not value:
        return None
    return datetime.fromisoformat(value)


def _reset_postgres_sequences():
    if db.engine.dialect.name != "postgresql":
        return
    for table_name in ("player", "game_stat", "match", "transaction", "audit_log"):
        db.session.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table_name}), 1), "
            f"(SELECT MAX(id) IS NOT NULL FROM {table_name}))"
        ))


@app.post("/admin/import")
@admin_required
def admin_import():
    if request.form.get("confirm") != "IMPORT FRAT WEEK":
        flash('Type exactly "IMPORT FRAT WEEK" to confirm a restore.', "danger")
        return redirect(url_for("admin"))
    upload = request.files.get("backup")
    if not upload or not upload.filename:
        flash("Choose a Frat Week JSON backup first.", "danger")
        return redirect(url_for("admin"))
    try:
        data = json.load(upload.stream)
        if data.get("format") != "frat-week-backup-v1":
            raise ValueError("Unsupported backup format")
        required = ("players", "game_stats", "matches", "transactions", "audit_logs")
        if any(key not in data or not isinstance(data[key], list) for key in required):
            raise ValueError("Backup is missing required sections")

        # Full replacement is intentional: this is a commissioner recovery tool.
        Transaction.query.delete()
        Match.query.delete()
        GameStat.query.delete()
        AuditLog.query.delete()
        Player.query.delete()
        db.session.flush()

        for x in data["players"]:
            db.session.add(Player(
                id=int(x["id"]), username=x["username"], display_name=x["display_name"],
                pin_hash=x["pin_hash"], faab_balance=int(x["faab_balance"]),
                starting_faab=int(x["starting_faab"]), wins=int(x.get("wins", 0)),
                losses=int(x.get("losses", 0)), cpu_wins=int(x.get("cpu_wins", 0)),
                cpu_losses=int(x.get("cpu_losses", 0)), pvp_wins=int(x.get("pvp_wins", 0)),
                pvp_losses=int(x.get("pvp_losses", 0)), created_at=_parse_iso(x.get("created_at")) or utcnow(),
            ))
        db.session.flush()

        for x in data["game_stats"]:
            db.session.add(GameStat(
                id=int(x["id"]), player_id=int(x["player_id"]), game=x["game"],
                wins=int(x.get("wins", 0)), losses=int(x.get("losses", 0)),
                faab_won=int(x.get("faab_won", 0)), faab_lost=int(x.get("faab_lost", 0)),
            ))
        for x in data["matches"]:
            db.session.add(Match(
                id=int(x["id"]), game=x["game"], challenger_id=int(x["challenger_id"]),
                opponent_id=int(x["opponent_id"]), wager=int(x.get("wager", 0)),
                status=x["status"], challenger_score=x.get("challenger_score"),
                opponent_score=x.get("opponent_score"), winner_id=x.get("winner_id"),
                created_at=_parse_iso(x.get("created_at")) or utcnow(),
                completed_at=_parse_iso(x.get("completed_at")), token=x.get("token") or secrets.token_hex(16),
            ))
        db.session.flush()

        for x in data["transactions"]:
            db.session.add(Transaction(
                id=int(x["id"]), player_id=int(x["player_id"]), amount=int(x["amount"]),
                balance_after=int(x["balance_after"]), reason=x["reason"],
                match_id=x.get("match_id"), created_at=_parse_iso(x.get("created_at")) or utcnow(),
            ))
        for x in data["audit_logs"]:
            db.session.add(AuditLog(
                id=int(x["id"]), actor=x["actor"], action=x["action"],
                created_at=_parse_iso(x.get("created_at")) or utcnow(),
            ))
        db.session.flush()
        _reset_postgres_sequences()
        db.session.commit()
        flash("Backup restored. Player PINs, FAAB, stats, matches, ledger, and audit history were restored.", "success")
    except Exception as exc:
        db.session.rollback()
        flash(f"Import failed: {exc}", "danger")
    return redirect(url_for("admin"))


@app.get("/health")
def health():
    return {"ok": True, "app": "frat-week"}


with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
