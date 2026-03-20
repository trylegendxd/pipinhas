const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { mountSolanaRoutes } = require("./solana-routes");

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const AUDIO_DIR = path.join(PUBLIC_DIR, "audio");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL environment variable.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

const WORLD_SIZE = 12000;
const WORLD_RADIUS = WORLD_SIZE / 2;
const FOOD_COUNT = 3000;
const VIRUS_COUNT = 35;
const BOT_COUNT = 8;
const TICK_RATE = 60;
const MAX_CELLS = 16;
const SNAPSHOT_PADDING = 650;
const MAX_CHAT_MESSAGES = 40;
const START_MASS = 30;
const REGISTER_BONUS = 5;
const BOT_FOOD_CAP = 200;

const SPLIT_MERGE_DELAY_TICKS = 25 * TICK_RATE;
const SPLIT_LAUNCH_SPEED = 40;
const EJECT_LAUNCH_DISTANCE = 100;
const EJECT_LAUNCH_SPEED = 32;
const TOUCH_SEPARATION_FACTOR = 1.0;
const PREMERGE_ATTRACTION_FACTOR = 0.006;
const POSTMERGE_ATTRACTION_FACTOR = 0.04;
const EJECT_ORB_MASS = START_MASS;
const EXTRACTION_HOLD_TICKS = 6 * TICK_RATE;
const EXTRACTION_PAYOUT_RATE = 0.95;

const ALLOWED_STAKES = [1, 5, 10, 20];
const ALLOWED_PLAYER_COLORS = new Set([
  "#111111",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#facc15",
  "#f97316",
  "#8b5a2b",
  "#9ca3af",
  "#3b82f6"
]);

const ROULETTE_ALLOWED_CHIP_VALUES = new Set([0.5, 1, 2, 5]); // chip denominations
const ROULETTE_MAX_PER_NUMBER = 5;   // max total bet per number
const ROULETTE_MAX_TOTAL_BET = 20;   // max total stake per spin
const BLACKJACK_ALLOWED_BET_AMOUNTS = new Set([1, 2, 3, 4, 5]);
const MATCHMAKING_COUNTDOWN_SECS = 10;
const ROULETTE_RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

const players = new Map();
const playerByUserId = new Map();
const socketsByUserId = new Map();

function notifyUser(userId, event, payload) {
  const socketId = socketsByUserId.get(Number(userId));
  if (!socketId) return;
  const sock = io.sockets.sockets.get(socketId);
  if (sock) sock.emit(event, payload);
}
const blackjackGames = new Map();
const spectators = new Map();

// True only while a real match is in progress (2+ players loaded in)
let matchActive = false;
let _tickLeaderboard = null; // cached leaderboard, rebuilt once per tick

// matchmakingQueue[stake] = [ { userId, socketId, name, color } ]
const matchmakingQueue = {};
for (const s of [1, 5, 10, 20]) matchmakingQueue[s] = [];
// countdownTimers[stake] = { timer, startedAt }
const countdownTimers = {};

const food = [];
const viruses = [];
const bots = [];
const chatMessages = [];

function radiusFromMass(mass) {
  return Math.sqrt(mass) * 4.8;
}

const EJECT_ORB_RADIUS = radiusFromMass(EJECT_ORB_MASS);

const sessionMiddleware = session({
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
});

