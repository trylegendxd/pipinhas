/**
 * solana-wallet.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all on-chain Solana logic for PIPO.IO:
 *   • HD key derivation  – each user gets a unique deposit address derived
 *                          from your single master keypair (BIP44 path)
 *   • SOL/USD pricing    – CoinGecko (free, no key required)
 *   • Deposit detection  – Helius webhook verifies incoming transactions
 *   • Withdrawals        – sends SOL from master wallet to user's address
 *
 * Required env vars:
 *   MASTER_WALLET_PRIVATE_KEY   Base-58 encoded private key of your hot wallet
 *   SOLANA_RPC_URL              e.g. https://mainnet.helius-rpc.com/?api-key=XXX
 *   HELIUS_WEBHOOK_SECRET       random string you set in the Helius dashboard
 *
 * Install dependencies:
 *   npm install @solana/web3.js ed25519-hd-key tweetnacl bs58
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

const { derivePath } = require("ed25519-hd-key");
const nacl            = require("tweetnacl");
const bs58            = require("bs58");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const RPC_URL              = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const MASTER_KEY_B58       = process.env.MASTER_WALLET_PRIVATE_KEY;
const WEBHOOK_SECRET       = process.env.HELIUS_WEBHOOK_SECRET || "";

// Minimum cashout in USD, and fee percentage kept by the house
const MIN_CASHOUT_USD      = 2;
const CASHOUT_FEE_PCT      = 0.03;   // 3 % house fee on withdrawals

// How long (ms) a deposit window stays open after creation
const DEPOSIT_WINDOW_MS    = 10 * 60 * 1000;  // 10 minutes

// Price cache — refresh at most every 60 s to avoid rate-limits
const PRICE_CACHE = { usdPerSol: null, fetchedAt: 0 };
const PRICE_CACHE_TTL_MS = 60_000;

// ─── MASTER KEYPAIR ───────────────────────────────────────────────────────────

let masterKeypair = null;

function getMasterKeypair() {
  if (masterKeypair) return masterKeypair;

  if (!MASTER_KEY_B58) {
    throw new Error(
      "MASTER_WALLET_PRIVATE_KEY env var is missing. " +
      "Generate a Solana keypair and set it before starting."
    );
  }

  const secretKey = bs58.decode(MASTER_KEY_B58);
  masterKeypair = Keypair.fromSecretKey(secretKey);
  return masterKeypair;
}

// ─── RPC CONNECTION ───────────────────────────────────────────────────────────

function getConnection() {
  return new Connection(RPC_URL, "finalized");
}

// ─── HD KEY DERIVATION ────────────────────────────────────────────────────────
//
// We use BIP44-style derivation so every user gets a deterministic, unique
// deposit address without needing to store private keys per user.
//
// Path: m/44'/501'/<userIndex>'/0'
//   501 = Solana's registered coin type
//
// The master seed is derived from the master keypair's secret key bytes.

function deriveDepositKeypair(userIndex) {
  const master = getMasterKeypair();
  // Use the raw secret bytes as our "seed" for HD derivation
  const seed = Buffer.from(master.secretKey.slice(0, 32));
  const path = `m/44'/501'/${userIndex}'/0'`;
  const { key } = derivePath(path, seed.toString("hex"));
  const kp = Keypair.fromSecretKey(
    nacl.sign.keyPair.fromSeed(key).secretKey
  );
  return kp;
}

/**
 * Returns the public deposit address for a given user DB index.
 * Store the index in the `users` table, not the private key.
 */
function getDepositAddress(userIndex) {
  return deriveDepositKeypair(userIndex).publicKey.toString();
}

// ─── SOL PRICE ────────────────────────────────────────────────────────────────

async function getSolPriceUSD() {
  const now = Date.now();
  if (PRICE_CACHE.usdPerSol && now - PRICE_CACHE.fetchedAt < PRICE_CACHE_TTL_MS) {
    return PRICE_CACHE.usdPerSol;
  }

  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { signal: AbortSignal.timeout(8000) }
  );

  if (!res.ok) throw new Error(`CoinGecko price fetch failed: ${res.status}`);
  const data = await res.json();
  const price = Number(data?.solana?.usd);
  if (!price || price < 1) throw new Error("Implausible SOL price returned");

  PRICE_CACHE.usdPerSol  = price;
  PRICE_CACHE.fetchedAt  = now;
  return price;
}

