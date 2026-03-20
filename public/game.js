const socket = io({
  autoConnect: false,
  withCredentials: true
});

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

const landingScreen = document.getElementById("landingScreen");
const startMenuBtn = document.getElementById("startMenuBtn");
const colorInput = document.getElementById("colorInput");
const colorPreviewBall = document.getElementById("colorPreviewBall");
const moneyBg = document.getElementById("moneyBg");
const menuBallsBg = document.getElementById("menuBallsBg");

const menu = document.getElementById("menu");
const playBtn = document.getElementById("playBtn");
const nameInput = document.getElementById("nameInput");
const massValue = document.getElementById("massValue");

const gameLeaderboard = document.getElementById("gameLeaderboard");
const gameLeaderboardEntries = document.getElementById("gameLeaderboardEntries");
const menuLeaderboardEntries = document.getElementById("menuLeaderboardEntries");

const stakeButtons = document.querySelectorAll(".stakeBtn");

const chatBox = document.getElementById("chatBox");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");

const postMatchOverlay = document.getElementById("postMatchOverlay");
const postMatchCard = document.getElementById("postMatchCard");
const postMatchTitle = document.getElementById("postMatchTitle");
const postMatchDetails = document.getElementById("postMatchDetails");
const postMatchSpectateStatus = document.getElementById("postMatchSpectateStatus");
const postMatchSpectateBtn = document.getElementById("postMatchSpectateBtn");
const postMatchQuitBtn = document.getElementById("postMatchQuitBtn");

const authPanel = document.getElementById("authPanel");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");

const walletValue = document.getElementById("walletValue");
const walletAmountInput = document.getElementById("walletAmountInput");
const withdrawAddressInput = document.getElementById("withdrawAddressInput");
const addBalanceBtn = document.getElementById("addBalanceBtn");
const withdrawBtn = document.getElementById("withdrawBtn");
const walletStatus = document.getElementById("walletStatus");
const menuStatus = document.getElementById("menuStatus");

const toggleFriendSearchBtn = document.getElementById("toggleFriendSearchBtn");
const friendSearchPanel = document.getElementById("friendSearchPanel");
const friendSearchInput = document.getElementById("friendSearchInput");
const friendSearchResults = document.getElementById("friendSearchResults");
const friendsList = document.getElementById("friendsList");
const friendRequestsList = document.getElementById("friendRequestsList");
const friendsStatus = document.getElementById("friendsStatus");

const privateChatCard = document.getElementById("privateChatCard");
const privateChatTitle = document.getElementById("privateChatTitle");
const privateChatMessages = document.getElementById("privateChatMessages");
const privateChatInput = document.getElementById("privateChatInput");
const sendPrivateChatBtn = document.getElementById("sendPrivateChatBtn");
const closePrivateChatBtn = document.getElementById("closePrivateChatBtn");

const menuMusic = document.getElementById("menuMusic");
const menuMusicPlayer = document.getElementById("menuMusicPlayer");
const musicSongName = document.getElementById("musicSongName");
const musicCloseBtn = document.getElementById("musicCloseBtn");
const musicPrevBtn = document.getElementById("musicPrevBtn");
const musicPlayPauseBtn = document.getElementById("musicPlayPauseBtn");
const musicNextBtn = document.getElementById("musicNextBtn");
const musicVolumeRange = document.getElementById("musicVolumeRange");

const rouletteOpenBtn = document.getElementById("rouletteOpenBtn");
const rouletteOverlay = document.getElementById("rouletteOverlay");
const closeRouletteBtn = document.getElementById("closeRouletteBtn");
const rouletteBalanceValue = document.getElementById("rouletteBalanceValue");
const rouletteSpinBtn = document.getElementById("rouletteSpinBtn");
const rouletteStatus = document.getElementById("rouletteStatus");
const rouletteResultValue = document.getElementById("rouletteResultValue");
const rouletteWheelCanvas = document.getElementById("rouletteWheelCanvas");

// ── Blackjack DOM refs ──
const blackjackOpenBtn = document.getElementById("blackjackOpenBtn");
const blackjackOverlay = document.getElementById("blackjackOverlay");
const closeBlackjackBtn = document.getElementById("closeBlackjackBtn");
const bjBalanceValue = document.getElementById("bjBalanceValue");
const bjAmountButtons = document.getElementById("bjAmountButtons");
const bjDealBtn = document.getElementById("bjDealBtn");
const bjActionButtons = document.getElementById("bjActionButtons");
const bjHitBtn = document.getElementById("bjHitBtn");
const bjStandBtn = document.getElementById("bjStandBtn");
const bjDoubleBtn = document.getElementById("bjDoubleBtn");
const bjStatus = document.getElementById("bjStatus");
const bjDealerCards = document.getElementById("bjDealerCards");
const bjPlayerCards = document.getElementById("bjPlayerCards");
const bjDealerScore = document.getElementById("bjDealerScore");
const bjPlayerScore = document.getElementById("bjPlayerScore");
const bjResultBanner = document.getElementById("bjResultBanner");
const bjBetDisplay = document.getElementById("bjBetDisplay");
const bjDealerCanvas = document.getElementById("bjDealerCanvas");

const toastContainer = document.getElementById("toastContainer");

let W = (canvas.width = window.innerWidth);
let H = (canvas.height = window.innerHeight);
let isIntentionalReconnect = false;
let selectedStake = 1;
let friendSearchTimer = null;

window.addEventListener("resize", () => {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
});

const state = {
  extracting: false,
  connected: false,
  worldSize: 12000,
  food: [],
  viruses: [],
  players: [],
  leaderboard: [],
  myId: null,
  mouseX: 0,
  mouseY: 0,
  splitQueued: false,
  ejectQueued: false,
  cameraX: 0,
  cameraY: 0,
  zoom: 1,
  wallet: 0,
  menuWalletLeaderboard: [],
  friends: [],
  friendRequests: [],
  privateChats: {},
  activePrivateChat: null,
  musicPlaylist: [],
  currentTrackIndex: 0,
  musicMuted: false,
  musicVolume: 0.4,
  musicReady: false,
  rouletteOpen: false,
  rouletteSpinning: false,
  rouletteBetType: "color",
  rouletteBetValue: "red",
  rouletteBetAmount: 1,
  rouletteRotation: 0,
  bjOpen: false,
  bjBetAmount: 1,
  bjPlaying: false,
  bjGame: null,
  spectating: false,
  spectateTargetId: null,
  spectateTargetName: "",
  postMatchSummary: null
};

const snapshots = [];
const INTERPOLATION_DELAY = 80;  // render 80ms behind server — smooths over jitter
const SNAPSHOT_BUFFER = 20;        // keep more frames for better interpolation
const EXTRACTION_SECONDS = 6;
const EXTRACTION_TICKS = 6 * 60;  // updated for 60 tick rate

let isJoinInFlight = false;
let inMatch = false;
let chatOpen = false;
let currentUser = null;

const ALLOWED_BALL_COLORS = [
  { name: "Black", value: "#111111" },
  { name: "Red", value: "#ef4444" },
  { name: "Pink", value: "#ec4899" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Yellow", value: "#facc15" },
  { name: "Orange", value: "#f97316" },
  { name: "Brown", value: "#8b5a2b" },
  { name: "Grey", value: "#9ca3af" },
  { name: "Blue", value: "#3b82f6" }
];

const DEFAULT_BALL_COLOR = "#3b82f6";

// ─── ROULETTE ────────────────────────────────────────────────────────────────

const EURO_ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const ROULETTE_RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);

// Chip colors and labels
const CHIP_STYLES = {
  0.5: { cls: "chip-50",  label: "50¢", color: "#94a3b8" },
  1:   { cls: "chip-1",   label: "$1",  color: "#3b82f6" },
  2:   { cls: "chip-2",   label: "$2",  color: "#f97316" },
  5:   { cls: "chip-5",   label: "$5",  color: "#ef4444" },
};

// tableBets: Map<number(0-36), totalAmount>
const tableBets = new Map();
let rouletteChipValue = 0.5; // currently selected chip

function getRouletteColor(number) {
  if (number === 0) return "green";
  return ROULETTE_RED_NUMBERS.has(Number(number)) ? "red" : "black";
}

function setRouletteStatus(text, isError = false) {
  const el = document.getElementById("rouletteStatus");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#c62828" : "#607289";
}

function updateRouletteBalance() {
  const el = document.getElementById("rouletteBalanceValue");
  if (el) el.textContent = formatMoney(state.wallet);
}

function rouletteTotalStake() {
  let t = 0;
  for (const v of tableBets.values()) t += v;
  return Number(t.toFixed(2));
}

function updateRouletteTotalStake() {
  const el = document.getElementById("rouletteTotalStake");
  if (el) el.textContent = formatMoney(rouletteTotalStake());
}

// Build the European roulette table layout
// Rows: 1-34 in columns of 3, plus 0 spanning, plus 2:1 column
// Maps outside bet type → label
const OUTSIDE_BET_LABELS = {
  col3: "2:1", col2: "2:1", col1: "2:1",
  dozen1: "1st 12", dozen2: "2nd 12", dozen3: "3rd 12",
  low: "1–18", even: "Even", red: "Red",
  black: "Black", odd: "Odd", high: "19–36"
};

function buildRouletteTable() {
  const table = document.getElementById("rouletteTable");
  if (!table) return;
  table.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "rtGrid";

  // Zero cell spanning 3 rows
  const zeroCell = makeTableCell(0);
  zeroCell.classList.add("rtZero");
  grid.appendChild(zeroCell);

  // Numbers 1–36: row 0=top (3,6,9…36), row 1=mid (2,5,8…35), row 2=bot (1,4,7…34)
  // Col button types: top row = col3 (n%3===0), mid = col2 (n%3===2), bot = col1 (n%3===1)
  const colTypes = ["col3", "col2", "col1"];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 12; col++) {
      const num = col * 3 + (3 - row);
      const cell = makeTableCell(num);
      grid.appendChild(cell);
    }
    // 2:1 column button — clickable outside bet
    const twoToOne = document.createElement("div");
    twoToOne.className = "rt2to1";
    twoToOne.textContent = "2:1";
    twoToOne.dataset.outside = colTypes[row];
    twoToOne.id = `rtOutside-${colTypes[row]}`;
    twoToOne.addEventListener("click", () => onOutsideBetClick(colTypes[row]));
    grid.appendChild(twoToOne);
  }

  table.appendChild(grid);

  // Dozens row
  const extras = document.createElement("div");
  extras.className = "rtExtras";
  [["dozen1","1st 12"],["dozen2","2nd 12"],["dozen3","3rd 12"]].forEach(([type, label]) => {
    const d = document.createElement("div");
    d.className = "rtDozen";
    d.textContent = label;
    d.dataset.outside = type;
    d.id = `rtOutside-${type}`;
    d.addEventListener("click", () => onOutsideBetClick(type));
    // chip stack placeholder
    const stack = document.createElement("div");
    stack.className = "rtChipStack";
    stack.id = `rtStack-outside-${type}`;
    d.appendChild(stack);
    extras.appendChild(d);
  });
  table.appendChild(extras);

  // Bottom even-money row
  const bottomRow = document.createElement("div");
  bottomRow.className = "rtBottom";
  [["low","1–18"],["even","Even"],["red","Red"],["black","Black"],["odd","Odd"],["high","19–36"]].forEach(([type, label]) => {
    const d = document.createElement("div");
    d.className = "rtBottomCell";
    d.textContent = label;
    d.dataset.outside = type;
    d.id = `rtOutside-${type}`;
    d.addEventListener("click", () => onOutsideBetClick(type));
    // chip stack placeholder
    const stack = document.createElement("div");
    stack.className = "rtChipStack";
    stack.id = `rtStack-outside-${type}`;
    d.appendChild(stack);
    bottomRow.appendChild(d);
  });
  table.appendChild(bottomRow);
}