app.use(express.json());
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(express.static(PUBLIC_DIR));
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      credits NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id
    ON credit_transactions(user_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id BIGSERIAL PRIMARY KEY,
      from_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (from_user_id, to_user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friends (
      id BIGSERIAL PRIMARY KEY,
      user_a BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_a, user_b)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id BIGSERIAL PRIMARY KEY,
      from_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire"
    ON user_sessions ("expire")
  `);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function randomColor() {
  const hue = Math.floor(rand(0, 360));
  return `hsl(${hue}, 80%, 58%)`;
}

function sanitizePlayerColor(color) {
  const normalized = String(color || "").trim().toLowerCase();
  return ALLOWED_PLAYER_COLORS.has(normalized) ? normalized : "#3b82f6";
}

function randomPointInCircle(maxRadius) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * maxRadius;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function clampToWorldCircle(x, y, radius = 0) {
  const maxDist = Math.max(0, WORLD_RADIUS - radius);
  const dist = Math.hypot(x, y) || 1;

  if (dist <= maxDist) {
    return { x, y };
  }

  const scale = maxDist / dist;
  return {
    x: x * scale,
    y: y * scale
  };
}

function randomSpawnCell() {
  const p = randomPointInCircle(WORLD_RADIUS - 400);
  return {
    x: p.x,
    y: p.y,
    mass: START_MASS,
    vx: 0,
    vy: 0,
    mergeTimer: 0
  };
}

function createFood() {
  const p = randomPointInCircle(WORLD_RADIUS - 8);
  return {
    id: Math.random().toString(36).slice(2),
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    r: 8,
    color: `hsl(${Math.floor(rand(0, 360))},85%,60%)`,
    mass: 1
  };
}

function createVirus() {
  const p = randomPointInCircle(WORLD_RADIUS - 48);
  return {
    id: Math.random().toString(36).slice(2),
    x: p.x,
    y: p.y,
    r: 48
  };
}

function totalMass(entity) {
  return entity.cells.reduce((sum, cell) => sum + cell.mass, 0);
}

function entityCenter(entity) {
  let total = 0;
  let sx = 0;
  let sy = 0;

  for (const cell of entity.cells) {
    total += cell.mass;
    sx += cell.x * cell.mass;
    sy += cell.y * cell.mass;
  }

  if (total <= 0) return { x: 0, y: 0 };
  return { x: sx / total, y: sy / total };
}

function createHumanPlayer(socketId, user, payload) {
  const requestedName = typeof payload === "object" ? payload?.name : payload;
  const requestedColor = typeof payload === "object" ? payload?.color : null;
  const safeName =
    String(requestedName || user.username || "Player").trim().slice(0, 16) ||
    "Player";

  return {
    kind: "human",
    id: socketId,
    userId: Number(user.id),
    username: user.username,
    name: safeName,
    color: sanitizePlayerColor(requestedColor),
    mouse: { x: 0, y: 0 },
    wantsSplit: false,
    wantsEject: false,
    wantsExtract: false,
    extracting: false,
    extractTicks: 0,
    cashValue: 0,
    cells: [randomSpawnCell()],
    alive: true,
    joinedAt: Date.now()
  };
}

function createBot(index) {
  return {
    kind: "bot",
    id: `bot-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Bot ${index + 1}`,
    color: randomColor(),
    mouse: { x: 0, y: 0 },
    wantsSplit: false,
    wantsEject: false,
    wantsExtract: false,
    extracting: false,
    extractTicks: 0,
    cashValue: 0,
    cells: [randomSpawnCell()],
    alive: true,
    botIndex: index
  };
}

function isHuman(entity) {
  return entity.kind === "human";
}

function isBot(entity) {
  return entity.kind === "bot";
}

function addChatMessage(name, text) {
  const cleanName = String(name || "Player").slice(0, 16);
  const cleanText = String(text || "").trim().slice(0, 160);
  if (!cleanText) return;

  const msg = {
    id: Math.random().toString(36).slice(2),
    name: cleanName,
    text: cleanText,
    time: Date.now()
  };

  chatMessages.push(msg);
  while (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
  io.emit("chat", msg);
}

async function getUserByUsername(username) {
  const { rows } = await pool.query(
    `
    SELECT id, username, password_hash, credits
    FROM users
    WHERE username = $1
    `,
    [username]
  );

  if (!rows[0]) return null;

  return {
    id: Number(rows[0].id),
    username: rows[0].username,
    password_hash: rows[0].password_hash,
    credits: Number(rows[0].credits || 0)
  };
}

async function getUserById(id) {
  const { rows } = await pool.query(
    `
    SELECT id, username, credits
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  if (!rows[0]) return null;

  return {
    id: Number(rows[0].id),
    username: rows[0].username,
    credits: Number(rows[0].credits || 0)
  };
}

async function createUserWithBonus(username, passwordHash) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertUser = await client.query(
      `
      INSERT INTO users (username, password_hash, credits)
      VALUES ($1, $2, $3)
      RETURNING id
      `,
      [username, passwordHash, REGISTER_BONUS]
    );

    const userId = Number(insertUser.rows[0].id);

    await client.query(
      `
      INSERT INTO credit_transactions (user_id, type, amount, note)
      VALUES ($1, $2, $3, $4)
      `,
      [userId, "register_bonus", REGISTER_BONUS, "Welcome bonus"]
    );

    await client.query("COMMIT");
    return userId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function addCreditsTx(userId, amount, type, note) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT id, credits FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (!currentRes.rows[0]) {
      throw new Error("USER_NOT_FOUND");
    }

    const currentCredits = Number(currentRes.rows[0].credits || 0);
    const nextCredits = currentCredits + Number(amount);

    await client.query(`UPDATE users SET credits = $1 WHERE id = $2`, [
      nextCredits,
      userId
    ]);

    await client.query(
      `
      INSERT INTO credit_transactions (user_id, type, amount, note)
      VALUES ($1, $2, $3, $4)
      `,
      [userId, type, amount, note || null]
    );

    await client.query("COMMIT");
    return nextCredits;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function spendCreditsTx(userId, amount, type, note) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentRes = await client.query(
      `SELECT id, credits FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (!currentRes.rows[0]) {
      throw new Error("USER_NOT_FOUND");
    }

    const currentCredits = Number(currentRes.rows[0].credits || 0);
    if (currentCredits < amount) {
      const err = new Error("INSUFFICIENT_CREDITS");
      err.code = "INSUFFICIENT_CREDITS";
      throw err;
    }

    const nextCredits = currentCredits - Number(amount);

    await client.query(`UPDATE users SET credits = $1 WHERE id = $2`, [
      nextCredits,
      userId
    ]);

    await client.query(
      `
      INSERT INTO credit_transactions (user_id, type, amount, note)
      VALUES ($1, $2, $3, $4)
      `,
      [userId, type, -Math.abs(amount), note || null]
    );

    await client.query("COMMIT");
    return nextCredits;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getSessionUser(req) {
  const raw = req.session?.user;
  if (!raw?.id) return null;

  const row = await getUserById(raw.id);
  if (!row) return null;

  req.session.user = {
    id: row.id,
    username: row.username,
    credits: Number(row.credits || 0)
  };

  req.session.save(() => {});

  return req.session.user;
}

function getRouletteColor(number) {
  if (Number(number) === 0) return "green";
  return ROULETTE_RED_NUMBERS.has(Number(number)) ? "red" : "black";
}

function getRandomRouletteNumber() {
  return Math.floor(Math.random() * 37);
}

// ─── BLACKJACK HELPERS ────────────────────────────────────────────────────────

function bjCreateDeck() {
  const suits = ["\u2660", "\u2665", "\u2666", "\u2663"];
  const values = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck = [];
  for (const suit of suits) for (const value of values) deck.push({ suit, value });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function bjCardNum(card) {
  if (!card || card.hidden) return 0;
  if (["J","Q","K"].includes(card.value)) return 10;
  if (card.value === "A") return 11;
  return Number(card.value);
}

function bjHandValue(hand) {
  let total = 0, aces = 0;
  for (const card of hand) {
    if (card.hidden) continue;
    total += bjCardNum(card);
    if (card.value === "A") aces++;
  }
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}

function bjIsBlackjack(hand) {
  return hand.length === 2 && bjHandValue(hand) === 21;
}

async function bjResolve(game) {
  while (bjHandValue(game.dealerHand) < 17) {
    game.dealerHand.push(game.deck.pop());
  }
  const pv = bjHandValue(game.playerHand);
  const dv = bjHandValue(game.dealerHand);
  let payout = 0, status;
  if (dv > 21)      { status = "dealer_bust"; payout = game.bet * 2; }
  else if (pv > dv) { status = "player_win";  payout = game.bet * 2; }
  else if (dv > pv) { status = "dealer_win";  payout = 0; }
  else              { status = "push";         payout = game.bet; }
  game.status = status;
  game.payout = payout;
  if (payout > 0) {
    const txType = status === "push" ? "blackjack_push" : "blackjack_win";
    game.wallet = await addCreditsTx(
      game.userId, payout, txType,
      `Blackjack ${status}: $${payout.toFixed(2)}`
    );
  }
}

function bjPublicState(game, hideDealer) {
  return {
    playerHand: game.playerHand,
    dealerHand: hideDealer ? [game.dealerHand[0], { hidden: true }] : game.dealerHand,
    playerValue: bjHandValue(game.playerHand),
    dealerValue: hideDealer ? bjCardNum(game.dealerHand[0]) : bjHandValue(game.dealerHand),
    status: game.status,
    bet: game.bet,
    payout: game.payout || 0,
    wallet: game.wallet
  };
}

// ─── MATCHMAKING HELPERS ──────────────────────────────────────────────────────

function mmQueueBroadcast(stake) {
  const q = matchmakingQueue[stake] || [];
  const cd = countdownTimers[stake];
  const secsLeft = cd
    ? Math.max(0, MATCHMAKING_COUNTDOWN_SECS - Math.floor((Date.now() - cd.startedAt) / 1000))
    : null;

  for (const entry of q) {
    const sock = io.sockets.sockets.get(entry.socketId);
    if (!sock) continue;
    sock.emit("matchmakingUpdate", {
      stake,
      queueCount: q.length,
      countdown: secsLeft,
      players: q.map((e) => ({ name: e.name }))
    });
  }
}

function mmCancelCountdown(stake) {
  const cd = countdownTimers[stake];
  if (cd) {
    clearInterval(cd.timer);
    delete countdownTimers[stake];
  }
}

function mmStartCountdown(stake) {
  if (countdownTimers[stake]) return; // already running

  const startedAt = Date.now();
  countdownTimers[stake] = { startedAt, timer: null };

  let secsLeft = MATCHMAKING_COUNTDOWN_SECS;
  mmQueueBroadcast(stake);

  const timer = setInterval(async () => {
    secsLeft--;
    countdownTimers[stake].startedAt = Date.now() - (MATCHMAKING_COUNTDOWN_SECS - secsLeft) * 1000;

    if (matchmakingQueue[stake].length < 2) {
      // Someone left — cancel
      mmCancelCountdown(stake);
      mmQueueBroadcast(stake);
      return;
    }

    if (secsLeft <= 0) {
      clearInterval(timer);
      delete countdownTimers[stake];
      await mmLaunchMatch(stake);
      return;
    }

    mmQueueBroadcast(stake);
  }, 1000);

  countdownTimers[stake].timer = timer;
}

async function mmLaunchMatch(stake) {
  const q = matchmakingQueue[stake] || [];
  if (q.length < 2) return;

  const entries = q.splice(0, q.length); // take all queued players
  matchmakingQueue[stake] = [];

  // Generate a unique match ID shared by all players in this match
  const matchId = Math.random().toString(36).slice(2);

  // ── Phase 1: do ALL async DB work first, before touching the players Map ──
  // This prevents checkMatchEnd from firing mid-launch when only 1 player has
  // been added but the second hasn't been inserted yet (async race condition).
  const readyPlayers = [];

  for (const entry of entries) {
    const sock = io.sockets.sockets.get(entry.socketId);
    if (!sock) continue;

    try {
      const freshUser = await getUserById(entry.userId);
      if (!freshUser || Number(freshUser.credits || 0) < stake) {
        sock.emit("matchmakingCancelled", { reason: "Insufficient balance." });
        continue;
      }

      const wallet = await spendCreditsTx(
        entry.userId, stake, "game_entry",
        `Entered a match with $${stake.toFixed(2)}`
      );

      const req = sock.request;
      if (req?.session?.user) {
        req.session.user.credits = wallet;
        req.session.gameEntryReady = false;
        req.session.gameEntryStake = null;
        req.session.save(() => {});
      }

      const player = createHumanPlayer(sock.id, { id: entry.userId, username: entry.username }, {
        name: entry.name,
        color: entry.color
      });
      player.cashValue = stake;
      player.stake = stake;
      player.matchId = matchId;
      player._cachedWallet = wallet; // pre-seed so first snapshot skips DB fetch

      readyPlayers.push({ player, sock, wallet });
    } catch (err) {
      console.error("MM LAUNCH ERROR for", entry.name, err);
      const sock2 = io.sockets.sockets.get(entry.socketId);
      sock2?.emit("matchmakingCancelled", { reason: "Failed to enter match." });
    }
  }

  // If fewer than 2 players survived validation, abort — don't start a solo match.
  if (readyPlayers.length < 2) {
    for (const { sock } of readyPlayers) {
      sock.emit("matchmakingCancelled", { reason: "Not enough players could be verified." });
    }
    return;
  }

  // Stamp the final confirmed match size on every player now that we know it
  const matchSize = readyPlayers.length;
  for (const { player } of readyPlayers) {
    player.matchSize = matchSize;
  }

  // ── Phase 2: atomically insert all players into the live Map at once ──
  // Reset world and bots fresh for this match, then mark the match as active.
  // From this point on checkMatchEnd will see the correct player count immediately.
  resetWorldObjects();
  bots.length = 0;
  respawnMissingBots();
  matchActive = true;

  for (const { player, sock, wallet } of readyPlayers) {
    players.set(sock.id, player);
    playerByUserId.set(player.userId, sock.id);
    socketsByUserId.set(player.userId, sock.id);

    sock.emit("matchmakingJoined", { wallet });
    sock.emit("chatHistory", chatMessages);
    sock.emit("joined", { ok: true, wallet });

    addChatMessage("SERVER", `${player.name} joined the game`);
  }
}

// Check if only 1 human player remains in an active match and auto-extract them
async function checkMatchEnd() {
  if (!matchActive) return;
  const humanPlayers = [...players.values()];
  if (humanPlayers.length !== 1) return;

  const winner = humanPlayers[0];
  // Only auto-extract if they have cash on the line (i.e. they're in a real match)
  if (!winner || Number(winner.cashValue || 0) <= 0) return;

  // Only fire if this player was part of a real multi-player match (matchSize >= 2).
  if (!winner.matchId || Number(winner.matchSize || 1) < 2) return;

  // Collect all remaining cashValue sitting inside bots and award it to the winner
  let botPool = 0;
  for (const bot of bots) {
    botPool += Number(bot.cashValue || 0);
    bot.cashValue = 0;
  }
  if (botPool > 0) {
    winner.cashValue = Number(winner.cashValue || 0) + botPool;
    console.log(`Match end: added $${botPool.toFixed(2)} from bots to winner ${winner.name}`);
  }

  // Mark match over so bots stop running and tick goes idle
  matchActive = false;

  console.log(`Match ended -- winner: ${winner.name}, cashValue: $${winner.cashValue.toFixed(2)}`);
  await completeExtraction(winner, true);
}

async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: "You must be logged in." });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err);
    res.status(500).json({ error: "Authentication failed." });
  }
}

async function areFriends(userIdA, userIdB) {
  const a = Math.min(Number(userIdA), Number(userIdB));
  const b = Math.max(Number(userIdA), Number(userIdB));

  const { rows } = await pool.query(
    `SELECT id FROM friends WHERE user_a = $1 AND user_b = $2 LIMIT 1`,
    [a, b]
  );

  return !!rows[0];
}

function sendFriendNotificationToUser(userId, payload) {
  const socketId = socketsByUserId.get(Number(userId));
  if (!socketId) return;

  const sock = io.sockets.sockets.get(socketId);
  if (!sock) return;

  sock.emit("friendNotification", payload);
}

function sendPrivateMessageToUser(userId, payload) {
  const socketId = socketsByUserId.get(Number(userId));
  if (!socketId) return;

  const sock = io.sockets.sockets.get(socketId);
  if (!sock) return;

  sock.emit("privateMessage", payload);
}

function getMusicPlaylist() {
  try {
    if (!fs.existsSync(AUDIO_DIR)) {
      return [];
    }

    const files = fs
      .readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase().endsWith(".mp3"))
      .sort((a, b) => a.localeCompare(b));

    return files.map((filename, index) => ({
      id: index + 1,
      title: filename.replace(/\.mp3$/i, ""),
      filename,
      url: `/audio/${encodeURIComponent(filename)}`
    }));
  } catch (err) {
    console.error("MUSIC PLAYLIST ERROR:", err);
    return [];
  }
}

app.get("/api/music/playlist", (req, res) => {
  res.json({
    ok: true,
    items: getMusicPlaylist()
  });
});

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: "Username must be 3-20 characters." });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: "Username already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = await createUserWithBonus(username, passwordHash);
    const user = await getUserById(userId);

    const sessionUser = {
      id: user.id,
      username: user.username,
      credits: Number(user.credits || 0)
    };

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error("REGISTER SESSION REGENERATE ERROR:", regenErr);
        return res.json({ ok: true, user: sessionUser, bonusCredits: REGISTER_BONUS });
      }

      req.session.user = sessionUser;
      req.session.gameEntryReady = false;
      req.session.gameEntryStake = null;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("REGISTER SESSION SAVE ERROR:", saveErr);
          return res.json({ ok: true, user: sessionUser, bonusCredits: REGISTER_BONUS });
        }

        res.json({ ok: true, user: req.session.user, bonusCredits: REGISTER_BONUS });
      });
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: "Failed to register." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const sessionUser = {
      id: user.id,
      username: user.username,
      credits: Number(user.credits || 0)
    };

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error("LOGIN SESSION REGENERATE ERROR:", regenErr);
        return res.status(500).json({ error: "Failed to log in." });
      }

      req.session.user = sessionUser;
      req.session.gameEntryReady = false;
      req.session.gameEntryStake = null;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("LOGIN SESSION SAVE ERROR:", saveErr);
          return res.status(500).json({ error: "Failed to log in." });
        }

        res.json({ ok: true, user: req.session.user });
      });
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Failed to log in." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", async (req, res) => {
  try {
    const user = await getSessionUser(req);
    res.json({ user: user || null });
  } catch (err) {
    console.error("ME ERROR:", err);
    res.status(500).json({ user: null });
  }
});

app.get("/api/balance", requireAuth, (req, res) => {
  res.json({ ok: true, wallet: Number(req.user.credits || 0) });
});

// Outside bet types and their payout multipliers (stake returned + multiplier * stake)
const OUTSIDE_BET_TYPES = new Set([
  "red","black","odd","even","low","high",
  "dozen1","dozen2","dozen3","col1","col2","col3"
]);
const ROULETTE_MAX_OUTSIDE_BET = 20;

function resolveOutsideBet(betType, n) {
  const redNums = ROULETTE_RED_NUMBERS;
  if (n === 0) return 0; // zero loses all outside bets
  switch (betType) {
    case "red":    return redNums.has(n) ? 2 : 0;
    case "black":  return !redNums.has(n) ? 2 : 0;
    case "odd":    return n % 2 === 1 ? 2 : 0;
    case "even":   return n % 2 === 0 ? 2 : 0;
    case "low":    return n >= 1 && n <= 18 ? 2 : 0;
    case "high":   return n >= 19 && n <= 36 ? 2 : 0;
    case "dozen1": return n >= 1  && n <= 12 ? 3 : 0;
    case "dozen2": return n >= 13 && n <= 24 ? 3 : 0;
    case "dozen3": return n >= 25 && n <= 36 ? 3 : 0;
    case "col1":   return n % 3 === 1 ? 3 : 0;
    case "col2":   return n % 3 === 2 ? 3 : 0;
    case "col3":   return n % 3 === 0 ? 3 : 0;
    default: return 0;
  }
}

app.post("/api/casino/roulette/spin", requireAuth, async (req, res) => {
  try {
    // bets: Array of { number: 0-36, amount } OR { type:"outside", bet: string, amount }
    const bets = req.body?.bets;
    if (!Array.isArray(bets) || bets.length === 0) {
      return res.status(400).json({ error: "Place at least one bet." });
    }

    // Validate all bets and compute total stake
    const perNumberTotals = new Map();
    const perOutsideTotals = new Map();
    let totalStake = 0;

    for (const bet of bets) {
      const amt = Number(bet.amount);
      if (!ROULETTE_ALLOWED_CHIP_VALUES.has(amt)) {
        return res.status(400).json({ error: `Invalid chip value: ${amt}` });
      }

      if (bet.type === "outside") {
        const betKey = String(bet.bet || "");
        if (!OUTSIDE_BET_TYPES.has(betKey)) {
          return res.status(400).json({ error: `Invalid outside bet: ${betKey}` });
        }
        const prev = perOutsideTotals.get(betKey) || 0;
        if (prev + amt > ROULETTE_MAX_OUTSIDE_BET) {
          return res.status(400).json({ error: `Max $${ROULETTE_MAX_OUTSIDE_BET} per outside bet.` });
        }
        perOutsideTotals.set(betKey, prev + amt);
      } else {
        const num = Number(bet.number);
        if (!Number.isInteger(num) || num < 0 || num > 36) {
          return res.status(400).json({ error: `Invalid number: ${num}` });
        }
        const prev = perNumberTotals.get(num) || 0;
        if (prev + amt > ROULETTE_MAX_PER_NUMBER) {
          return res.status(400).json({ error: `Max $${ROULETTE_MAX_PER_NUMBER} per number.` });
        }
        perNumberTotals.set(num, prev + amt);
      }
      totalStake += amt;
    }
    totalStake = Number(totalStake.toFixed(2));
    if (totalStake > ROULETTE_MAX_TOTAL_BET) {
      return res.status(400).json({ error: `Max total bet is $${ROULETTE_MAX_TOTAL_BET}.` });
    }

    let wallet = await spendCreditsTx(
      req.user.id, totalStake, "roulette_bet",
      `Roulette spin: $${totalStake} across ${bets.length} bet(s)`
    );

    const winningNumber = getRandomRouletteNumber();
    const winningColor = getRouletteColor(winningNumber);

    // Calculate winnings
    let totalPayout = 0;
    const betResults = bets.map((bet) => {
      const amt = Number(bet.amount);
      let payout = 0;
      let won = false;

      if (bet.type === "outside") {
        const multiplier = resolveOutsideBet(String(bet.bet), winningNumber);
        payout = Number((amt * multiplier).toFixed(2));
        won = payout > 0;
      } else {
        const num = Number(bet.number);
        won = num === winningNumber;
        payout = won ? Number((amt * 36).toFixed(2)) : 0;
      }

      totalPayout += payout;
      return { ...bet, won, payout };
    });
    totalPayout = Number(totalPayout.toFixed(2));

    if (totalPayout > 0) {
      wallet = await addCreditsTx(
        req.user.id, totalPayout, "roulette_win",
        `Roulette win on ${winningNumber} (${winningColor}): +$${totalPayout}`
      );
    }

    req.session.user.credits = wallet;
    req.session.save(() => {});

    res.json({
      ok: true,
      wallet,
      totalStake,
      winningNumber,
      winningColor,
      totalPayout,
      profit: Number((totalPayout - totalStake).toFixed(2)),
      betResults
    });
  } catch (err) {
    if (err?.code === "INSUFFICIENT_CREDITS") {
      return res.status(400).json({ error: "Not enough balance." });
    }
    console.error("ROULETTE SPIN ERROR:", err);
    res.status(500).json({ error: "Failed to spin roulette." });
  }
});


// ─── BLACKJACK ROUTES ─────────────────────────────────────────────────────────

app.post("/api/casino/blackjack/start", requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!BLACKJACK_ALLOWED_BET_AMOUNTS.has(amount)) {
      return res.status(400).json({ error: "Blackjack bets must be between $1 and $5." });
    }
    const existing = blackjackGames.get(req.user.id);
    if (existing && existing.status === "playing") {
      return res.status(400).json({ error: "Finish your current hand first." });
    }
    const wallet = await spendCreditsTx(req.user.id, amount, "blackjack_bet", `Blackjack bet $${amount}`);
    const deck = bjCreateDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];
    const game = { userId: req.user.id, bet: amount, deck, playerHand, dealerHand, status: "playing", wallet, payout: 0 };

    if (bjIsBlackjack(playerHand)) {
      if (bjIsBlackjack(dealerHand)) {
        game.wallet = await addCreditsTx(req.user.id, amount, "blackjack_push", "Blackjack push");
        game.status = "push"; game.payout = amount;
      } else {
        const payout = Math.round(amount * 2.5);
        game.wallet = await addCreditsTx(req.user.id, payout, "blackjack_win", `Blackjack! $${payout}`);
        game.status = "blackjack"; game.payout = payout;
      }
    }

    blackjackGames.set(req.user.id, game);
    req.session.user.credits = game.wallet;
    res.json({ ok: true, ...bjPublicState(game, game.status === "playing") });
  } catch (err) {
    if (err?.code === "INSUFFICIENT_CREDITS") return res.status(400).json({ error: "Not enough balance." });
    console.error("BLACKJACK START ERROR:", err);
    res.status(500).json({ error: "Failed to start game." });
  }
});

app.post("/api/casino/blackjack/hit", requireAuth, async (req, res) => {
  try {
    const game = blackjackGames.get(req.user.id);
    if (!game || game.status !== "playing") return res.status(400).json({ error: "No active game." });
    game.playerHand.push(game.deck.pop());
    const pv = bjHandValue(game.playerHand);
    if (pv > 21) { game.status = "player_bust"; game.payout = 0; }
    else if (pv === 21) { await bjResolve(game); }
    req.session.user.credits = game.wallet;
    req.session.save(() => {});
    res.json({ ok: true, ...bjPublicState(game, game.status === "playing") });
  } catch (err) {
    console.error("BLACKJACK HIT ERROR:", err);
    res.status(500).json({ error: "Failed to process hit." });
  }
});

app.post("/api/casino/blackjack/stand", requireAuth, async (req, res) => {
  try {
    const game = blackjackGames.get(req.user.id);
    if (!game || game.status !== "playing") return res.status(400).json({ error: "No active game." });
    await bjResolve(game);
    req.session.user.credits = game.wallet;
    req.session.save(() => {});
    res.json({ ok: true, ...bjPublicState(game, false) });
  } catch (err) {
    console.error("BLACKJACK STAND ERROR:", err);
    res.status(500).json({ error: "Failed to process stand." });
  }
});

app.post("/api/casino/blackjack/double", requireAuth, async (req, res) => {
  try {
    const game = blackjackGames.get(req.user.id);
    if (!game || game.status !== "playing") return res.status(400).json({ error: "No active game." });
    if (game.playerHand.length !== 2) return res.status(400).json({ error: "Can only double on the first two cards." });
    const freshUser = await getUserById(req.user.id);
    if (Number(freshUser?.credits || 0) < game.bet) return res.status(400).json({ error: "Not enough balance to double down." });
    game.wallet = await spendCreditsTx(req.user.id, game.bet, "blackjack_double", `Blackjack double down $${game.bet}`);
    game.bet *= 2;
    game.playerHand.push(game.deck.pop());
    const pv = bjHandValue(game.playerHand);
    if (pv > 21) { game.status = "player_bust"; game.payout = 0; }
    else { await bjResolve(game); }
    req.session.user.credits = game.wallet;
    res.json({ ok: true, ...bjPublicState(game, false) });
  } catch (err) {
    if (err?.code === "INSUFFICIENT_CREDITS") return res.status(400).json({ error: "Not enough balance to double down." });
    console.error("BLACKJACK DOUBLE ERROR:", err);
    res.status(500).json({ error: "Failed to process double." });
  }
});

app.get("/api/leaderboard/wallet", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT username, credits
      FROM users
      ORDER BY credits DESC, username ASC
      LIMIT 10
    `);

    res.json({
      ok: true,
      items: rows.map((row) => ({
        name: row.username,
        wallet: Number(row.credits || 0)
      }))
    });
  } catch (err) {
    console.error("WALLET LEADERBOARD ERROR:", err);
    res.status(500).json({ error: "Failed to load wallet leaderboard." });
  }
});