/** Convert a USD amount to the equivalent lamports (1 SOL = 1e9 lamports) */
async function usdToLamports(usd) {
  const price = await getSolPriceUSD();
  const sol   = usd / price;
  return Math.round(sol * LAMPORTS_PER_SOL);
}

/** Convert lamports to USD */
async function lamportsToUsd(lamports) {
  const price = await getSolPriceUSD();
  const sol   = lamports / LAMPORTS_PER_SOL;
  return Number((sol * price).toFixed(2));
}

// ─── DEPOSIT: create a pending deposit record ─────────────────────────────────

/**
 * Call this when a user clicks "Add Funds".
 * Returns the deposit address and the exact SOL amount they should send.
 *
 * @param {object} params
 * @param {number} params.userIndex     - sequential index stored per user in DB
 * @param {number} params.usdAmount     - requested USD top-up
 * @returns {{ address, solAmount, usdAmount, lamports, expiresAt }}
 */
async function createDepositRequest({ userIndex, usdAmount }) {
  const solPrice  = await getSolPriceUSD();
  const sol       = usdAmount / solPrice;
  const lamports  = Math.round(sol * LAMPORTS_PER_SOL);
  const address   = getDepositAddress(userIndex);
  const expiresAt = Date.now() + DEPOSIT_WINDOW_MS;

  return {
    address,
    solAmount:  Number(sol.toFixed(6)),
    usdAmount:  Number(usdAmount.toFixed(2)),
    lamports,
    expiresAt,
    solPriceUsd: solPrice,
  };
}

// ─── DEPOSIT: verify a transaction from Helius webhook ────────────────────────

/**
 * Verifies a Helius enhanced-transaction webhook payload.
 *
 * Helius sends a POST to your /api/solana/deposit-webhook endpoint.
 * This function:
 *   1. Checks the raw-body HMAC signature (if HELIUS_WEBHOOK_SECRET is set)
 *   2. Finds the SOL transfer targeting the user's deposit address
 *   3. Confirms the tx is "finalized" on-chain
 *   4. Returns { ok, signature, lamports, usdValue } or { ok: false, reason }
 *
 * @param {object} payload        - parsed JSON body from Helius
 * @param {string} depositAddress - the address we expect to receive SOL
 * @param {number} expectedLamports - what we told the user to send
 * @param {string} [rawBody]      - raw request body string for HMAC verification
 * @param {string} [signature]    - x-helius-signature header value
 */
async function verifyDepositTransaction({
  payload,
  depositAddress,
  expectedLamports,
  rawBody,
  signature: webhookSig,
}) {
  // ── 1. Optional HMAC check ────────────────────────────────────────────────
  if (WEBHOOK_SECRET && webhookSig && rawBody) {
    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    if (expected !== webhookSig) {
      return { ok: false, reason: "Invalid webhook signature" };
    }
  }

  // ── 2. Parse Helius enhanced-transaction format ───────────────────────────
  // Helius sends an array; take the first event
  const event = Array.isArray(payload) ? payload[0] : payload;
  if (!event) return { ok: false, reason: "Empty payload" };

  const txSig = event.signature;
  if (!txSig) return { ok: false, reason: "No signature in payload" };

  // ── 3. Find the native SOL transfer to depositAddress ────────────────────
  const transfers = event.nativeTransfers || [];
  const relevant  = transfers.filter(
    (t) => t.toUserAccount === depositAddress
  );

  if (!relevant.length) {
    return { ok: false, reason: "No transfer to deposit address found" };
  }

  const totalLamports = relevant.reduce((s, t) => s + Number(t.amount), 0);

  // Allow up to 2% slippage below expected (price may have moved slightly)
  const threshold = Math.floor(expectedLamports * 0.98);
  if (totalLamports < threshold) {
    return {
      ok: false,
      reason: `Received ${totalLamports} lamports, expected ≥ ${threshold}`,
      received: totalLamports,
      expected: expectedLamports,
    };
  }

  // ── 4. Re-confirm on-chain (belt-and-suspenders) ─────────────────────────
  const conn = getConnection();
  const confirmation = await conn.getSignatureStatus(txSig, {
    searchTransactionHistory: true,
  });

  const status = confirmation?.value?.confirmationStatus;
  if (status !== "finalized") {
    return { ok: false, reason: `Not finalized yet: ${status}` };
  }

  if (confirmation?.value?.err) {
    return { ok: false, reason: "Transaction failed on-chain" };
  }

  // ── 5. All good ───────────────────────────────────────────────────────────
  const usdValue = await lamportsToUsd(totalLamports);

  return {
    ok: true,
    signature: txSig,
    lamports: totalLamports,
    usdValue,
  };
}