function onOutsideBetClick(type) {
  if (state.rouletteSpinning) return;
  const MAX_OUTSIDE = 20;
  const current = tableBets.get(type) || 0;
  const next = Number((current + rouletteChipValue).toFixed(2));
  if (next > MAX_OUTSIDE) {
    setRouletteStatus(`Max $${MAX_OUTSIDE} per outside bet.`, true);
    return;
  }
  if (rouletteTotalStake() + rouletteChipValue > 20) {
    setRouletteStatus("Max total bet is $20.", true);
    return;
  }
  if (next > state.wallet) {
    setRouletteStatus("Not enough balance.", true);
    return;
  }
  tableBets.set(type, next);
  renderTableBets();
  updateRouletteTotalStake();
  setRouletteStatus("");
  updateRouletteSpinBtn();
}

function makeTableCell(num) {
  const color = getRouletteColor(num);
  const cell = document.createElement("div");
  cell.className = `rtCell rtColor-${color}`;
  cell.dataset.num = num;

  const label = document.createElement("span");
  label.className = "rtCellNum";
  label.textContent = num;
  cell.appendChild(label);

  const chipStack = document.createElement("div");
  chipStack.className = "rtChipStack";
  chipStack.id = `rtStack-${num}`;
  cell.appendChild(chipStack);

  cell.addEventListener("click", () => onTableCellClick(num));
  return cell;
}

function onTableCellClick(num) {
  if (state.rouletteSpinning) return;
  const MAX_PER_NUM = 5;
  const current = tableBets.get(num) || 0;
  const next = Number((current + rouletteChipValue).toFixed(2));
  if (next > MAX_PER_NUM) {
    setRouletteStatus(`Max $${MAX_PER_NUM} per number.`, true);
    return;
  }
  if (next > state.wallet) {
    setRouletteStatus("Not enough balance.", true);
    return;
  }
  const MAX_TOTAL = 20;
  if (rouletteTotalStake() + rouletteChipValue > MAX_TOTAL) {
    setRouletteStatus(`Max total bet is $${MAX_TOTAL}.`, true);
    return;
  }
  tableBets.set(num, next);
  renderTableBets();
  updateRouletteTotalStake();
  setRouletteStatus("");
  updateRouletteSpinBtn();
}

function renderTableBets() {
  // Clear all stacks
  document.querySelectorAll(".rtChipStack").forEach(el => el.innerHTML = "");

  for (const [key, total] of tableBets) {
    // key is either a number (0-36) or a string ("red", "black", etc.)
    const stackId = typeof key === "string"
      ? `rtStack-outside-${key}`
      : `rtStack-${key}`;
    const stack = document.getElementById(stackId);
    if (!stack || total <= 0) continue;

    let chipCls = "chip-50";
    if (total >= 5) chipCls = "chip-5";
    else if (total >= 2) chipCls = "chip-2";
    else if (total >= 1) chipCls = "chip-1";

    const chip = document.createElement("div");
    chip.className = `rtChipDisc ${chipCls}`;
    chip.textContent = formatMoney(total);
    stack.appendChild(chip);
  }
}

function clearTableBets() {
  tableBets.clear();
  renderTableBets();
  updateRouletteTotalStake();
  updateRouletteSpinBtn();
  setRouletteStatus("Place chips on the table, then spin.");
}

function updateRouletteSpinBtn() {
  const btn = document.getElementById("rouletteSpinBtn");
  if (!btn) return;
  const total = rouletteTotalStake();
  btn.disabled = state.rouletteSpinning || total <= 0 || total > state.wallet;
}

function selectChip(value) {
  rouletteChipValue = value;
  document.querySelectorAll(".rouletteChip").forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.chip) === value);
  });
}