app.get("/api/credits/history", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, type, amount, note, created_at
      FROM credit_transactions
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 50
      `,
      [req.user.id]
    );

    res.json({
      ok: true,
      items: rows.map((row) => ({
        id: Number(row.id),
        type: row.type,
        amount: Number(row.amount),
        note: row.note,
        created_at: row.created_at
      }))
    });
  } catch (err) {
    console.error("CREDITS HISTORY ERROR:", err);
    res.status(500).json({ error: "Failed to load history." });
  }
});

app.post("/api/credits/add", requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount." });
    }

    const wallet = await addCreditsTx(
      req.user.id,
      amount,
      "manual_add",
      "Manual wallet top-up"
    );

    req.session.user.credits = wallet;
    req.session.save(() => {});
    res.json({ ok: true, wallet });
  } catch (err) {
    console.error("ADD CREDITS ERROR:", err);
    res.status(500).json({ error: "Failed to add balance." });
  }
});

app.post("/api/credits/withdraw", requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);
    const address = String(req.body?.address || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount." });
    }

    if (!address) {
      return res.status(400).json({ error: "Missing Solana wallet address." });
    }

    const wallet = await spendCreditsTx(
      req.user.id,
      amount,
      "withdraw_request",
      `Withdrawal request to ${address}`
    );

    req.session.user.credits = wallet;
    req.session.save(() => {});
    res.json({ ok: true, wallet, status: "requested" });
  } catch (err) {
    if (err.code === "INSUFFICIENT_CREDITS") {
      return res.status(400).json({ error: "Not enough balance." });
    }

    console.error("WITHDRAW ERROR:", err);
    res.status(500).json({ error: "Failed to create withdrawal request." });
  }
});

// ─── SOLANA WALLET ROUTES ─────────────────────────────────────────────────────
mountSolanaRoutes(app, pool, {
  requireAuth,
  addCreditsTx,
  spendCreditsTx,
  notifyUser,
});

app.get("/api/friends/search", requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ ok: true, items: [] });

    const { rows } = await pool.query(
      `
      SELECT id, username
      FROM users
      WHERE username ILIKE $1
        AND id <> $2
      ORDER BY username ASC
      LIMIT 10
      `,
      [`%${q}%`, req.user.id]
    );

    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        username: r.username
      }))
    });
  } catch (err) {
    console.error("FRIEND SEARCH ERROR:", err);
    res.status(500).json({ error: "Failed to search users." });
  }
});

app.get("/api/friends/list", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT u.id, u.username
      FROM friends f
      JOIN users u
        ON u.id = CASE
          WHEN f.user_a = $1 THEN f.user_b
          ELSE f.user_a
        END
      WHERE f.user_a = $1 OR f.user_b = $1
      ORDER BY u.username ASC
      `,
      [req.user.id]
    );

    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        username: r.username
      }))
    });
  } catch (err) {
    console.error("FRIENDS LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load friends." });
  }
});