// ─── WITHDRAWAL: send SOL from master wallet to user ─────────────────────────

/**
 * Sends SOL from the master hot wallet to `toAddress`.
 * Uses the user's requested USD amount, converts at current price,
 * deducts the house fee, then broadcasts.
 *
 * @param {object} params
 * @param {string} params.toAddress   - user's Solana wallet address
 * @param {number} params.usdAmount   - amount the user wants to withdraw (in USD)
 * @returns {{ ok, signature, solSent, usdSent, feePct, txid }}
 */
async function sendWithdrawal({ toAddress, usdAmount }) {
  if (usdAmount < MIN_CASHOUT_USD) {
    throw new Object.assign(new Error(`Minimum cashout is $${MIN_CASHOUT_USD}`), {
      code: "BELOW_MIN_CASHOUT",
    });
  }

  // Validate address
  let recipientPubkey;
  try {
    recipientPubkey = new PublicKey(toAddress);
  } catch {
    throw Object.assign(new Error("Invalid Solana wallet address"), {
      code: "INVALID_ADDRESS",
    });
  }

  // Apply house fee
  const netUsd     = usdAmount * (1 - CASHOUT_FEE_PCT);
  const lamports   = await usdToLamports(netUsd);
  const price      = await getSolPriceUSD();
  const solSent    = lamports / LAMPORTS_PER_SOL;

  const conn        = getConnection();
  const master      = getMasterKeypair();

  // Check hot-wallet balance
  const hotBalance  = await conn.getBalance(master.publicKey);
  const txFee       = 5000; // ~0.000005 SOL, conservative estimate
  if (hotBalance < lamports + txFee) {
    throw Object.assign(
      new Error("Hot wallet has insufficient SOL to cover this withdrawal"),
      { code: "HOT_WALLET_LOW" }
    );
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: master.publicKey,
      toPubkey:   recipientPubkey,
      lamports,
    })
  );

  const signature = await sendAndConfirmTransaction(conn, tx, [master], {
    commitment: "finalized",
  });

  return {
    ok: true,
    signature,
    txid: signature,
    solSent:  Number(solSent.toFixed(6)),
    usdSent:  Number(netUsd.toFixed(2)),
    feePct:   CASHOUT_FEE_PCT,
    solPriceUsd: price,
  };
}

// ─── HOT WALLET BALANCE ────────────────────────────────────────────────────────

async function getHotWalletBalance() {
  const conn     = getConnection();
  const master   = getMasterKeypair();
  const lamports = await conn.getBalance(master.publicKey);
  const price    = await getSolPriceUSD();
  const sol      = lamports / LAMPORTS_PER_SOL;

  return {
    lamports,
    sol:     Number(sol.toFixed(6)),
    usd:     Number((sol * price).toFixed(2)),
    address: master.publicKey.toString(),
  };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  getDepositAddress,
  createDepositRequest,
  verifyDepositTransaction,
  sendWithdrawal,
  getSolPriceUSD,
  lamportsToUsd,
  usdToLamports,
  getHotWalletBalance,
  MIN_CASHOUT_USD,
  CASHOUT_FEE_PCT,
};