function drawRouletteWheel(rotationDeg = 0) {
  const canvas = document.getElementById("rouletteWheelCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(width, height) * 0.46;
  const midR = outerR * 0.78;
  const innerR = outerR * 0.56;
  const hubR = outerR * 0.16;
  const slice = (Math.PI * 2) / EURO_ROULETTE_ORDER.length;
  const rot = (rotationDeg * Math.PI) / 180;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  for (let i = 0; i < EURO_ROULETTE_ORDER.length; i++) {
    const number = EURO_ROULETTE_ORDER[i];
    const color = getRouletteColor(number);
    const start = -Math.PI / 2 + i * slice;
    const end = start + slice;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, outerR, start, end);
    ctx.closePath();
    ctx.fillStyle = color === "green" ? "#0ea75a" : color === "red" ? "#ef4444" : "#111111";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, outerR, start, end);
    ctx.arc(0, 0, midR, end, start, true);
    ctx.closePath();
    ctx.fillStyle = color === "green" ? "#0ebc68" : color === "red" ? "#ff4f5d" : "#202530";
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.86)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(start) * midR, Math.sin(start) * midR);
    ctx.lineTo(Math.cos(start) * outerR, Math.sin(start) * outerR);
    ctx.stroke();

    const center = start + slice / 2;
    ctx.save();
    ctx.rotate(center);
    ctx.translate((midR + outerR) / 2, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "#ffecc4";
    ctx.font = "900 24px Ubuntu, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), 0, 0);
    ctx.restore();
  }

  ctx.fillStyle = "#cfd5dd";
  ctx.beginPath(); ctx.arc(0, 0, innerR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a4adb7";
  ctx.beginPath(); ctx.arc(0, 0, hubR * 1.65, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#edf2f7";
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function animateRouletteToNumber(winningNumber) {
  const index = EURO_ROULETTE_ORDER.indexOf(Number(winningNumber));
  if (index < 0) return Promise.resolve();

  const sliceDeg = 360 / EURO_ROULETTE_ORDER.length;
  const centerDeg = -90 + index * sliceDeg + sliceDeg / 2;
  // We need: centerDeg + rotation ≡ -90 (mod 360)  →  rotation ≡ -90 - centerDeg
  const desiredNorm = ((-90 - centerDeg) % 360 + 360) % 360;
  const current = Number(state.rouletteRotation || 0);
  const currentNorm = ((current % 360) + 360) % 360;
  let delta = desiredNorm - currentNorm;
  if (delta < 0) delta += 360;
  const target = current + 1800 + delta;

  return new Promise((resolve) => {
    const duration = 4600;
    const start = performance.now();
    const startRotation = current;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      state.rouletteRotation = startRotation + (target - startRotation) * eased;
      drawRouletteWheel(state.rouletteRotation);
      if (t < 1) requestAnimationFrame(frame);
      else { state.rouletteRotation = target; drawRouletteWheel(state.rouletteRotation); resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

const OUTSIDE_WIN_CONDITIONS = {
  red:    n => n > 0 && [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n),
  black:  n => n > 0 && ![1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n),
  odd:    n => n > 0 && n % 2 === 1,
  even:   n => n > 0 && n % 2 === 0,
  low:    n => n >= 1 && n <= 18,
  high:   n => n >= 19 && n <= 36,
  dozen1: n => n >= 1 && n <= 12,
  dozen2: n => n >= 13 && n <= 24,
  dozen3: n => n >= 25 && n <= 36,
  col1:   n => n > 0 && n % 3 === 1,
  col2:   n => n > 0 && n % 3 === 2,
  col3:   n => n > 0 && n % 3 === 0,
};

function highlightWinningCell(winningNumber) {
  document.querySelectorAll(".rtCell,.rtBottomCell,.rtDozen,.rt2to1").forEach(c => c.classList.remove("rtWin"));
  // Highlight the number cell
  const cell = document.querySelector(`.rtCell[data-num="${winningNumber}"]`);
  if (cell) cell.classList.add("rtWin");
  // Highlight winning outside bet cells
  for (const [type, fn] of Object.entries(OUTSIDE_WIN_CONDITIONS)) {
    if (fn(Number(winningNumber))) {
      const el = document.getElementById(`rtOutside-${type}`);
      if (el) el.classList.add("rtWin");
    }
  }
}

function openRouletteModal() {
  if (!currentUser) return;
  const overlay = document.getElementById("rouletteOverlay");
  if (!overlay) return;
  state.rouletteOpen = true;
  overlay.classList.remove("hidden");
  updateRouletteBalance();
  buildRouletteTable();
  clearTableBets();
  drawRouletteWheel(state.rouletteRotation || 0);
  updateRouletteSpinBtn();
}

function closeRouletteModal() {
  const overlay = document.getElementById("rouletteOverlay");
  if (!overlay || state.rouletteSpinning) return;
  state.rouletteOpen = false;
  overlay.classList.add("hidden");
}

async function handleRouletteSpin() {
  if (state.rouletteSpinning) return;
  if (!currentUser) { setRouletteStatus("You need to be logged in.", true); return; }

  const bets = [];
  for (const [key, amt] of tableBets) {
    if (amt <= 0) continue;
    if (typeof key === "string") {
      bets.push({ type: "outside", bet: key, amount: amt });
    } else {
      bets.push({ number: key, amount: amt });
    }
  }
  if (bets.length === 0) { setRouletteStatus("Place at least one chip first.", true); return; }

  const total = rouletteTotalStake();
  if (total > state.wallet) { setRouletteStatus("Not enough balance.", true); return; }

  state.rouletteSpinning = true;
  updateRouletteSpinBtn();
  document.querySelectorAll(".rouletteChip, .rtCell, #rouletteClearBtn").forEach(e => e.style.pointerEvents = "none");
  setRouletteStatus("Spinning…");

  try {
    const data = await api("/api/casino/roulette/spin", { bets });
    if (data.error) {
      setRouletteStatus(data.error, true);
      return;
    }

    await animateRouletteToNumber(data.winningNumber);
    highlightWinningCell(data.winningNumber);

    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
    updateRouletteBalance();

    const colorLabel = String(data.winningColor || "").replace(/^./, m => m.toUpperCase());
    const resultEl = document.getElementById("rouletteResultValue");
    if (resultEl) {
      resultEl.textContent = `${data.winningNumber} ${colorLabel}`;
      resultEl.style.color = data.winningColor === "red" ? "#ef4444" : data.winningColor === "green" ? "#4ade80" : "#e2e8f0";
    }

    if (data.totalPayout > 0) {
      const profit = data.profit;
      setRouletteStatus(`🏆 ${data.winningNumber} ${colorLabel} — You won $${data.totalPayout.toFixed(2)}! (${profit >= 0 ? "+" : ""}$${profit.toFixed(2)})`, false);
      showToast(`Roulette: ${data.winningNumber} ${colorLabel} · +$${data.totalPayout.toFixed(2)}`);
    } else {
      setRouletteStatus(`${data.winningNumber} ${colorLabel} — No win. Lost $${total.toFixed(2)}.`, true);
      showToast(`Roulette: ${data.winningNumber} ${colorLabel}`);
    }

    clearTableBets();
    await refreshMenuWalletLeaderboard();
  } catch (err) {
    console.error("ROULETTE SPIN ERROR:", err);
    setRouletteStatus("Roulette spin failed.", true);
  } finally {
    state.rouletteSpinning = false;
    updateRouletteSpinBtn();
    document.querySelectorAll(".rouletteChip, .rtCell, #rouletteClearBtn").forEach(e => e.style.pointerEvents = "");
  }
}

// ─── BLACKJACK ────────────────────────────────────────────────────────────────

const SUIT_COLORS = { "♠": "black", "♣": "black", "♥": "red", "♦": "red" };

function updateBjBalance() {
  if (bjBalanceValue) bjBalanceValue.textContent = formatMoney(state.wallet);
}

function setBjStatus(text, isError = false) {
  if (!bjStatus) return;
  bjStatus.textContent = text || "";
  bjStatus.style.color = isError ? "#c62828" : "#607289";
}

function bjSuitColor(suit) {
  return SUIT_COLORS[suit] === "red" ? "red" : "black";
}

function renderBjCard(card) {
  if (!card || card.hidden) {
    return `<div class="bjCard cardHidden"></div>`;
  }
  const cls = bjSuitColor(card.suit);
  return `
    <div class="bjCard ${cls}">
      <div class="bjCardCorner top">
        <div class="bjCardVal">${card.value}</div>
        <div class="bjCardSuit">${card.suit}</div>
      </div>
      <div class="bjCardCenter">${card.suit}</div>
      <div class="bjCardCorner bottom">
        <div class="bjCardVal">${card.value}</div>
        <div class="bjCardSuit">${card.suit}</div>
      </div>
    </div>`;
}

function renderBjHands(game) {
  if (!game) return;
  if (bjDealerCards) bjDealerCards.innerHTML = (game.dealerHand || []).map(renderBjCard).join("");
  if (bjPlayerCards) bjPlayerCards.innerHTML = (game.playerHand || []).map(renderBjCard).join("");
  if (bjDealerScore) bjDealerScore.textContent = game.dealerValue ?? "";
  if (bjPlayerScore) bjPlayerScore.textContent = game.playerValue ?? "";
  if (bjBetDisplay) bjBetDisplay.textContent = `Bet: ${formatMoney(game.bet || 0)}`;
}

function showBjResult(game) {
  if (!bjResultBanner) return;
  const s = game.status;
  let cls, title, sub;
  if (s === "blackjack")     { cls = "win";  title = "🃏 BLACKJACK!"; sub = `+${formatMoney(game.payout)}`; }
  else if (s === "player_win") { cls = "win";  title = "🏆 YOU WIN!"; sub = `+${formatMoney(game.payout)}`; }
  else if (s === "dealer_bust"){ cls = "win";  title = "💥 DEALER BUSTS!"; sub = `+${formatMoney(game.payout)}`; }
  else if (s === "player_bust"){ cls = "lose"; title = "💀 BUST!"; sub = `-${formatMoney(game.bet)}`; }
  else if (s === "dealer_win") { cls = "lose"; title = "😤 DEALER WINS"; sub = `-${formatMoney(game.bet)}`; }
  else if (s === "push")       { cls = "push"; title = "🤝 PUSH"; sub = "Bet returned"; }
  else return;

  bjResultBanner.className = `bjResultBanner ${cls}`;
  bjResultBanner.innerHTML = `${title}<div class="bjResultSub">${sub}</div>`;
  bjResultBanner.classList.remove("hidden");
}

function hideBjResult() {
  bjResultBanner?.classList.add("hidden");
}

function setBjPlaying(playing) {
  state.bjPlaying = playing;
  bjDealBtn?.classList.toggle("hidden", playing);
  bjActionButtons?.classList.toggle("hidden", !playing);
  document.querySelectorAll("[data-bj-amount]").forEach((b) => { b.disabled = playing; });
  if (bjHitBtn)    bjHitBtn.disabled    = !playing;
  if (bjStandBtn)  bjStandBtn.disabled  = !playing;
  if (bjDoubleBtn) bjDoubleBtn.disabled = !playing;
}

function openBlackjackModal() {
  if (!blackjackOverlay) {
    console.error("blackjackOverlay element not found — make sure index.html is updated.");
    return;
  }
  state.bjOpen = true;
  blackjackOverlay.classList.remove("hidden");
  updateBjBalance();
  hideBjResult();
  setBjStatus(currentUser ? "Choose your bet and deal." : "Log in to play.");
  drawPixelDealer();
}

function closeBlackjackModal() {
  if (!blackjackOverlay || state.bjPlaying) return;
  state.bjOpen = false;
  blackjackOverlay.classList.add("hidden");
}

/* ─ Pixel art dealer ─ */
function drawPixelDealer() {
  const cvs = bjDealerCanvas;
  if (!cvs) return;
  const c = cvs.getContext("2d");
  const W = cvs.width, H = cvs.height;
  c.clearRect(0, 0, W, H);

  // Each "pixel" = 4px so the whole sprite fits in 80x100
  const P = 4;
  function px(col, row, w, h, color) {
    c.fillStyle = color;
    c.fillRect(col * P, row * P, (w || 1) * P, (h || 1) * P);
  }

  // Top hat brim
  px(3, 4, 14, 1, "#d4af37");
  // Hat crown
  px(5, 0, 10, 5, "#1a1a2e");
  // Hat band
  px(5, 3, 10, 1, "#dc2626");

  // Head
  px(4, 5, 12, 7, "#c9956b");
  // Hair top
  px(4, 5, 12, 1, "#2c1810");
  // Ears
  px(3, 7, 1, 3, "#b8845a");
  px(16, 7, 1, 3, "#b8845a");
  // Eyebrows
  px(6, 7, 3, 1, "#2c1810");
  px(11, 7, 3, 1, "#2c1810");
  // Eyes
  px(6, 8, 3, 2, "#1a1a2e");
  px(11, 8, 3, 2, "#1a1a2e");
  // Eye shine
  px(6, 8, 1, 1, "#ffffff");
  px(11, 8, 1, 1, "#ffffff");
  // Nose
  px(9, 9, 2, 2, "#b07a52");
  // Smile
  px(7, 11, 1, 1, "#2c1810");
  px(8, 12, 4, 1, "#2c1810");
  px(12, 11, 1, 1, "#2c1810");

  // Neck
  px(8, 12, 4, 2, "#c9956b");

  // Shirt collar / bow tie
  px(7, 13, 2, 1, "#f0ede6");
  px(11, 13, 2, 1, "#f0ede6");
  px(8, 13, 1, 1, "#dc2626");
  px(10, 13, 1, 1, "#dc2626");
  px(9, 13, 2, 2, "#b91c1c");

  // Jacket body
  px(3, 14, 14, 10, "#1a1a2e");
  // White shirt front
  px(7, 14, 6, 8, "#f0ede6");
  // Jacket lapels
  px(5, 14, 2, 5, "#2d2d44");
  px(13, 14, 2, 5, "#2d2d44");
  // Buttons
  px(9, 16, 2, 1, "#d4af37");
  px(9, 18, 2, 1, "#d4af37");

  // Arms
  px(2, 15, 2, 7, "#1a1a2e");
  px(16, 15, 2, 7, "#1a1a2e");
  // Hands
  px(2, 22, 2, 2, "#c9956b");
  px(16, 22, 2, 2, "#c9956b");

  // Suit symbol on chest
  c.fillStyle = "#d4af37";
  c.font = `bold ${P * 4}px serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("♠", W / 2, H * 0.82);

  // Shadow under character
  c.fillStyle = "rgba(0,0,0,0.22)";
  c.beginPath();
  c.ellipse(W / 2, H - 4, 28, 5, 0, 0, Math.PI * 2);
  c.fill();
}

async function bjDeal() {
  if (!currentUser) { setBjStatus("Log in to play.", true); return; }
  if (state.bjPlaying) return;

  state.bjGame = null;
  hideBjResult();
  if (bjDealerCards) bjDealerCards.innerHTML = "";
  if (bjPlayerCards) bjPlayerCards.innerHTML = "";
  if (bjDealerScore) bjDealerScore.textContent = "";
  if (bjPlayerScore) bjPlayerScore.textContent = "";

  bjDealBtn.disabled = true;
  setBjStatus("Dealing...");

  try {
    const data = await api("/api/casino/blackjack/start", { amount: state.bjBetAmount });
    if (data.error) { setBjStatus(data.error, true); bjDealBtn.disabled = false; return; }

    state.bjGame = data;
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);

    renderBjHands(data);

    if (data.status === "playing") {
      setBjPlaying(true);
      // Disable double if > 2 cards (shouldn't happen on deal but safe)
      if (bjDoubleBtn) bjDoubleBtn.disabled = (data.playerHand.length !== 2);
      setBjStatus("Hit, Stand, or Double Down?");
    } else {
      setBjPlaying(false);
      showBjResult(data);
      setBjGameOver(data);
      bjDealBtn.disabled = false;
      await refreshMenuWalletLeaderboard();
    }
  } catch (err) {
    console.error("BJ DEAL ERROR:", err);
    setBjStatus("Failed to deal.", true);
    bjDealBtn.disabled = false;
  }
}

async function bjHit() {
  if (!state.bjPlaying) return;
  setBjActionBusy(true);

  try {
    const data = await api("/api/casino/blackjack/hit", {});
    if (data.error) { setBjStatus(data.error, true); setBjActionBusy(false); return; }
    state.bjGame = data;
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
    renderBjHands(data);
    if (data.status === "playing") {
      if (bjDoubleBtn) bjDoubleBtn.disabled = true; // can't double after a hit
      setBjActionBusy(false);
      setBjStatus("Hit or Stand?");
    } else {
      setBjPlaying(false);
      showBjResult(data);
      setBjGameOver(data);
      bjDealBtn.disabled = false;
      await refreshMenuWalletLeaderboard();
    }
  } catch (err) {
    console.error("BJ HIT ERROR:", err);
    setBjStatus("Failed to hit.", true);
    setBjActionBusy(false);
  }
}

async function bjStand() {
  if (!state.bjPlaying) return;
  setBjActionBusy(true);

  try {
    const data = await api("/api/casino/blackjack/stand", {});
    if (data.error) { setBjStatus(data.error, true); setBjActionBusy(false); return; }
    state.bjGame = data;
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
    renderBjHands(data);
    setBjPlaying(false);
    showBjResult(data);
    setBjGameOver(data);
    bjDealBtn.disabled = false;
    await refreshMenuWalletLeaderboard();
  } catch (err) {
    console.error("BJ STAND ERROR:", err);
    setBjStatus("Failed to stand.", true);
    setBjActionBusy(false);
  }
}

async function bjDouble() {
  if (!state.bjPlaying) return;
  setBjActionBusy(true);

  try {
    const data = await api("/api/casino/blackjack/double", {});
    if (data.error) { setBjStatus(data.error, true); setBjActionBusy(false); return; }
    state.bjGame = data;
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
    renderBjHands(data);
    setBjPlaying(false);
    showBjResult(data);
    setBjGameOver(data);
    bjDealBtn.disabled = false;
    await refreshMenuWalletLeaderboard();
  } catch (err) {
    console.error("BJ DOUBLE ERROR:", err);
    setBjStatus("Failed to double.", true);
    setBjActionBusy(false);
  }
}

function setBjActionBusy(busy) {
  if (bjHitBtn)    bjHitBtn.disabled    = busy;
  if (bjStandBtn)  bjStandBtn.disabled  = busy;
  if (bjDoubleBtn) bjDoubleBtn.disabled = busy;
}

function setBjGameOver(data) {
  const s = data.status;
  const msgMap = {
    blackjack:   `Blackjack! You win ${formatMoney(data.payout)}!`,
    player_win:  `You win ${formatMoney(data.payout)}!`,
    dealer_bust: `Dealer busts! You win ${formatMoney(data.payout)}!`,
    player_bust: `Bust! You lost ${formatMoney(data.bet)}.`,
    dealer_win:  `Dealer wins. You lost ${formatMoney(data.bet)}.`,
    push:        `Push — bet returned.`
  };
  setBjStatus(msgMap[s] || "Round over.", ["player_bust","dealer_win"].includes(s));
  bjActionButtons?.classList.add("hidden");
  bjDealBtn?.classList.remove("hidden");
}

// ─── Blackjack event listeners ────────────────────────────────────────────────

blackjackOpenBtn?.addEventListener("click", openBlackjackModal);
closeBlackjackBtn?.addEventListener("click", closeBlackjackModal);
bjDealBtn?.addEventListener("click", bjDeal);
bjHitBtn?.addEventListener("click", bjHit);
bjStandBtn?.addEventListener("click", bjStand);
bjDoubleBtn?.addEventListener("click", bjDouble);

bjAmountButtons?.querySelectorAll("[data-bj-amount]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (state.bjPlaying) return;
    state.bjBetAmount = Number(btn.dataset.bjAmount || 1);
    bjAmountButtons.querySelectorAll("[data-bj-amount]").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.bjAmount) === state.bjBetAmount)
    );
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.bjOpen && !state.bjPlaying) {
    closeBlackjackModal();
  }
});

function waitForSocketConnect(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onError = (err) => {
      cleanup();
      reject(err || new Error("Socket connection failed."));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Socket connection timeout."));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    }

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
    socket.connect();
  });
}

async function reconnectSocketAfterAuth() {
  isIntentionalReconnect = true;
  try {
    if (socket.connected) {
      socket.disconnect();
    }
    await waitForSocketConnect();
  } finally {
    // Always reset even if connection fails — prevents permanent stuck state
    isIntentionalReconnect = false;
  }
}

function formatMoney(value) {
  const n = Number(value || 0);
  return "$" + n.toFixed(2);
}

function formatBallMoney(value) {
  const n = Number(value || 0);
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toFixed(2);
}

function radiusFromMass(mass) {
  return Math.sqrt(mass) * 4.8;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, body = null, method = null) {
  const useMethod = method || (body ? "POST" : "GET");

  let res;
  try {
    res = await fetch(path, {
      method: useMethod,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include"
    });
  } catch (networkErr) {
    // Network failure (server unreachable, CORS, etc.)
    return { error: "Cannot reach the server. Please try again." };
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok && !data.error) {
    data.error = `Request failed (${res.status})`;
  }

  return data;
}

function setAuthStatus(text, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = text || "";
  authStatus.style.color = isError ? "#c62828" : "#2e7d32";
}

function setWalletStatus(text, isError = false) {
  if (!walletStatus) return;
  walletStatus.textContent = text || "";
  walletStatus.style.color = isError ? "#c62828" : "#2e7d32";
}

function setMenuStatus(text, isError = false) {
  if (!menuStatus) return;
  menuStatus.textContent = text || "";
  menuStatus.style.color = isError ? "#c62828" : "#2e7d32";
}

function setFriendsStatus(text, isError = false) {
  if (!friendsStatus) return;
  friendsStatus.textContent = text || "";
  friendsStatus.style.color = isError ? "#c62828" : "#2e7d32";
}

function renderPostMatchSummary() {
  const summary = state.postMatchSummary;
  if (!postMatchTitle || !postMatchDetails || !summary) return;

  const rows = [
    `<div><strong>Stake:</strong> ${formatMoney(summary.stake || 0)}</div>`,
    `<div><strong>Cash value:</strong> ${formatMoney(summary.cashValue || 0)}</div>`,
    `<div><strong>Tax (5%):</strong> ${formatMoney(summary.tax || 0)}</div>`,
    `<div><strong>Taking home:</strong> ${formatMoney(summary.takeHome || 0)}</div>`,
    `<div><strong>Killed by:</strong> ${escapeHtml(summary.killedBy || "Nobody")}</div>`
  ];

  if (summary.isDeath) {
    postMatchTitle.textContent = "YOU DIED";
    postMatchTitle.classList.add("isDeath");
    postMatchTitle.classList.remove("isWin");
  } else if (summary.isMatchWin) {
    postMatchTitle.textContent = "YOU WON!";
    postMatchTitle.classList.remove("isDeath");
    postMatchTitle.classList.add("isWin");
  } else {
    postMatchTitle.textContent = "Extraction Complete";
    postMatchTitle.classList.remove("isDeath");
    postMatchTitle.classList.remove("isWin");
  }

  postMatchDetails.innerHTML = rows.join("");
}

function updateSpectateStatusText() {
  if (!postMatchSpectateStatus) return;
  if (!state.spectating) {
    postMatchSpectateStatus.textContent = "You are not spectating.";
    return;
  }
  const label = state.spectateTargetName ? `Spectating ${state.spectateTargetName}` : "Spectating...";
  postMatchSpectateStatus.textContent = `${label} (use ← / → to switch)`;
}

function openPostMatchOverlay(summary) {
  state.postMatchSummary = summary || null;
  postMatchOverlay?.classList.remove("hidden");
  postMatchCard?.classList.remove("hidden");
  state.spectating = false;
  state.spectateTargetId = null;
  state.spectateTargetName = "";
  renderPostMatchSummary();
  updateSpectateStatusText();
}

function closePostMatchOverlay() {
  postMatchOverlay?.classList.add("hidden");
  postMatchCard?.classList.add("hidden");
  state.postMatchSummary = null;
  state.spectating = false;
  state.spectateTargetId = null;
  state.spectateTargetName = "";
  updateSpectateStatusText();
}

function showToast(text) {
  if (!toastContainer || !text) return;

  const item = document.createElement("div");
  item.className = "toastItem";
  item.textContent = text;
  toastContainer.appendChild(item);

  setTimeout(() => {
    item.remove();
  }, 3500);
}

function showLandingOnly() {
  landingScreen?.classList.remove("hidden");
  authPanel?.classList.add("hidden");
  menu?.classList.add("hidden");
}

function showLandingWithAuth() {
  landingScreen?.classList.remove("hidden");
  authPanel?.classList.remove("hidden");
  menu?.classList.add("hidden");
}

function showMenu() {
  landingScreen?.classList.add("hidden");
  authPanel?.classList.add("hidden");
  menu?.classList.remove("hidden");
  tryStartMenuMusic();
}

function hideMenusForGame() {
  landingScreen?.classList.add("hidden");
  authPanel?.classList.add("hidden");
  menu?.classList.add("hidden");
  pauseMenuMusic();
}

function updateWalletUi(wallet) {
  state.wallet = Number(wallet || 0);
  if (walletValue) walletValue.textContent = formatMoney(state.wallet);
  updateRouletteBalance();
  updateBjBalance();
}

let isInMatchmakingQueue = false;

function setPlayButtonState(busy = false) {
  if (!playBtn) return;
  if (isInMatchmakingQueue) {
    playBtn.disabled = false;
    playBtn.textContent = "CANCEL";
    playBtn.classList.add("cancelQueueBtn");
  } else {
    playBtn.disabled = busy;
    playBtn.textContent = busy ? "Finding match..." : "JOIN GAME";
    playBtn.classList.remove("cancelQueueBtn");
  }
}

function setAuthButtonsLoggedIn(loggedIn) {
  logoutBtn?.classList.toggle("hidden", !loggedIn);
  loginBtn?.classList.toggle("hidden", loggedIn);
  registerBtn?.classList.toggle("hidden", loggedIn);
}

function resetGameVisualState() {
  snapshots.length = 0;
  state.food = [];
  state.viruses = [];
  state.players = [];
  state.leaderboard = [];
  state.cameraX = 0;
  state.cameraY = 0;
  state.zoom = 1;
  state.extracting = false;
  state.spectating = false;
  state.spectateTargetId = null;
  state.spectateTargetName = "";
  if (massValue) massValue.textContent = "0";
  if (gameLeaderboardEntries) gameLeaderboardEntries.innerHTML = "";
  setChatOpen(false);
}

function updateAuthUi(user) {
  currentUser = user || null;
  setAuthButtonsLoggedIn(!!user);
  setPlayButtonState(false);
  isJoinInFlight = false;

  if (user) {
    if (authUsername) authUsername.value = user.username || "";
    if (authPassword) authPassword.value = "";
    updateWalletUi(user.credits || 0);
    setAuthStatus(`Logged in as ${user.username}`);
    setMenuStatus("");
    setWalletStatus("");
    setFriendsStatus("");
    showMenu();
  } else {
    if (authPassword) authPassword.value = "";
    inMatch = false;
    resetGameVisualState();
    updateWalletUi(0);
    setAuthStatus("Not logged in.", false);
    setMenuStatus("");
    setWalletStatus("");
    setFriendsStatus("");
    closePrivateChat();
    showLandingOnly();
    pauseMenuMusic();
  }
}

async function refreshWallet() {
  if (!currentUser) return;
  const data = await api("/api/balance");
  if (!data.error && typeof data.wallet !== "undefined") {
    updateWalletUi(data.wallet);
    currentUser.credits = Number(data.wallet || 0);
  }
}

async function refreshMenuWalletLeaderboard() {
  const data = await api("/api/leaderboard/wallet");
  if (data.error) return;

  state.menuWalletLeaderboard = Array.isArray(data.items) ? data.items : [];
  renderMenuWalletLeaderboard();
}

function renderMenuWalletLeaderboard() {
  if (!menuLeaderboardEntries) return;

  if (!state.menuWalletLeaderboard.length) {
    menuLeaderboardEntries.innerHTML = `<div class="emptyCardText">No players yet.</div>`;
    return;
  }

  menuLeaderboardEntries.innerHTML = state.menuWalletLeaderboard
    .map(
      (entry, i) =>
        `<div>${i + 1}. ${escapeHtml(entry.name)} - <span style="color:#17a34a;font-weight:800">${formatMoney(entry.wallet)}</span></div>`
    )
    .join("");
}

async function refreshFriendsList() {
  if (!currentUser) return;

  const data = await api("/api/friends/list");
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  state.friends = Array.isArray(data.items) ? data.items : [];
  renderFriendsList();
}

async function refreshFriendRequests() {
  if (!currentUser) return;

  const data = await api("/api/friends/requests");
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  state.friendRequests = Array.isArray(data.items) ? data.items : [];
  renderFriendRequests();
}

function renderFriendsList() {
  if (!friendsList) return;

  if (!state.friends.length) {
    friendsList.innerHTML = `<div class="emptyCardText">No friends yet.</div>`;
    return;
  }

  friendsList.innerHTML = state.friends
    .map(
      (friend) => `
        <div class="friendRow">
          <div class="friendName">${escapeHtml(friend.username)}</div>
          <div class="friendActions">
            <button class="friendBtnChat" data-open-chat="${escapeHtml(friend.username)}" type="button">Chat</button>
            <button class="friendBtnRemove" data-remove-friend="${escapeHtml(friend.username)}" type="button">Remove</button>
          </div>
        </div>
      `
    )
    .join("");

  friendsList.querySelectorAll("[data-open-chat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.getAttribute("data-open-chat");
      await openPrivateChat(username);
    });
  });

  friendsList.querySelectorAll("[data-remove-friend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.getAttribute("data-remove-friend");
      await removeFriend(username);
    });
  });
}

function renderFriendRequests() {
  if (!friendRequestsList) return;

  if (!state.friendRequests.length) {
    friendRequestsList.innerHTML = `<div class="emptyCardText">No pending requests.</div>`;
    return;
  }

  friendRequestsList.innerHTML = state.friendRequests
    .map(
      (req) => `
        <div class="friendRequestRow">
          <div class="friendName">${escapeHtml(req.fromUsername)}</div>
          <div class="friendActions">
            <button class="friendBtnAccept" data-accept-request="${req.id}" type="button">Accept</button>
            <button class="friendBtnDeny" data-deny-request="${req.id}" type="button">Deny</button>
          </div>
        </div>
      `
    )
    .join("");

  friendRequestsList.querySelectorAll("[data-accept-request]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await acceptFriendRequest(Number(btn.getAttribute("data-accept-request")));
    });
  });

  friendRequestsList.querySelectorAll("[data-deny-request]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await denyFriendRequest(Number(btn.getAttribute("data-deny-request")));
    });
  });
}

async function searchFriends(query) {
  if (!friendSearchResults) return;

  const q = String(query || "").trim();
  if (!q) {
    friendSearchResults.innerHTML = "";
    return;
  }

  const data = await api(`/api/friends/search?q=${encodeURIComponent(q)}`, null, "GET");
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    friendSearchResults.innerHTML = `<div class="emptyCardText">No matching accounts.</div>`;
    return;
  }

  friendSearchResults.innerHTML = items
    .map(
      (user) => `
        <div class="friendSearchRow">
          <div class="friendName">${escapeHtml(user.username)}</div>
          <div class="friendActions">
            <button class="friendBtnAdd" data-add-friend="${escapeHtml(user.username)}" type="button">Add</button>
          </div>
        </div>
      `
    )
    .join("");

  friendSearchResults.querySelectorAll("[data-add-friend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const username = btn.getAttribute("data-add-friend");
      await sendFriendRequest(username);
    });
  });
}

async function sendFriendRequest(username) {
  const data = await api("/api/friends/request", { username });
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  setFriendsStatus(`Friend request sent to ${username}.`);
  showToast(`Friend request sent to ${username}`);
}

async function acceptFriendRequest(requestId) {
  const data = await api("/api/friends/accept", { requestId });
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  setFriendsStatus("Friend request accepted.");
  await Promise.all([refreshFriendsList(), refreshFriendRequests()]);
}

async function denyFriendRequest(requestId) {
  const data = await api("/api/friends/deny", { requestId });
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  setFriendsStatus("Friend request denied.");
  await refreshFriendRequests();
}

async function removeFriend(username) {
  const data = await api("/api/friends/remove", { username });
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  setFriendsStatus(`${username} removed from friends.`);
  if (state.activePrivateChat === username) {
    closePrivateChat();
  }
  await refreshFriendsList();
}

function updateMenuMusicVisibility() {
  if (!menuMusicPlayer) return;
  menuMusicPlayer.classList.toggle("chatHidden", Boolean(state.activePrivateChat));
}

function renderPrivateChat() {
  if (!privateChatCard || !privateChatMessages) return;

  const friend = state.activePrivateChat;
  if (!friend) {
    privateChatCard.classList.add("hidden");
    updateMenuMusicVisibility();
    return;
  }

  privateChatCard.classList.remove("hidden");
  updateMenuMusicVisibility();
  privateChatTitle.textContent = `Chat with ${friend}`;

  const items = state.privateChats[friend] || [];
  privateChatMessages.innerHTML = items
    .map((msg) => {
      const mine = msg.fromUsername === currentUser?.username;
      return `
        <div class="privateMsg ${mine ? "me" : "them"}">
          ${escapeHtml(msg.message)}
        </div>
      `;
    })
    .join("");

  privateChatMessages.scrollTop = privateChatMessages.scrollHeight;
}

async function openPrivateChat(username) {
  const data = await api(`/api/private-messages/${encodeURIComponent(username)}`, null, "GET");
  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  state.activePrivateChat = username;
  state.privateChats[username] = Array.isArray(data.items) ? data.items : [];
  renderPrivateChat();
}

function closePrivateChat() {
  state.activePrivateChat = null;
  renderPrivateChat();
}

async function sendPrivateMessage() {
  const toUsername = state.activePrivateChat;
  const message = String(privateChatInput?.value || "").trim();

  if (!toUsername || !message) return;

  const data = await api("/api/private-messages/send", {
    toUsername,
    message
  });

  if (data.error) {
    setFriendsStatus(data.error, true);
    return;
  }

  if (!state.privateChats[toUsername]) {
    state.privateChats[toUsername] = [];
  }

  state.privateChats[toUsername].push(data.item);
  privateChatInput.value = "";
  renderPrivateChat();
}

async function refreshMenuData() {
  if (!currentUser) return;

  const results = await Promise.allSettled([
    refreshMenuWalletLeaderboard(),
    refreshFriendsList(),
    refreshFriendRequests(),
    refreshWallet()
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("MENU DATA REFRESH ERROR:", result.reason);
    }
  }
}

async function loadMusicPlaylist() {
  const data = await api("/api/music/playlist", null, "GET");
  if (data.error) return;

  state.musicPlaylist = Array.isArray(data.items) ? data.items : [];
  state.musicReady = state.musicPlaylist.length > 0;

  const savedIndex = Number(localStorage.getItem("pipo_music_index") || 0);
  if (state.musicPlaylist.length > 0) {
    state.currentTrackIndex = Math.max(0, Math.min(savedIndex, state.musicPlaylist.length - 1));
    setCurrentTrack(state.currentTrackIndex, false);
  } else {
    if (musicSongName) musicSongName.textContent = "No song loaded";
    if (musicPlayPauseBtn) musicPlayPauseBtn.textContent = "▶";
  }
}

function loadMusicSettings() {
  const savedMuted = localStorage.getItem("pipo_music_muted");
  const savedVolume = localStorage.getItem("pipo_music_volume");

  state.musicMuted = savedMuted === "true";
  state.musicVolume = savedVolume ? Number(savedVolume) : 0.4;

  if (musicVolumeRange) {
    musicVolumeRange.value = String(state.musicVolume);
  }

  applyMusicSettings();
}

function applyMusicSettings() {
  if (menuMusic) {
    menuMusic.volume = state.musicMuted ? 0 : state.musicVolume;
  }

  localStorage.setItem("pipo_music_muted", String(state.musicMuted));
  localStorage.setItem("pipo_music_volume", String(state.musicVolume));

  updatePlayPauseButton();
}

function updatePlayPauseButton() {
  if (!musicPlayPauseBtn || !menuMusic) return;

  const isPlaying = !menuMusic.paused && !menuMusic.ended;
  musicPlayPauseBtn.textContent = isPlaying ? "⏸" : "▶";
}

function setCurrentTrack(index, autoplay = false) {
  if (!menuMusic || !state.musicPlaylist.length) return;

  state.currentTrackIndex = (index + state.musicPlaylist.length) % state.musicPlaylist.length;
  const track = state.musicPlaylist[state.currentTrackIndex];

  menuMusic.src = track.url;
  if (musicSongName) musicSongName.textContent = track.title || track.filename || "Unknown song";
  localStorage.setItem("pipo_music_index", String(state.currentTrackIndex));

  if (autoplay) {
    tryStartMenuMusic();
  } else {
    updatePlayPauseButton();
  }
}

async function tryStartMenuMusic() {
  if (!menuMusic || !state.musicReady || !state.musicPlaylist.length) return;
  if (inMatch) return;

  try {
    await menuMusic.play();
    updatePlayPauseButton();
  } catch {
    updatePlayPauseButton();
  }
}

function pauseMenuMusic() {
  if (!menuMusic) return;
  menuMusic.pause();
  updatePlayPauseButton();
}

function toggleMusicPlayback() {
  if (!menuMusic || !state.musicReady || !state.musicPlaylist.length) return;

  if (menuMusic.paused) {
    tryStartMenuMusic();
  } else {
    pauseMenuMusic();
  }
}

function closeMusicPlayer() {
  if (!menuMusicPlayer) return;
  pauseMenuMusic();
  menuMusicPlayer.classList.add("hidden");
}

function playNextTrack() {
  if (!state.musicPlaylist.length) return;
  setCurrentTrack(state.currentTrackIndex + 1, !inMatch);
}

function playPrevTrack() {
  if (!state.musicPlaylist.length) return;
  setCurrentTrack(state.currentTrackIndex - 1, !inMatch);
}

async function checkSession() {
  let data = null;
  try {
    data = await api("/api/me");
  } catch (err) {
    console.error("SESSION CHECK FETCH ERROR:", err);
    data = { user: null };
  }

  const user = (data && data.user) || null;
  try { updateAuthUi(user); } catch (e) { console.error(e); }
  if (!user) return;

  try {
    await reconnectSocketAfterAuth();
  } catch (sockErr) {
    console.error("SESSION CHECK SOCKET ERROR:", sockErr);
    setMenuStatus("Live connection failed. Reload the page if needed.", true);
  }

  try {
    await refreshMenuData();
  } catch (menuErr) {
    console.error("SESSION CHECK MENU REFRESH ERROR:", menuErr);
  }
}

const stateChatMessages = [];

function renderChat() {
  if (!chatMessagesEl) return;

  chatMessagesEl.innerHTML = stateChatMessages
    .map(
      (msg) => `
        <div class="chatMessage">
          <span class="chatName">${escapeHtml(msg.name)}:</span>
          <span>${escapeHtml(msg.text)}</span>
        </div>
      `
    )
    .join("");

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function pushChatMessage(msg) {
  stateChatMessages.push(msg);
  while (stateChatMessages.length > 40) {
    stateChatMessages.shift();
  }
  renderChat();
}

function setChatOpen(open) {
  chatOpen = !!open && inMatch;
  if (!chatBox) return;

  chatBox.style.display = chatOpen ? "block" : "none";

  if (chatOpen && chatInput) {
    setTimeout(() => chatInput.focus(), 0);
  } else {
    if (chatInput) chatInput.blur();
  }
}

function spawnMoneySigns(container, count) {
  if (!container) return;

  container.innerHTML = "";

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "moneySign";
    el.textContent = "$";
    el.style.left = Math.random() * 100 + "%";
    el.style.fontSize = 18 + Math.random() * 42 + "px";
    el.style.animationDuration = 7 + Math.random() * 8 + "s";
    el.style.animationDelay = Math.random() * 8 + "s";
    container.appendChild(el);
  }
}

function spawnBackgroundBalls(container, count) {
  if (!container) return;

  container.innerHTML = "";
  const colors = ["#4db2ff", "#3bd36c", "#ffca28", "#b27cff", "#ff7aa8"];

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "bgBall";

    const size = 26 + Math.random() * 78;
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${Math.random() * 100}%`;
    el.style.background = `radial-gradient(circle at 30% 30%, #ffffff, ${color})`;
    el.style.animationDuration = `${9 + Math.random() * 10}s`;
    el.style.animationDelay = `${Math.random() * 8}s`;

    container.appendChild(el);
  }
}

function normalizeBallColor(color) {
  const normalized = String(color || "").trim().toLowerCase();
  const match = ALLOWED_BALL_COLORS.find((item) => item.value.toLowerCase() === normalized);
  return match ? match.value : DEFAULT_BALL_COLOR;
}

function getBallColorMeta(color) {
  const normalized = normalizeBallColor(color).toLowerCase();
  return (
    ALLOWED_BALL_COLORS.find((item) => item.value.toLowerCase() === normalized) ||
    ALLOWED_BALL_COLORS[ALLOWED_BALL_COLORS.length - 1]
  );
}

function setSelectedBallColor(color) {
  if (!colorInput) return;

  const meta = getBallColorMeta(color);
  colorInput.value = meta.value;

  document.querySelectorAll(".colorSwatch").forEach((btn) => {
    const swatchColor = String(btn.getAttribute("data-color") || "").toLowerCase();
    btn.classList.toggle("active", swatchColor === meta.value.toLowerCase());
  });

  updateColorPreview();
}

function updateColorPreview() {
  if (!colorPreviewBall || !colorInput) return;

  const meta = getBallColorMeta(colorInput.value);
  colorPreviewBall.style.background = meta.value;

  const previewName = document.getElementById("colorPreviewName");
  if (previewName) {
    previewName.textContent = meta.name;
  }
}

function worldToScreen(x, y) {
  return {
    x: (x - state.cameraX) * state.zoom + W / 2,
    y: (y - state.cameraY) * state.zoom + H / 2
  };
}

function getMyPlayer() {
  if (state.spectating && state.spectateTargetId) {
    return state.players.find((p) => p.id === state.spectateTargetId) || null;
  }
  return state.players.find((p) => p.id === state.myId) || null;
}

function getMyCenter() {
  const me = getMyPlayer();
  if (!me || !me.cells.length) return { x: 0, y: 0 };

  let total = 0;
  let sx = 0;
  let sy = 0;

  for (const cell of me.cells) {
    total += cell.mass;
    sx += cell.x * cell.mass;
    sy += cell.y * cell.mass;
  }

  return { x: sx / total, y: sy / total };
}

function getMyTotalMass() {
  const me = getMyPlayer();
  if (!me) return 0;
  return me.cells.reduce((sum, c) => sum + c.mass, 0);
}

function updateCamera() {
  const me = getMyPlayer();
  if (!me || !me.cells.length) return;

  const center = getMyCenter();
  const totalMass = getMyTotalMass();
  const biggestCellMass = Math.max(...me.cells.map((c) => c.mass));
  const biggestRadius = radiusFromMass(biggestCellMass);

  // Frame-rate independent camera — same feel at 60 or 144Hz
  const camAlpha = 1 - Math.pow(0.82, 60 / (1000 / Math.max(8, performance.now() - (_lastFrameTime || performance.now()))));
  state.cameraX += (center.x - state.cameraX) * Math.min(1, camAlpha * 2.2);
  state.cameraY += (center.y - state.cameraY) * Math.min(1, camAlpha * 2.2);

  const fitZoomX = (W * 0.22) / Math.max(biggestRadius, 1);
  const fitZoomY = (H * 0.22) / Math.max(biggestRadius, 1);
  const fitZoom = Math.min(fitZoomX, fitZoomY);
  const massZoom = 1.1 / Math.pow(Math.max(totalMass, 20), 0.16);
  const targetZoom = Math.min(fitZoom, massZoom);

  // Zoom in snappier, zoom out a touch slower (feels more natural)
  const zoomDiff = targetZoom - state.zoom;
  state.zoom += zoomDiff * (zoomDiff > 0 ? 0.10 : 0.16);
  state.zoom = Math.max(0.02, Math.min(1.2, state.zoom));
}

function drawExtractionIndicator() {
  const me = getMyPlayer();
  if (!me || !me.extracting) return;

  const center = getMyCenter();
  const s = worldToScreen(center.x, center.y);

  const progress = Math.max(0, Math.min(1, (me.extractTicks || 0) / EXTRACTION_TICKS));
  const radius = 42;

  ctx.beginPath();
  ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(s.x, s.y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.strokeStyle = "#39ff76";
  ctx.lineWidth = 7;
  ctx.stroke();

  ctx.fillStyle = "#39ff76";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 14px Arial";
  ctx.fillText(`Extracting ${Math.ceil((1 - progress) * EXTRACTION_SECONDS)}s`, s.x, s.y - 58);
}

function drawGrid() {
  const grid = 50 * state.zoom;
  if (grid >= 8) {
    const offsetX = ((-state.cameraX * state.zoom) % grid + grid) % grid;
    const offsetY = ((-state.cameraY * state.zoom) % grid + grid) % grid;

    // Single path for all grid lines — huge perf win over one stroke() per line
    ctx.beginPath();
    ctx.strokeStyle = "#ececec";
    ctx.lineWidth = 1;
    for (let x = offsetX; x <= W; x += grid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = offsetY; y <= H; y += grid) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  const center = worldToScreen(0, 0);
  const radius = (state.worldSize / 2) * state.zoom;

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#cfcfcf";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawFood() {
  // Group food by color and draw each group as a single path — massive batching win
  const rr = 8 * state.zoom; // food radius is always 8
  if (rr < 0.5) return; // too small to see, skip entirely

  const byColor = new Map();
  for (const f of state.food) {
    const sx = (f.x - state.cameraX) * state.zoom + W / 2;
    const sy = (f.y - state.cameraY) * state.zoom + H / 2;
    if (sx < -rr || sx > W + rr || sy < -rr || sy > H + rr) continue;
    let arr = byColor.get(f.color);
    if (!arr) { arr = []; byColor.set(f.color, arr); }
    arr.push(sx, sy);
  }
  for (const [color, pts] of byColor) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      ctx.moveTo(pts[i] + rr, pts[i + 1]);
      ctx.arc(pts[i], pts[i + 1], rr, 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawViruses() {
  const spikes = 18;
  // Batch all virus fills, then all virus strokes — 2 draw calls total
  ctx.beginPath();
  for (const virus of state.viruses) {
    const sx = (virus.x - state.cameraX) * state.zoom + W / 2;
    const sy = (virus.y - state.cameraY) * state.zoom + H / 2;
    const rr = virus.r * state.zoom;
    if (sx < -rr * 1.5 || sx > W + rr * 1.5 || sy < -rr * 1.5 || sy > H + rr * 1.5) continue;
    for (let i = 0; i <= spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const rad = rr * (i % 2 === 0 ? 1.14 : 0.88);
      const px = sx + Math.cos(a) * rad;
      const py = sy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.fillStyle = "#33d65c";
  ctx.fill();
  ctx.strokeStyle = "#239842";
  ctx.lineWidth = Math.max(1, 2 * state.zoom);
  ctx.stroke();
}

function drawPlayers() {
  // state.players already has totalMass from the server — use it, avoid re-summing
  const sorted = [...state.players].sort((a, b) => (a.totalMass || 0) - (b.totalMass || 0));

  for (const player of sorted) {
    const totalMass = player.totalMass || 1;
    const totalValue = Number(player.cashValue || 0);

    for (const cell of player.cells) {
      const s = worldToScreen(cell.x, cell.y);
      const r = radiusFromMass(cell.mass) * state.zoom;

      if (s.x < -r * 2 || s.x > W + r * 2 || s.y < -r * 2 || s.y > H + r * 2) continue;

      // Draw cell fill
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();

      // Shine highlight — small inner arc gives depth without gradient overhead
      if (r > 8) {
        ctx.beginPath();
        ctx.arc(s.x - r * 0.28, s.y - r * 0.28, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fill();
      }

      // Outline
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = Math.min(3, Math.max(1.5, r * 0.04));
      ctx.stroke();

      if (r > 18) {
        const cellValue = totalValue * (cell.mass / totalMass);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const nameFontSize = Math.max(13, r * 0.30) | 0;
        ctx.font = `bold ${nameFontSize}px Arial`;
        ctx.fillStyle = "#fff";
        ctx.fillText(player.name, s.x, s.y - r * 0.18);

        const valFontSize = Math.max(11, r * 0.22) | 0;
        ctx.font = `bold ${valFontSize}px Arial`;
        ctx.fillStyle = "#22c55e";
        ctx.fillText(formatBallMoney(cellValue), s.x, s.y + r * 0.26);
      }
    }
  }
}

function drawMinimap() {
  const mapW = 170;
  const mapH = 170;
  const x = W - mapW - 16;
  const y = H - mapH - 16;

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(x, y, mapW, mapH);
  ctx.strokeStyle = "#d0d0d0";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, mapW, mapH);

  for (const virus of state.viruses) {
    const mx = x + ((virus.x + state.worldSize / 2) / state.worldSize) * mapW;
    const my = y + ((virus.y + state.worldSize / 2) / state.worldSize) * mapH;
    ctx.fillStyle = "#33d65c";
    ctx.fillRect(mx - 1, my - 1, 3, 3);
  }

  for (const p of state.players) {
    if (!p.cells.length) continue;

    let total = 0;
    let sx = 0;
    let sy = 0;

    for (const c of p.cells) {
      total += c.mass;
      sx += c.x * c.mass;
      sy += c.y * c.mass;
    }

    const centerX = sx / total;
    const centerY = sy / total;

    const mx = x + ((centerX + state.worldSize / 2) / state.worldSize) * mapW;
    const my = y + ((centerY + state.worldSize / 2) / state.worldSize) * mapH;

    ctx.fillStyle = p.id === state.myId ? "#33c3ff" : (p.isBot ? "#55aa55" : "#888");
    ctx.beginPath();
    ctx.arc(mx, my, p.id === state.myId ? 4 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateHud() {
  if (massValue) {
    massValue.textContent = Math.floor(getMyTotalMass());
  }

  if (!gameLeaderboardEntries) return;

  if (!state.leaderboard.length) {
    gameLeaderboardEntries.innerHTML = `<div class="emptyCardText">No players yet.</div>`;
    return;
  }

  gameLeaderboardEntries.innerHTML = state.leaderboard
    .map(
      (entry, i) =>
        `<div>${i + 1}. ${escapeHtml(entry.name)} - ${entry.mass} - <span style="color:#39ff76;font-weight:700">${formatBallMoney(entry.value || 0)}</span></div>`
    )
    .join("");
}

function render() {
  if (!inMatch && !state.spectating) return; // nothing to render outside a match
  ctx.fillStyle = "#f8f9fb";
  ctx.fillRect(0, 0, W, H);
  drawGrid();
  drawFood();
  drawViruses();
  drawPlayers();
  drawExtractionIndicator();
  drawMinimap();
  updateHud();
}

function cloneStateForSnapshot(serverState) {
  return {
    worldSize: serverState.worldSize,
    food: (serverState.food || []).map((f) => ({ ...f })),
    viruses: (serverState.viruses || []).map((v) => ({ ...v })),
    leaderboard: (serverState.leaderboard || []).map((e) => ({ ...e })),
    wallet: typeof serverState.wallet !== "undefined" ? Number(serverState.wallet || 0) : undefined,
    players: (serverState.players || []).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: !!p.isBot,
      cashValue: Number(p.cashValue || 0),
      extracting: !!p.extracting,
      extractTicks: Number(p.extractTicks || 0),
      totalMass: p.totalMass,
      cells: (p.cells || []).map((c) => ({ ...c }))
    }))
  };
}

function interpolatePlayers(older, newer, alpha) {
  const oldMap = new Map((older.players || []).map((p) => [p.id, p]));
  const newMap = new Map((newer.players || []).map((p) => [p.id, p]));
  const out = [];

  for (const [id, newPlayer] of newMap) {
    const oldPlayer = oldMap.get(id) || newPlayer;
    const oldCells = oldPlayer.cells;

    out.push({
      ...newPlayer,
      cells: newPlayer.cells.map((newCell) => {
        // Match each new cell to the nearest old cell by position
        // This prevents index-mismatch teleports after splits/merges
        let bestCell = oldCells[0] || newCell;
        let bestDist = Infinity;
        for (let k = 0; k < oldCells.length; k++) {
          const oc = oldCells[k];
          const dx = oc.x - newCell.x;
          const dy = oc.y - newCell.y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; bestCell = oc; }
        }
        return {
          ...newCell,
          x: lerp(bestCell.x, newCell.x, alpha),
          y: lerp(bestCell.y, newCell.y, alpha)
        };
      })
    });
  }

  return out;
}

function getInterpolatedState() {
  if (snapshots.length === 0) return null;
  if (snapshots.length === 1) return snapshots[0].state;

  const renderTime = Date.now() - INTERPOLATION_DELAY;

  let older = snapshots[0];
  let newer = snapshots[snapshots.length - 1];

  for (let i = 0; i < snapshots.length - 1; i++) {
    if (snapshots[i].time <= renderTime && snapshots[i + 1].time >= renderTime) {
      older = snapshots[i];
      newer = snapshots[i + 1];
      break;
    }
  }

  if (renderTime >= snapshots[snapshots.length - 1].time) {
    return snapshots[snapshots.length - 1].state;
  }

  const span = newer.time - older.time || 1;
  const alpha = Math.max(0, Math.min(1, (renderTime - older.time) / span));

  return {
    worldSize: newer.state.worldSize,
    food: newer.state.food,
    viruses: newer.state.viruses,
    leaderboard: newer.state.leaderboard,
    wallet: newer.state.wallet,
    players: interpolatePlayers(older.state, newer.state, alpha)
  };
}

window.addEventListener("mousemove", (e) => {
  state.mouseX = e.clientX - W / 2;
  state.mouseY = e.clientY - H / 2;
});

window.addEventListener("keydown", (e) => {
  if (e.key === "\\") {
    e.preventDefault();
    if (inMatch) {
      setChatOpen(!chatOpen);
    }
    return;
  }

  if (state.spectating && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    socket.emit("spectateSwitch", { direction: e.key === "ArrowRight" ? 1 : -1 });
    return;
  }

  if (e.key === "q" || e.key === "Q") {
    state.extracting = true;
  }

  if (chatOpen) return;
  if (!inMatch) return;

  if (e.code === "Space") {
    e.preventDefault();
    state.splitQueued = true;
  }

  if (e.key === "w" || e.key === "W") {
    state.ejectQueued = true;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "q" || e.key === "Q") {
    state.extracting = false;
  }
});

async function joinGame() {
  // If already in queue, this button press = cancel
  if (isInMatchmakingQueue) {
    await cancelQueue();
    return;
  }

  if (isJoinInFlight || inMatch) return;

  if (!currentUser) {
    setAuthStatus("You must log in first.", true);
    showLandingWithAuth();
    return;
  }

  isJoinInFlight = true;
  setMenuStatus("");
  setWalletStatus("");

  try {
    const data = await api("/api/game/enter", { stake: selectedStake });

    if (data.error) {
      setMenuStatus(data.error, true);
      isJoinInFlight = false;
      setPlayButtonState(false);
      return;
    }

    if (typeof data.wallet !== "undefined") {
      updateWalletUi(data.wallet);
      currentUser.credits = Number(data.wallet || 0);
    }

    await reconnectSocketAfterAuth();

    socket.emit("join", {
      name: (nameInput?.value || "").trim() || "Player",
      color: normalizeBallColor(colorInput ? colorInput.value : DEFAULT_BALL_COLOR)
    });
  } catch (err) {
    console.error("JOIN GAME ERROR:", err);
    setMenuStatus("Failed to start match.", true);
    isJoinInFlight = false;
    setPlayButtonState(false);
  }
}

async function cancelQueue() {
  try {
    socket.emit("cancelQueue");
    await api("/api/game/cancel", {});
  } catch (err) {
    console.error("CANCEL QUEUE ERROR:", err);
  }
  isInMatchmakingQueue = false;
  isJoinInFlight = false;
  setPlayButtonState(false);
  setMenuStatus("Cancelled queue.");
  hideMatchmakingStatus();
}

function showMatchmakingStatus(data) {
  const stake = data.stake || selectedStake;
  const count = data.queueCount || 1;
  const cd = data.countdown;
  const names = (data.players || []).map(p => p.name).join(", ");

  let msg = `⏳ Waiting for players with $${stake} stake... (${count} in queue: ${names})`;
  if (cd !== null && cd !== undefined) {
    msg = `🟢 Match found! Starting in ${cd}s... (${names})`;
  }
  setMenuStatus(msg, false);
}

function hideMatchmakingStatus() {
  setMenuStatus("");
}

// ─── SOLANA DEPOSIT MODAL ─────────────────────────────────────────────────────

let _depositPollTimer = null;
let _depositId = null;

function openDepositModal({ address, solAmount, usdAmount, expiresAt, depositId, solPriceUsd }) {
  _depositId = depositId;

  // Build modal HTML
  const expiryMins = Math.ceil((expiresAt - Date.now()) / 60000);
  const solanaExplorerUrl = `https://explorer.solana.com/address/${address}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=solana:${address}?amount=${solAmount}`;

  const modal = document.createElement("div");
  modal.id = "solDepositModal";
  modal.style.cssText = `
    position:fixed;inset:0;z-index:200;display:grid;place-items:center;
    background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
  `;
  modal.innerHTML = `
    <div style="
      background:#1a1a1a;border:1px solid #2e2e2e;border-radius:12px;
      padding:28px 24px;width:min(440px,calc(100vw-24px));
      box-shadow:0 8px 40px rgba(0,0,0,0.6);color:#fff;font-family:inherit;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-size:20px;font-weight:800">Add Funds</div>
        <button id="solDepositClose" style="
          background:#222;border:1px solid #333;color:#aaa;
          border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;
        ">✕ Close</button>
      </div>

      <div style="text-align:center;margin-bottom:18px">
        <img src="${qrUrl}" alt="QR Code" style="border-radius:8px;border:4px solid #39d353;width:180px;height:180px"/>
        <div style="margin-top:10px;font-size:13px;color:#888">Scan with your Solana wallet app</div>
      </div>

      <div style="background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Send exactly</div>
        <div style="font-size:26px;font-weight:900;color:#39d353">${solAmount} SOL</div>
        <div style="font-size:13px;color:#888;margin-top:2px">≈ $${usdAmount.toFixed(2)} USD · Rate: $${solPriceUsd.toFixed(2)}/SOL</div>
      </div>

      <div style="background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">To address</div>
        <div style="font-size:12px;color:#ccc;word-break:break-all;line-height:1.5">${address}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button id="solCopyAddr" style="
            flex:1;background:#222;border:1px solid #39d353;color:#39d353;
            border-radius:6px;padding:8px;font-size:12px;cursor:pointer;font-weight:700;
          ">📋 Copy Address</button>
          <a href="${solanaExplorerUrl}" target="_blank" style="
            flex:1;background:#222;border:1px solid #333;color:#888;
            border-radius:6px;padding:8px;font-size:12px;cursor:pointer;font-weight:700;
            text-decoration:none;display:flex;align-items:center;justify-content:center;
          ">🔍 Explorer</a>
        </div>
      </div>

      <div id="solDepositStatus" style="
        text-align:center;padding:10px;border-radius:8px;
        background:#111;border:1px solid #2a2a2a;font-size:13px;color:#888;
      ">⏳ Waiting for your transaction… (${expiryMins} min window)</div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("solDepositClose").addEventListener("click", closeDepositModal);
  document.getElementById("solCopyAddr").addEventListener("click", () => {
    navigator.clipboard.writeText(address).then(() => {
      document.getElementById("solCopyAddr").textContent = "✅ Copied!";
      setTimeout(() => {
        const btn = document.getElementById("solCopyAddr");
        if (btn) btn.textContent = "📋 Copy Address";
      }, 2000);
    });
  });

  // Poll for confirmation every 5 seconds
  _depositPollTimer = setInterval(() => pollDepositStatus(depositId), 5000);
}

function closeDepositModal() {
  clearInterval(_depositPollTimer);
  _depositPollTimer = null;
  _depositId = null;
  document.getElementById("solDepositModal")?.remove();
}

async function pollDepositStatus(depositId) {
  try {
    const data = await api(`/api/solana/deposit/status/${depositId}`, null, "GET");
    if (!data || data.error) return;

    const statusEl = document.getElementById("solDepositStatus");
    if (!statusEl) return;

    if (data.status === "completed") {
      clearInterval(_depositPollTimer);
      statusEl.style.color = "#39d353";
      statusEl.style.borderColor = "#39d353";
      statusEl.textContent = `✅ Confirmed! +$${Number(data.creditedUsd || 0).toFixed(2)} added to your balance.`;
      await refreshWallet();
      await refreshMenuWalletLeaderboard();
      setTimeout(closeDepositModal, 3000);
    } else if (data.status === "expired") {
      clearInterval(_depositPollTimer);
      statusEl.style.color = "#ef4444";
      statusEl.textContent = "⏰ Deposit window expired. Please try again.";
    }
  } catch (err) {
    console.error("DEPOSIT POLL ERROR:", err);
  }
}

// Listen for server push (instant notification when webhook fires)
socket.on("balanceUpdate", async (data) => {
  if (data?.wallet !== undefined) {
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
  }
  if (data?.message) showToast(data.message);
  if (_depositId) {
    const statusEl = document.getElementById("solDepositStatus");
    if (statusEl) {
      statusEl.style.color = "#39d353";
      statusEl.textContent = `✅ ${data.message || "Balance updated!"}`;
    }
    clearInterval(_depositPollTimer);
    await refreshMenuWalletLeaderboard();
    setTimeout(closeDepositModal, 3000);
  }
});

socket.on("withdrawalComplete", (data) => {
  showToast(`💸 Cashout sent! ${data.solSent} SOL on-chain`);
  setWalletStatus(`Cashout complete — ${data.solSent} SOL sent. Tx: ${String(data.txid || "").slice(0,12)}…`);
});

socket.on("withdrawalFailed", async (data) => {
  showToast("❌ Withdrawal failed — balance refunded");
  setWalletStatus("Withdrawal failed — your balance has been refunded.", true);
  if (data?.wallet !== undefined) {
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
  }
});

async function handleAddBalance() {
  if (!currentUser) return;

  const amount = Number(walletAmountInput?.value || 0);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    setWalletStatus("Enter an amount between $1 and $500.", true);
    return;
  }

  addBalanceBtn.disabled = true;
  setWalletStatus("Getting deposit address…");

  try {
    const data = await api("/api/solana/deposit/create", { usdAmount: amount });
    if (data.error) {
      setWalletStatus(data.error, true);
      return;
    }

    setWalletStatus("");
    openDepositModal({
      address:     data.address,
      solAmount:   data.solAmount,
      usdAmount:   data.usdAmount,
      expiresAt:   data.expiresAt,
      depositId:   data.depositId,
      solPriceUsd: data.solPriceUsd,
    });
  } catch (err) {
    console.error("ADD BALANCE ERROR:", err);
    setWalletStatus("Failed to create deposit request.", true);
  } finally {
    addBalanceBtn.disabled = false;
  }
}

async function handleWithdraw() {
  if (!currentUser) return;

  const amount = Number(walletAmountInput?.value || 0);
  const address = String(withdrawAddressInput?.value || "").trim();

  if (!Number.isFinite(amount) || amount < 2) {
    setWalletStatus("Minimum withdrawal is $2.", true);
    return;
  }

  if (!address) {
    setWalletStatus("Enter your Solana wallet address.", true);
    return;
  }

  addBalanceBtn.disabled = true;
  withdrawBtn.disabled = true;
  setWalletStatus("Sending withdrawal…");

  try {
    const data = await api("/api/solana/withdraw", { usdAmount: amount, toAddress: address });
    if (data.error) {
      setWalletStatus(data.error, true);
      return;
    }

    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
    if (walletAmountInput) walletAmountInput.value = "";
    setWalletStatus(`Withdrawal processing… $${data.netUsd.toFixed(2)} net (3% fee). SOL sent shortly.`);
    await refreshMenuWalletLeaderboard();
  } catch (err) {
    console.error("WITHDRAW ERROR:", err);
    setWalletStatus("Failed to withdraw.", true);
  } finally {
    addBalanceBtn.disabled = false;
    withdrawBtn.disabled = false;
  }
}

playBtn?.addEventListener("click", joinGame);

nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    joinGame();
  }
});

startMenuBtn?.addEventListener("click", async () => {
  showLandingWithAuth();
  await tryStartMenuMusic();
});

stakeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    stakeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedStake = Number(btn.dataset.stake || 1);
  });
});

document.querySelectorAll(".colorSwatch").forEach((btn) => {
  btn.addEventListener("click", () => {
    setSelectedBallColor(btn.getAttribute("data-color") || DEFAULT_BALL_COLOR);
  });
});

musicCloseBtn?.addEventListener("click", closeMusicPlayer);

toggleFriendSearchBtn?.addEventListener("click", () => {
  friendSearchPanel?.classList.toggle("hidden");
  if (!friendSearchPanel?.classList.contains("hidden")) {
    friendSearchInput?.focus();
  }
});

friendSearchInput?.addEventListener("input", () => {
  clearTimeout(friendSearchTimer);
  friendSearchTimer = setTimeout(() => {
    searchFriends(friendSearchInput.value);
  }, 250);
});

sendPrivateChatBtn?.addEventListener("click", sendPrivateMessage);

privateChatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendPrivateMessage();
  }
});

closePrivateChatBtn?.addEventListener("click", closePrivateChat);

musicPlayPauseBtn?.addEventListener("click", toggleMusicPlayback);
musicNextBtn?.addEventListener("click", playNextTrack);
musicPrevBtn?.addEventListener("click", playPrevTrack);

musicVolumeRange?.addEventListener("input", () => {
  state.musicMuted = false;
  state.musicVolume = Number(musicVolumeRange.value || 0.4);
  applyMusicSettings();
  if (menuMusic && menuMusic.paused && !inMatch) {
    updatePlayPauseButton();
  }
});

// ── Roulette event wiring ──
document.getElementById("rouletteOpenBtn")?.addEventListener("click", openRouletteModal);
document.getElementById("closeRouletteBtn")?.addEventListener("click", closeRouletteModal);
document.getElementById("rouletteSpinBtn")?.addEventListener("click", handleRouletteSpin);
document.getElementById("rouletteClearBtn")?.addEventListener("click", () => {
  if (!state.rouletteSpinning) clearTableBets();
});

// Chip selector
document.querySelectorAll(".rouletteChip").forEach(btn => {
  btn.addEventListener("click", () => {
    if (state.rouletteSpinning) return;
    selectChip(Number(btn.dataset.chip));
  });
});

menuMusic?.addEventListener("ended", () => {
  playNextTrack();
});

menuMusic?.addEventListener("play", updatePlayPauseButton);
menuMusic?.addEventListener("pause", updatePlayPauseButton);

drawRouletteWheel(0);
setSelectedBallColor(DEFAULT_BALL_COLOR);
updateMenuMusicVisibility();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.rouletteOpen && !state.rouletteSpinning) closeRouletteModal();
    if (state.bjOpen && !state.bjPlaying) closeBlackjackModal();
  }
});

if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = chatInput.value.trim();
      if (text) {
        socket.emit("chat", text);
        chatInput.value = "";
      }
    }

    if (e.key === "Escape" || e.key === "\\") {
      e.preventDefault();
      setChatOpen(false);
    }

    e.stopPropagation();
  });
}

registerBtn?.addEventListener("click", async () => {
  try {
    const username = authUsername.value.trim();
    const password = authPassword.value;

    const data = await api("/api/register", { username, password });
    if (data.error) {
      setAuthStatus(data.error, true);
      return;
    }

    updateAuthUi(data.user);
    setAuthStatus(`Logged in as ${data.user?.username || username}`);

    try {
      await reconnectSocketAfterAuth();
    } catch (err) {
      console.error("POST-REGISTER SOCKET ERROR:", err);
      setMenuStatus("Account created, but live connection failed. Reload the page if needed.", true);
    }

    try {
      await refreshMenuData();
    } catch (err) {
      console.error("POST-REGISTER MENU REFRESH ERROR:", err);
    }

    setMenuStatus("Welcome bonus received: $5.00");
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    setAuthStatus("Failed to register.", true);
  }
});

loginBtn?.addEventListener("click", async () => {
  try {
    const username = authUsername.value.trim();
    const password = authPassword.value;

    const data = await api("/api/login", { username, password });
    if (data.error) {
      setAuthStatus(data.error, true);
      return;
    }

    updateAuthUi(data.user);
    setAuthStatus(`Logged in as ${data.user?.username || username}`);

    try {
      await reconnectSocketAfterAuth();
    } catch (err) {
      console.error("POST-LOGIN SOCKET ERROR:", err);
      setMenuStatus("Logged in, but live connection failed. Reload the page if needed.", true);
    }

    try {
      await refreshMenuData();
    } catch (err) {
      console.error("POST-LOGIN MENU REFRESH ERROR:", err);
    }
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    setAuthStatus(err?.message || "Failed to log in.", true);
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await api("/api/logout", {});
    updateAuthUi(null);
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    setAuthStatus("Failed to log out.", true);
  }
});

addBalanceBtn?.addEventListener("click", handleAddBalance);
withdrawBtn?.addEventListener("click", handleWithdraw);

postMatchSpectateBtn?.addEventListener("click", () => {
  socket.emit("spectateStart");
  state.spectating = true;
  updateSpectateStatusText();
});

postMatchQuitBtn?.addEventListener("click", () => {
  socket.emit("stopSpectating");
  closePostMatchOverlay();
  showMenu();
});

socket.on("connect", () => {
  state.connected = true;
  state.myId = socket.id;
});

socket.on("disconnect", () => {
  state.connected = false;
  inMatch = false;
  isInMatchmakingQueue = false;
  isJoinInFlight = false;
  setPlayButtonState(false);
  resetGameVisualState();

  if (isIntentionalReconnect) return;

  if (currentUser) {
    showMenu();
    setMenuStatus("Connection lost. Back in menu.", true);
  } else {
    showLandingWithAuth();
  }
});

socket.on("matchmakingQueued", (data) => {
  isInMatchmakingQueue = true;
  isJoinInFlight = false;
  setPlayButtonState(false); // re-renders as CANCEL
  showMatchmakingStatus(data);
});

socket.on("matchmakingUpdate", (data) => {
  showMatchmakingStatus(data);
});

socket.on("matchmakingCancelled", (data) => {
  isInMatchmakingQueue = false;
  isJoinInFlight = false;
  setPlayButtonState(false);
  setMenuStatus(data?.reason || "Queue cancelled.", true);
  hideMatchmakingStatus();
});

socket.on("matchmakingJoined", (data) => {
  isInMatchmakingQueue = false;
  isJoinInFlight = false;
  if (typeof data?.wallet !== "undefined") {
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
  }
});

socket.on("joined", (data) => {
  inMatch = true;
  hideMenusForGame();
  setPlayButtonState(false);
  setMenuStatus("");
  setWalletStatus("");
  closePostMatchOverlay();

  if (gameLeaderboard) gameLeaderboard.classList.remove("hidden");

  if (typeof data?.wallet !== "undefined") {
    updateWalletUi(data.wallet);
    if (currentUser) currentUser.credits = Number(data.wallet || 0);
  }
});

socket.on("joinError", (data) => {
  inMatch = false;
  resetGameVisualState();
  showMenu();
  setPlayButtonState(false);
  setMenuStatus(data?.error || "Failed to join match.", true);
});

socket.on("dead", async (data) => {
  inMatch = false;
  isInMatchmakingQueue = false;
  resetGameVisualState();
  hideMenusForGame();
  setPlayButtonState(false);
  setMenuStatus(data?.message || "You died.", true);
  openPostMatchOverlay({
    isDeath: true,
    stake: Number(data?.stake || 0),
    cashValue: Number(data?.cashValue || 0),
    tax: 0,
    takeHome: 0,
    killedBy: data?.by || "Unknown"
  });
  await refreshMenuData();
});

socket.on("chatHistory", (history) => {
  stateChatMessages.length = 0;
  for (const msg of history || []) {
    stateChatMessages.push(msg);
  }
  renderChat();
});

socket.on("chat", (msg) => {
  pushChatMessage(msg);
});

socket.on("state", (serverState) => {
  if (serverState?.spectating) {
    state.spectating = true;
    state.spectateTargetId = serverState.spectateTargetId || null;
    state.spectateTargetName = serverState.spectateTargetName || "";
    updateSpectateStatusText();
  }

  snapshots.push({
    time: Date.now(),
    state: cloneStateForSnapshot(serverState)
  });

  while (snapshots.length > SNAPSHOT_BUFFER) {
    snapshots.shift();
  }

  if (typeof serverState.wallet !== "undefined") {
    updateWalletUi(serverState.wallet);
    if (currentUser) currentUser.credits = Number(serverState.wallet || 0);
  }
});

socket.on("extracted", async (data) => {
  inMatch = false;
  isInMatchmakingQueue = false;
  resetGameVisualState();
  hideMenusForGame();
  setPlayButtonState(false);
  setMenuStatus(data?.message || "You extracted from the match.");
  openPostMatchOverlay({
    isDeath: false,
    isMatchWin: !!data?.isMatchWin,
    stake: Number(data?.stake || 0),
    cashValue: Number(data?.kept || 0),
    tax: Number(data?.tax || 0),
    takeHome: Number(data?.payout || 0),
    killedBy: "Nobody"
  });
  await refreshMenuData();
});

socket.on("extractFailed", (data) => {
  state.extracting = false;
  setMenuStatus(data?.error || "Extraction failed.", true);
});

socket.on("spectateStatus", (data) => {
  if (data?.error) {
    if (postMatchSpectateStatus) postMatchSpectateStatus.textContent = data.error;
    return;
  }

  state.spectating = true;
  state.spectateTargetId = data?.targetId || null;
  state.spectateTargetName = data?.targetName || "";
  updateSpectateStatusText();
});

socket.on("friendNotification", async (payload) => {
  if (!payload || !payload.type) return;

  if (payload.type === "friend_request") {
    showToast(`${payload.fromUsername} sent you a friend request`);
    await refreshFriendRequests();
  }

  if (payload.type === "friend_accept") {
    showToast(`${payload.fromUsername} accepted your friend request`);
    await refreshFriendsList();
  }
});

socket.on("privateMessage", (msg) => {
  const otherName =
    msg.fromUsername === currentUser?.username ? msg.toUsername : msg.fromUsername;

  if (!state.privateChats[otherName]) {
    state.privateChats[otherName] = [];
  }

  state.privateChats[otherName].push(msg);

  if (state.activePrivateChat === otherName) {
    renderPrivateChat();
  } else {
    showToast(`New message from ${msg.fromUsername}`);
  }
});

// Input is sent from the game loop (rAF) at display rate — no timer drift,
// tightest possible mouse-to-server latency.
let _lastInputTime = 0;
const INPUT_INTERVAL_MS = 16; // ~60Hz cap to avoid flooding on 120Hz displays

let _lastFrameTime = 0;
function loop() {
  const now = performance.now();
  // Send input at ~60Hz without timer drift
  if (state.connected && inMatch && now - _lastInputTime >= INPUT_INTERVAL_MS) {
    _lastInputTime = now;
    socket.emit("input", {
      mouseX: state.mouseX,
      mouseY: state.mouseY,
      split: state.splitQueued,
      eject: state.ejectQueued,
      extracting: state.extracting
    });
    state.splitQueued = false;
    state.ejectQueued = false;
  }

  const interpolated = getInterpolatedState();

  if (interpolated) {
    state.worldSize = interpolated.worldSize;
    state.food = interpolated.food;
    state.viruses = interpolated.viruses;
    state.players = interpolated.players;
    state.leaderboard = interpolated.leaderboard;

    if (typeof interpolated.wallet !== "undefined" && interpolated.wallet !== state.wallet) {
      updateWalletUi(interpolated.wallet);
    }
  }

  updateCamera();
  render();
  _lastFrameTime = performance.now();
  requestAnimationFrame(loop);
}

spawnMoneySigns(moneyBg, 28);
spawnBackgroundBalls(menuBallsBg, 24);
updateColorPreview();
loadMusicSettings();
loadMusicPlaylist();
checkSession();
loop();
setPlayButtonState(false);