app.get("/api/friends/requests", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT fr.id, u.username AS from_username
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      `,
      [req.user.id]
    );

    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        fromUsername: r.from_username
      }))
    });
  } catch (err) {
    console.error("GET FRIEND REQUESTS ERROR:", err);
    res.status(500).json({ error: "Failed to load friend requests." });
  }
});

app.post("/api/friends/request", requireAuth, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!username) {
      return res.status(400).json({ error: "Missing username." });
    }

    const target = await getUserByUsername(username);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }

    if (Number(target.id) === Number(req.user.id)) {
      return res.status(400).json({ error: "You cannot add yourself." });
    }

    const a = Math.min(req.user.id, target.id);
    const b = Math.max(req.user.id, target.id);

    const alreadyFriends = await pool.query(
      `SELECT id FROM friends WHERE user_a = $1 AND user_b = $2`,
      [a, b]
    );

    if (alreadyFriends.rows[0]) {
      return res.status(400).json({ error: "Already friends." });
    }

    await pool.query(
      `
      INSERT INTO friend_requests (from_user_id, to_user_id, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT (from_user_id, to_user_id)
      DO UPDATE SET status = 'pending'
      `,
      [req.user.id, target.id]
    );

    sendFriendNotificationToUser(target.id, {
      type: "friend_request",
      fromUsername: req.user.username
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("SEND FRIEND REQUEST ERROR:", err);
    res.status(500).json({ error: "Failed to send friend request." });
  }
});

app.post("/api/friends/accept", requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const requestId = Number(req.body?.requestId || 0);
    if (!requestId) {
      return res.status(400).json({ error: "Invalid request id." });
    }

    await client.query("BEGIN");

    const reqRow = await client.query(
      `
      SELECT *
      FROM friend_requests
      WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
      FOR UPDATE
      `,
      [requestId, req.user.id]
    );

    const fr = reqRow.rows[0];
    if (!fr) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Friend request not found." });
    }

    const a = Math.min(Number(fr.from_user_id), Number(fr.to_user_id));
    const b = Math.max(Number(fr.from_user_id), Number(fr.to_user_id));

    await client.query(
      `
      INSERT INTO friends (user_a, user_b)
      VALUES ($1, $2)
      ON CONFLICT (user_a, user_b) DO NOTHING
      `,
      [a, b]
    );

    await client.query(
      `UPDATE friend_requests SET status = 'accepted' WHERE id = $1`,
      [requestId]
    );

    await client.query("COMMIT");

    sendFriendNotificationToUser(Number(fr.from_user_id), {
      type: "friend_accept",
      fromUsername: req.user.username
    });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ACCEPT FRIEND REQUEST ERROR:", err);
    res.status(500).json({ error: "Failed to accept friend request." });
  } finally {
    client.release();
  }
});

app.post("/api/friends/deny", requireAuth, async (req, res) => {
  try {
    const requestId = Number(req.body?.requestId || 0);
    if (!requestId) {
      return res.status(400).json({ error: "Invalid request id." });
    }

    await pool.query(
      `
      UPDATE friend_requests
      SET status = 'denied'
      WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
      `,
      [requestId, req.user.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("DENY FRIEND REQUEST ERROR:", err);
    res.status(500).json({ error: "Failed to deny request." });
  }
});

app.post("/api/friends/remove", requireAuth, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!username) {
      return res.status(400).json({ error: "Missing username." });
    }

    const target = await getUserByUsername(username);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }

    const a = Math.min(req.user.id, target.id);
    const b = Math.max(req.user.id, target.id);

    await pool.query(
      `DELETE FROM friends WHERE user_a = $1 AND user_b = $2`,
      [a, b]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("REMOVE FRIEND ERROR:", err);
    res.status(500).json({ error: "Failed to remove friend." });
  }
});

app.get("/api/private-messages/:username", requireAuth, async (req, res) => {
  try {
    const targetUsername = String(req.params.username || "").trim();
    if (!targetUsername) {
      return res.status(400).json({ error: "Missing username." });
    }

    const target = await getUserByUsername(targetUsername);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }

    // Allow reading history regardless of friend status (history persists after unfriend)
    const { rows } = await pool.query(
      `
      SELECT pm.id, pm.from_user_id, pm.to_user_id, pm.message, pm.created_at,
             fu.username AS from_username,
             tu.username AS to_username
      FROM private_messages pm
      JOIN users fu ON fu.id = pm.from_user_id
      JOIN users tu ON tu.id = pm.to_user_id
      WHERE
        (pm.from_user_id = $1 AND pm.to_user_id = $2)
        OR
        (pm.from_user_id = $2 AND pm.to_user_id = $1)
      ORDER BY pm.created_at ASC
      LIMIT 100
      `,
      [req.user.id, target.id]
    );

    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: Number(r.id),
        fromUserId: Number(r.from_user_id),
        toUserId: Number(r.to_user_id),
        fromUsername: r.from_username,
        toUsername: r.to_username,
        message: r.message,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    console.error("GET PRIVATE MESSAGES ERROR:", err);
    res.status(500).json({ error: "Failed to load conversation." });
  }
});

app.post("/api/private-messages/send", requireAuth, async (req, res) => {
  try {
    const toUsername = String(req.body?.toUsername || "").trim();
    const message = String(req.body?.message || "").trim().slice(0, 500);

    if (!toUsername) {
      return res.status(400).json({ error: "Missing username." });
    }

    if (!message) {
      return res.status(400).json({ error: "Message cannot be empty." });
    }

    const target = await getUserByUsername(toUsername);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }

    const friends = await areFriends(req.user.id, target.id);
    if (!friends) {
      return res.status(403).json({ error: "You can only message friends." });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO private_messages (from_user_id, to_user_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, created_at
      `,
      [req.user.id, target.id, message]
    );

    const payload = {
      id: Number(rows[0].id),
      fromUserId: Number(req.user.id),
      toUserId: Number(target.id),
      fromUsername: req.user.username,
      toUsername: target.username,
      message,
      createdAt: rows[0].created_at
    };

    sendPrivateMessageToUser(target.id, payload);

    res.json({
      ok: true,
      item: payload
    });
  } catch (err) {
    console.error("SEND PRIVATE MESSAGE ERROR:", err);
    res.status(500).json({ error: "Failed to send message." });
  }
});

app.post("/api/game/enter", requireAuth, async (req, res) => {
  try {
    const freshUser = await getUserById(req.user.id);
    if (!freshUser) {
      return res.status(404).json({ error: "User not found." });
    }

    const requestedStake = Number(req.body?.stake || 1);

    if (!ALLOWED_STAKES.includes(requestedStake)) {
      return res.status(400).json({ error: "Invalid amount selected." });
    }

    // Already in active game
    const existingSocketId = playerByUserId.get(req.user.id);
    if (existingSocketId && players.has(existingSocketId)) {
      return res.json({
        ok: true,
        alreadyInGame: true,
        wallet: Number(freshUser.credits || 0)
      });
    }

    if (Number(freshUser.credits || 0) < requestedStake) {
      return res.status(400).json({
        error: `You need at least $${requestedStake.toFixed(2)} to play with that amount.`
      });
    }

    // Store on session so socket "join" event can use it after matchmaking
    req.session.gameEntryReady = true;
    req.session.gameEntryStake = requestedStake;

    req.session.save((err) => {
      if (err) {
        console.error("SESSION SAVE ERROR:", err);
        return res.status(500).json({ error: "Failed to save game session." });
      }

      res.json({
        ok: true,
        wallet: Number(freshUser.credits || 0),
        cost: requestedStake,
        matchmaking: true
      });
    });
  } catch (err) {
    console.error("GAME ENTER ERROR:", err);
    res.status(500).json({ error: "Failed to enter the game." });
  }
});

app.post("/api/game/cancel", requireAuth, (req, res) => {
  const userId = Number(req.user.id);
  for (const stake of ALLOWED_STAKES) {
    const q = matchmakingQueue[stake];
    const idx = q.findIndex((e) => e.userId === userId);
    if (idx !== -1) {
      q.splice(idx, 1);
      // Cancel countdown if < 2 players left
      if (q.length < 2) mmCancelCountdown(stake);
      mmQueueBroadcast(stake);
      break;
    }
  }
  res.json({ ok: true });
});

app.get("/debug/players", (req, res) => {
  res.json({
    playerCount: players.size,
    botCount: bots.length,
    players: [...players.values()].map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.name,
      totalMass: Math.round(totalMass(p)),
      cashValue: Number(p.cashValue || 0),
      extracting: !!p.extracting,
      extractTicks: Number(p.extractTicks || 0),
      cells: p.cells.length
    })),
    bots: bots.map((b) => ({
      id: b.id,
      name: b.name,
      totalMass: Math.round(totalMass(b)),
      cashValue: Number(b.cashValue || 0),
      cells: b.cells.length
    })),
    food: food.length,
    chatMessages: chatMessages.length,
    musicTracks: getMusicPlaylist().length
  });
});

function resetWorldObjects() {
  food.length = 0;
  viruses.length = 0;

  for (let i = 0; i < FOOD_COUNT; i++) {
    food.push(createFood());
  }

  for (let i = 0; i < VIRUS_COUNT; i++) {
    viruses.push(createVirus());
  }
}

function respawnMissingBots() {
  while (bots.length < BOT_COUNT) {
    bots.push(createBot(bots.length));
  }
}

function moveEntity(entity) {
  if (entity.extracting) {
    for (const cell of entity.cells) {
      cell.vx *= 0.6;
      cell.vy *= 0.6;
      cell.x += cell.vx;
      cell.y += cell.vy;

      if (cell.mergeTimer > 0) cell.mergeTimer--;
    }

    for (const cell of entity.cells) {
      const r = radiusFromMass(cell.mass);
      const clamped = clampToWorldCircle(cell.x, cell.y, r);
      cell.x = clamped.x;
      cell.y = clamped.y;
    }

    return;
  }

  for (const cell of entity.cells) {
    const speed = 3.6 / Math.pow(cell.mass, 0.16);
    const len = Math.hypot(entity.mouse.x, entity.mouse.y) || 1;
    const dirX = entity.mouse.x / len;
    const dirY = entity.mouse.y / len;
    const distFactor = Math.min(len / 180, 1);

    cell.vx += dirX * speed * distFactor;
    cell.vy += dirY * speed * distFactor;

    cell.vx *= 0.84;
    cell.vy *= 0.84;

    cell.x += cell.vx;
    cell.y += cell.vy;

    if (cell.mergeTimer > 0) cell.mergeTimer--;
  }

  for (let i = 0; i < entity.cells.length; i++) {
    for (let j = i + 1; j < entity.cells.length; j++) {
      const a = entity.cells[i];
      const b = entity.cells[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;

      const ar = radiusFromMass(a.mass);
      const br = radiusFromMass(b.mass);
      const desiredSeparation = (ar + br) * TOUCH_SEPARATION_FACTOR;

      if (d < desiredSeparation) {
        const push = (desiredSeparation - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;

        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;

        const relVx = b.vx - a.vx;
        const relVy = b.vy - a.vy;
        const inwardSpeed = relVx * nx + relVy * ny;

        if (inwardSpeed < 0) {
          const correction = inwardSpeed * 0.5;
          a.vx += nx * correction;
          a.vy += ny * correction;
          b.vx -= nx * correction;
          b.vy -= ny * correction;
        }
      }

      if (d > desiredSeparation) {
        const nx = dx / d;
        const ny = dy / d;
        const attraction =
          a.mergeTimer > 0 || b.mergeTimer > 0
            ? PREMERGE_ATTRACTION_FACTOR
            : POSTMERGE_ATTRACTION_FACTOR;

        a.vx += nx * attraction;
        a.vy += ny * attraction;
        b.vx -= nx * attraction;
        b.vy -= ny * attraction;
      }
    }
  }

  for (const cell of entity.cells) {
    const r = radiusFromMass(cell.mass);
    const clamped = clampToWorldCircle(cell.x, cell.y, r);
    cell.x = clamped.x;
    cell.y = clamped.y;
  }
}

function updateExtraction(entity) {
  if (!isHuman(entity)) return;
  if (!entity.cells.length) return;

  if (entity.wantsExtract) {
    entity.extracting = true;
    entity.extractTicks += 1;
    entity.mouse.x = 0;
    entity.mouse.y = 0;
    entity.wantsSplit = false;
    entity.wantsEject = false;
  } else {
    entity.extracting = false;
    entity.extractTicks = 0;
  }
}

function splitEntity(entity) {
  if (!entity.wantsSplit || entity.extracting) return;
  entity.wantsSplit = false;

  if (entity.cells.length >= MAX_CELLS) return;

  const len = Math.hypot(entity.mouse.x, entity.mouse.y) || 1;
  const dirX = entity.mouse.x / len;
  const dirY = entity.mouse.y / len;
  const newCells = [];

  for (const cell of entity.cells) {
    if (cell.mass < 36) continue;
    if (entity.cells.length + newCells.length >= MAX_CELLS) break;

    const childMass = cell.mass / 2;
    cell.mass = childMass;

    const r = radiusFromMass(childMass);
    const spawnDistance = r * 3.4;

    newCells.push({
      x: cell.x + dirX * spawnDistance,
      y: cell.y + dirY * spawnDistance,
      mass: childMass,
      vx: dirX * SPLIT_LAUNCH_SPEED,
      vy: dirY * SPLIT_LAUNCH_SPEED,
      mergeTimer: SPLIT_MERGE_DELAY_TICKS
    });

    cell.vx -= dirX * 4;
    cell.vy -= dirY * 4;
    cell.mergeTimer = SPLIT_MERGE_DELAY_TICKS;
  }

  entity.cells.push(...newCells);
}

function ejectMass(entity) {
  if (!entity.wantsEject || entity.extracting) return;
  entity.wantsEject = false;

  const len = Math.hypot(entity.mouse.x, entity.mouse.y) || 1;
  const dirX = entity.mouse.x / len;
  const dirY = entity.mouse.y / len;

  for (const cell of entity.cells) {
    if (cell.mass <= EJECT_ORB_MASS + 10) continue;

    cell.mass -= EJECT_ORB_MASS;

    const rawX = cell.x + dirX * (radiusFromMass(cell.mass) + EJECT_LAUNCH_DISTANCE);
    const rawY = cell.y + dirY * (radiusFromMass(cell.mass) + EJECT_LAUNCH_DISTANCE);
    const clamped = clampToWorldCircle(rawX, rawY, EJECT_ORB_RADIUS);

    food.push({
      id: Math.random().toString(36).slice(2),
      x: clamped.x,
      y: clamped.y,
      vx: dirX * EJECT_LAUNCH_SPEED,
      vy: dirY * EJECT_LAUNCH_SPEED,
      r: EJECT_ORB_RADIUS,
      color: entity.color,
      mass: EJECT_ORB_MASS
    });
  }
}

function moveEjectedFood() {
  for (const f of food) {
    if (typeof f.vx !== "number" || typeof f.vy !== "number") continue;

    f.x += f.vx;
    f.y += f.vy;

    f.vx *= 0.92;
    f.vy *= 0.92;

    const clamped = clampToWorldCircle(f.x, f.y, f.r || 8);
    f.x = clamped.x;
    f.y = clamped.y;

    if (Math.abs(f.vx) < 0.05) f.vx = 0;
    if (Math.abs(f.vy) < 0.05) f.vy = 0;
  }
}

function handleFoodEating(entity) {
  let botRemainingFoodGrowth = Infinity;

  if (isBot(entity)) {
    const currentMass = totalMass(entity);
    botRemainingFoodGrowth = Math.max(0, BOT_FOOD_CAP - currentMass);

    if (botRemainingFoodGrowth <= 0) {
      while (food.length < FOOD_COUNT) {
        food.push(createFood());
      }
      return;
    }
  }

  for (const cell of entity.cells) {
    const r = radiusFromMass(cell.mass);

    for (let i = food.length - 1; i >= 0; i--) {
      if (isBot(entity) && botRemainingFoodGrowth <= 0) break;

      const f = food[i];
      const fr = typeof f.r === "number" ? f.r : 8;
      const quickRange = r + fr + 24;

      if (Math.abs(cell.x - f.x) > quickRange || Math.abs(cell.y - f.y) > quickRange) {
        continue;
      }

      const eatDistSq = (r + fr) * (r + fr);

      if (distanceSq(cell.x, cell.y, f.x, f.y) < eatDistSq) {
        if (isBot(entity)) {
          const gain = Math.min(f.mass, botRemainingFoodGrowth);
          if (gain <= 0) continue;
          cell.mass += gain;
          botRemainingFoodGrowth -= gain;
        } else {
          cell.mass += f.mass;
        }

        food.splice(i, 1);
      }
    }
  }

  while (food.length < FOOD_COUNT) {
    food.push(createFood());
  }
}

function splitByVirus(entity, cellIndex, virusIndex) {
  const cell = entity.cells[cellIndex];
  if (!cell) return;
  if (entity.cells.length >= MAX_CELLS) return;

  const piecesWanted = Math.min(
    MAX_CELLS - entity.cells.length + 1,
    Math.max(2, Math.min(8, Math.floor(cell.mass / 18)))
  );

  if (piecesWanted < 2) return;

  const partMass = cell.mass / piecesWanted;
  cell.mass = partMass;
  cell.mergeTimer = SPLIT_MERGE_DELAY_TICKS;

  for (let i = 1; i < piecesWanted; i++) {
    const ang = (Math.PI * 2 * i) / piecesWanted;
    entity.cells.push({
      x: cell.x + Math.cos(ang) * 35,
      y: cell.y + Math.sin(ang) * 35,
      mass: partMass,
      vx: Math.cos(ang) * 22,
      vy: Math.sin(ang) * 22,
      mergeTimer: SPLIT_MERGE_DELAY_TICKS
    });
  }

  viruses.splice(virusIndex, 1);
  viruses.push(createVirus());
}

function handleVirusCollisions(entity) {
  for (let v = viruses.length - 1; v >= 0; v--) {
    const virus = viruses[v];

    for (let c = entity.cells.length - 1; c >= 0; c--) {
      const cell = entity.cells[c];
      const r = radiusFromMass(cell.mass);

      if (
        cell.mass >= 36 &&
        distance(cell.x, cell.y, virus.x, virus.y) < r - virus.r * 0.15
      ) {
        splitByVirus(entity, c, v);
        break;
      }
    }
  }
}

function handleSelfMerge(entity) {
  if (entity.cells.length <= 1) return;

  for (let i = 0; i < entity.cells.length; i++) {
    for (let j = i + 1; j < entity.cells.length; j++) {
      const a = entity.cells[i];
      const b = entity.cells[j];

      if (a.mergeTimer > 0 || b.mergeTimer > 0) continue;

      const d = distance(a.x, a.y, b.x, b.y);
      const ar = radiusFromMass(a.mass);
      const br = radiusFromMass(b.mass);

      if (d <= ar + br + 1) {
        a.mass += b.mass;
        a.vx = (a.vx + b.vx) * 0.5;
        a.vy = (a.vy + b.vy) * 0.5;
        entity.cells.splice(j, 1);
        j--;
      }
    }
  }
}

function botThink(bot) {
  if (!bot.cells.length) return;

  const center = entityCenter(bot);
  const botMass = totalMass(bot);

  let moveX = rand(-100, 100);
  let moveY = rand(-100, 100);

  for (const player of players.values()) {
    if (!player.cells.length) continue;

    const pc = entityCenter(player);
    const d = distance(center.x, center.y, pc.x, pc.y);
    const playerMass = totalMass(player);

    if (playerMass > botMass * 1.08 && d < 1300) {
      moveX += (center.x - pc.x) * 2.4;
      moveY += (center.y - pc.y) * 2.4;
    }
  }

  for (const other of bots) {
    if (other.id === bot.id || !other.cells.length) continue;

    const oc = entityCenter(other);
    const d = distance(center.x, center.y, oc.x, oc.y) || 1;
    const otherMass = totalMass(other);

    if (otherMass > botMass * 1.08 && d < 1300) {
      moveX += (center.x - oc.x) * 2.0;
      moveY += (center.y - oc.y) * 2.0;
    } else if (botMass > otherMass * 1.18 && d < 1800) {
      moveX += (oc.x - center.x) * 1.4;
      moveY += (oc.y - center.y) * 1.4;
    }
  }

  if (botMass < BOT_FOOD_CAP) {
    let nearestFood = null;
    let nearestFoodDist = Infinity;

    for (const f of food) {
      const dx = f.x - center.x;
      const dy = f.y - center.y;
      const dsq = dx * dx + dy * dy;

      if (dsq < nearestFoodDist && dsq < 320 * 320) {
        nearestFoodDist = dsq;
        nearestFood = f;
      }
    }

    if (nearestFood) {
      moveX += (nearestFood.x - center.x) * 0.55;
      moveY += (nearestFood.y - center.y) * 0.55;
    }
  }

  bot.mouse.x = Math.max(-1400, Math.min(1400, moveX));
  bot.mouse.y = Math.max(-1400, Math.min(1400, moveY));
}

async function completeExtraction(player, isMatchWin = false) {
  const socket = io.sockets.sockets.get(player.id);
  if (!player || !socket) return;

  // Guard against being called twice on the same player in the same or consecutive ticks
  // (e.g. checkMatchEnd + finishedExtractions loop both firing for the same player).
  if (player._extractionInProgress) return;
  player._extractionInProgress = true;

  const totalValue = Number(player.cashValue || 0);
  const payout = Number((totalValue * EXTRACTION_PAYOUT_RATE).toFixed(2));

  try {
    if (payout > 0) {
      const wallet = await addCreditsTx(
        player.userId,
        payout,
        isMatchWin ? "match_win_payout" : "extraction_payout",
        isMatchWin
          ? `Won the match (${Math.round(EXTRACTION_PAYOUT_RATE * 100)}% payout)`
          : `Extracted from match (${Math.round(EXTRACTION_PAYOUT_RATE * 100)}% payout)`
      );

      if (socket.request?.session?.user) {
        socket.request.session.user.credits = wallet;
      }
      player._cachedWallet = wallet;
    }

    players.delete(player.id);
    if (player.userId) {
      playerByUserId.delete(player.userId);
      socketsByUserId.delete(player.userId);
    }

    // If no players remain after this extraction, end the match
    if (players.size === 0) {
      matchActive = false;
    }

    if (socket.request?.session) {
      socket.request.session.gameEntryReady = false;
      socket.request.session.gameEntryStake = null;
      socket.request.session.save(() => {});
    }

    const tax = Number((totalValue - payout).toFixed(2));

    socket.emit("extracted", {
      payout,
      kept: totalValue,
      tax,
      stake: Number(player.stake || 0),
      isMatchWin,
      message: isMatchWin
        ? `You won the match! Taking home $${payout.toFixed(2)}.`
        : `You extracted $${payout.toFixed(2)} back to your wallet.`
    });

    markSocketAsSpectator(socket);
    addChatMessage("SERVER", isMatchWin ? `${player.name} won the match!` : `${player.name} extracted from the match`);
  } catch (err) {
    console.error("EXTRACTION ERROR:", err);
    socket.emit("extractFailed", { error: "Failed to extract." });
    player.extracting = false;
    player.extractTicks = 0;
    player.wantsExtract = false;
  }
}

function eliminateHuman(player, eaterName) {
  const socket = io.sockets.sockets.get(player.id);

  if (socket) {
    socket.emit("dead", {
      by: eaterName || null,
      stake: Number(player.stake || 0),
      cashValue: Number(player.cashValue || 0),
      message: eaterName ? `You were eaten by ${eaterName}.` : "You died."
    });

    markSocketAsSpectator(socket);
  }

  player.alive = false;
  players.delete(player.id);

  if (player.userId) {
    playerByUserId.delete(player.userId);
    socketsByUserId.delete(player.userId);
  }

  const req = socket?.request;
  if (req?.session) {
    req.session.gameEntryReady = false;
    req.session.gameEntryStake = null;
    req.session.save(() => {});
  }
}

function respawnBotAtIndex(index) {
  bots[index] = createBot(index);
}

function eliminateBot(botIndex) {
  respawnBotAtIndex(botIndex);
}

function handleEntityVsEntity() {
  const livingHumans = [...players.values()];
  const livingBots = bots.filter((b) => b.cells.length > 0);
  const all = [...livingHumans, ...livingBots];

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];

      if (!a.cells.length || !b.cells.length) continue;

      for (let ai = a.cells.length - 1; ai >= 0; ai--) {
        const ac = a.cells[ai];
        if (!ac) continue;

        for (let bi = b.cells.length - 1; bi >= 0; bi--) {
          const bc = b.cells[bi];
          if (!bc) continue;

          const ar = radiusFromMass(ac.mass);
          const br = radiusFromMass(bc.mass);
          const d = distance(ac.x, ac.y, bc.x, bc.y);

          if (ac.mass > bc.mass * 1.12 && d < ar - br * 0.3) {
            const bTotalMass = b.cells.reduce((s, c) => s + c.mass, 0);
            const cellShare = bTotalMass > 0
              ? (bc.mass / bTotalMass) * Number(b.cashValue || 0) : 0;
            if (cellShare > 0) {
              a.cashValue = Number(a.cashValue || 0) + cellShare;
              b.cashValue = Math.max(0, Number(b.cashValue || 0) - cellShare);
            }

            ac.mass += bc.mass;
            b.cells.splice(bi, 1);

            if (b.cells.length === 0) {
              a.cashValue = Number(a.cashValue || 0) + Number(b.cashValue || 0);
              b.cashValue = 0;
              if (isHuman(b)) eliminateHuman(b, a.name);
              else if (isBot(b)) eliminateBot(b.botIndex);
            }
          } else if (bc.mass > ac.mass * 1.12 && d < br - ar * 0.3) {
            const aTotalMass = a.cells.reduce((s, c) => s + c.mass, 0);
            const cellShare = aTotalMass > 0
              ? (ac.mass / aTotalMass) * Number(a.cashValue || 0) : 0;
            if (cellShare > 0) {
              b.cashValue = Number(b.cashValue || 0) + cellShare;
              a.cashValue = Math.max(0, Number(a.cashValue || 0) - cellShare);
            }

            bc.mass += ac.mass;
            a.cells.splice(ai, 1);

            if (a.cells.length === 0) {
              b.cashValue = Number(b.cashValue || 0) + Number(a.cashValue || 0);
              a.cashValue = 0;
              if (isHuman(a)) eliminateHuman(a, b.name);
              else if (isBot(a)) eliminateBot(a.botIndex);
            }

            break;
          }
        }
      }
    }
  }
}

function buildLeaderboard() {
  const all = [
    ...[...players.values()].filter((p) => p.cells.length > 0),
    ...bots.filter((b) => b.cells.length > 0)
  ];

  return all
    .map((entity) => ({
      name: entity.name,
      mass: Math.round(totalMass(entity)),
      value: Number(entity.cashValue || 0)
    }))
    .sort((a, b) => b.mass - a.mass)
    .slice(0, 10);
}

function buildSnapshotFor(targetPlayer) {
  const center = entityCenter(targetPlayer);
  const total = totalMass(targetPlayer);

  const biggestCellMass = targetPlayer.cells.length
    ? Math.max(...targetPlayer.cells.map((c) => c.mass))
    : total;

  const biggestRadius = radiusFromMass(biggestCellMass || START_MASS);
  const visibleRadius = Math.max(2100, biggestRadius * 6 + SNAPSHOT_PADDING);

  const visibleFood = [];
  for (const f of food) {
    if (
      Math.abs(f.x - center.x) <= visibleRadius &&
      Math.abs(f.y - center.y) <= visibleRadius
    ) {
      visibleFood.push(f);
    }
  }

  const visibleViruses = [];
  for (const v of viruses) {
    if (
      Math.abs(v.x - center.x) <= visibleRadius &&
      Math.abs(v.y - center.y) <= visibleRadius
    ) {
      visibleViruses.push(v);
    }
  }

  const visiblePlayers = [];
  const all = [...players.values(), ...bots];

  for (const entity of all) {
    if (!entity.cells.length) continue;

    const pCenter = entityCenter(entity);

    if (
      entity.id !== targetPlayer.id &&
      Math.abs(pCenter.x - center.x) > visibleRadius &&
      Math.abs(pCenter.y - center.y) > visibleRadius
    ) {
      continue;
    }

    visiblePlayers.push({
      id: entity.id,
      name: entity.name,
      color: entity.color,
      totalMass: Math.round(totalMass(entity)),
      cashValue: Number(entity.cashValue || 0),
      extracting: !!entity.extracting,
      extractTicks: Number(entity.extractTicks || 0),
      isBot: isBot(entity),
      cells: entity.cells.map((c) => ({
        x: c.x,
        y: c.y,
        mass: c.mass
      }))
    });
  }

  visiblePlayers.sort((a, b) => a.totalMass - b.totalMass);

  return {
    worldSize: WORLD_SIZE,
    food: visibleFood,
    viruses: visibleViruses,
    players: visiblePlayers,
    leaderboard: (_tickLeaderboard || (_tickLeaderboard = buildLeaderboard())),
    wallet: targetPlayer._cachedWallet
  };
}

function getHumanSpectateList() {
  return [...players.values()]
    .filter((p) => isHuman(p) && p.alive && p.cells.length)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function pickSpectateTarget(currentTargetId, direction = 1) {
  const humans = getHumanSpectateList();
  if (!humans.length) return null;

  const currentIndex = humans.findIndex((p) => p.id === currentTargetId);
  if (currentIndex === -1) return humans[0];

  const nextIndex = (currentIndex + (direction >= 0 ? 1 : -1) + humans.length) % humans.length;
  return humans[nextIndex];
}

function markSocketAsSpectator(socket, preferredTargetId = null) {
  const target = pickSpectateTarget(preferredTargetId, 1);
  if (!target) {
    spectators.set(socket.id, { targetId: null });
    socket.emit("spectateStatus", { error: "No live human players to spectate right now." });
    return;
  }

  spectators.set(socket.id, { targetId: target.id });
  socket.emit("spectateStatus", {
    targetId: target.id,
    targetName: target.name
  });
}


io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("join", async (payload) => {
    try {
      const req = socket.request;
      const sessionUser = req.session?.user;

      spectators.delete(socket.id);

      if (!sessionUser?.id) {
        socket.emit("joinError", { error: "You must be logged in." });
        return;
      }

      const freshUser = await getUserById(sessionUser.id);
      if (!freshUser) {
        socket.emit("joinError", { error: "User not found." });
        return;
      }

      const existingSocketId = playerByUserId.get(freshUser.id);
      if (
        existingSocketId &&
        existingSocketId !== socket.id &&
        players.has(existingSocketId)
      ) {
        socket.emit("joinError", { error: "You are already in a match." });
        return;
      }

      if (!req.session.gameEntryReady) {
        socket.emit("joinError", { error: "Enter the game from the menu first." });
        return;
      }

      const stake = Number(req.session.gameEntryStake || 1);

      if (!ALLOWED_STAKES.includes(stake)) {
        socket.emit("joinError", { error: "Invalid selected amount." });
        return;
      }

      if (Number(freshUser.credits || 0) < stake) {
        socket.emit("joinError", { error: "Not enough balance to play." });
        return;
      }

      // Remove any existing queue entry for this user
      for (const s of ALLOWED_STAKES) {
        const q = matchmakingQueue[s];
        const idx = q.findIndex((e) => e.userId === freshUser.id);
        if (idx !== -1) q.splice(idx, 1);
      }

      const requestedName = typeof payload === "object" ? payload?.name : payload;
      const requestedColor = typeof payload === "object" ? payload?.color : null;
      const safeName = String(requestedName || freshUser.username || "Player").trim().slice(0, 16) || "Player";

      matchmakingQueue[stake].push({
        userId: freshUser.id,
        username: freshUser.username,
        socketId: socket.id,
        name: safeName,
        color: requestedColor
      });

      socket.emit("matchmakingQueued", {
        stake,
        queueCount: matchmakingQueue[stake].length,
        players: matchmakingQueue[stake].map((e) => ({ name: e.name }))
      });

      mmQueueBroadcast(stake);

      if (matchmakingQueue[stake].length >= 2) {
        mmStartCountdown(stake);
      }
    } catch (err) {
      console.error("JOIN ERROR:", err);
      socket.emit("joinError", { error: "Failed to join the queue." });
    }
  });

  socket.on("chat", (text) => {
    const player = players.get(socket.id);
    if (!player) return;
    addChatMessage(player.name, text);
  });

  socket.on("input", (input) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (typeof input?.mouseX === "number") player.mouse.x = input.mouseX;
    if (typeof input?.mouseY === "number") player.mouse.y = input.mouseY;
    if (input?.split) player.wantsSplit = true;
    if (input?.eject) player.wantsEject = true;
    if (typeof input?.extracting === "boolean") player.wantsExtract = input.extracting;
  });

  socket.on("spectateStart", () => {
    if (players.has(socket.id)) return;
    markSocketAsSpectator(socket, spectators.get(socket.id)?.targetId || null);
  });

  socket.on("spectateSwitch", (payload) => {
    if (players.has(socket.id)) return;

    const direction = Number(payload?.direction) >= 0 ? 1 : -1;
    const currentTargetId = spectators.get(socket.id)?.targetId || null;
    const target = pickSpectateTarget(currentTargetId, direction);

    if (!target) {
      socket.emit("spectateStatus", { error: "No live human players to spectate right now." });
      return;
    }

    spectators.set(socket.id, { targetId: target.id });
    socket.emit("spectateStatus", {
      targetId: target.id,
      targetName: target.name
    });
  });

  socket.on("stopSpectating", () => {
    spectators.delete(socket.id);
  });

  socket.on("cancelQueue", () => {
    for (const stake of ALLOWED_STAKES) {
      const q = matchmakingQueue[stake];
      const idx = q.findIndex((e) => e.socketId === socket.id);
      if (idx !== -1) {
        q.splice(idx, 1);
        if (q.length < 2) mmCancelCountdown(stake);
        mmQueueBroadcast(stake);
        socket.emit("matchmakingCancelled", { reason: "You cancelled." });
        break;
      }
    }
  });

  socket.on("disconnect", () => {
    // Remove from matchmaking queue
    for (const stake of ALLOWED_STAKES) {
      const q = matchmakingQueue[stake];
      const idx = q.findIndex((e) => e.socketId === socket.id);
      if (idx !== -1) {
        q.splice(idx, 1);
        if (q.length < 2) mmCancelCountdown(stake);
        mmQueueBroadcast(stake);
        break;
      }
    }

    spectators.delete(socket.id);

    const player = players.get(socket.id);

    if (player) {
      addChatMessage("SERVER", `${player.name} left the game`);
      players.delete(socket.id);

      if (player.userId) {
        playerByUserId.delete(player.userId);
        socketsByUserId.delete(player.userId);
      }

      if (socket.request?.session) {
        socket.request.session.gameEntryReady = false;
        socket.request.session.gameEntryStake = null;
        socket.request.session.save(() => {});
      }
    }

    console.log("socket disconnected:", socket.id);
  });
});

async function tick() {
  // Nothing to simulate until a real match is running
  if (!matchActive) return;

  // Precompute leaderboard once per tick — shared across all player snapshots
  _tickLeaderboard = null; // cleared, rebuilt lazily on first buildSnapshotFor call

  respawnMissingBots();

  for (const bot of bots) {
    botThink(bot);
  }

  moveEjectedFood();

  for (const entity of [...players.values(), ...bots]) {
    if (!entity.cells.length) continue;

    updateExtraction(entity);
    moveEntity(entity);
    splitEntity(entity);
    ejectMass(entity);
    handleFoodEating(entity);
    handleVirusCollisions(entity);
    handleSelfMerge(entity);
  }

  handleEntityVsEntity();

  // Auto-extract last standing human player (match winner)
  await checkMatchEnd();

  // Snapshot AFTER checkMatchEnd so any player it already paid out is excluded.
  // Guard with players.has() to prevent double payout if completeExtraction was
  // already called for a player earlier in the same tick.
  const finishedExtractions = [...players.values()].filter(
    (p) => p.extracting && p.extractTicks >= EXTRACTION_HOLD_TICKS
  );

  for (const player of finishedExtractions) {
    if (!players.has(player.id)) continue; // already extracted this tick
    await completeExtraction(player);
  }

  while (food.length < FOOD_COUNT) food.push(createFood());
  while (viruses.length < VIRUS_COUNT) viruses.push(createVirus());
  respawnMissingBots();

  for (const [id, player] of players.entries()) {
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;

    try {
      const snapshot = buildSnapshotFor(player);
      sock.volatile.emit("state", snapshot);
    } catch (err) {
      console.error("SNAPSHOT ERROR:", err);
    }
  }

  for (const [socketId, spec] of spectators.entries()) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock || players.has(socketId)) {
      spectators.delete(socketId);
      continue;
    }

    // Keep the current target if they are still alive.
    // Only find a new target if the current one died or left.
    let target = spec?.targetId ? players.get(spec.targetId) : null;
    if (!target || !target.cells.length) {
      // Current target gone — pick the next available human
      target = pickSpectateTarget(spec?.targetId || null, 1);
      if (!target) continue; // no one left to spectate
      spectators.set(socketId, { targetId: target.id });
      // Notify the client their target changed
      sock.emit("spectateStatus", {
        targetId: target.id,
        targetName: target.name
      });
    }

    try {
      const snapshot = buildSnapshotFor(target);
      sock.volatile.emit("state", {
        ...snapshot,
        wallet: undefined,
        spectating: true,
        spectateTargetId: target.id,
        spectateTargetName: target.name
      });
    } catch (err) {
      console.error("SPECTATOR SNAPSHOT ERROR:", err);
    }
  }
}

// World and bots are initialised fresh when each match launches (in mmLaunchMatch).
// Nothing runs at startup so players always see a clean world.

async function start() {
  await initDb();

  setInterval(() => {
    tick().catch((err) => {
      console.error("GAME LOOP ERROR:", err);
    });
  }, 1000 / TICK_RATE);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Music folder: ${AUDIO_DIR}`);
  });
}

start().catch((err) => {
  console.error("STARTUP ERROR:", err);
  process.exit(1);
});
