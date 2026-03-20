/**
 * solana-routes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Express routes for Solana deposit / withdrawal.
 * Mount in server.js with:
 *
 *   const mountSolanaRoutes = require("./solana-routes");
 *   mountSolanaRoutes(app, pool, { requireAuth, addCreditsTx, spendCreditsTx, getSessionUser });
 *
 * Then run:  node server.js
 *
 * New DB tables created automatically on startup (call initSolanaDb(pool) in
 * your initDb function, or it runs automatically when the routes are mounted).
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const {
  getDepositAddress,
  createDepositRequest,
  verifyDepositTransaction,
  sendWithdrawal,
  getSolPriceUSD,
  getHotWalletBalance,
  MIN_CASHOUT_USD,
  CASHOUT_FEE_PCT,
} = require("./solana-wallet");

// ─── DB INIT ──────────────────────────────────────────────────────────────────

async function initSolanaDb(pool) {
  // Each user gets a stable HD-derivation index (never changes, never reused)
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS sol_index      BIGINT UNIQUE,
      ADD COLUMN IF NOT EXISTS sol_address    TEXT,
      ADD COLUMN IF NOT EXISTS cashout_address TEXT
  `);

  // A sequence so each new user gets the next integer index
  await pool.query(`
    CREATE SEQUENCE IF NOT EXISTS sol_index_seq START 1
  `);

  // Deposit requests – one row per "Add Funds" click
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sol_deposits (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      address       TEXT NOT NULL,
      expected_usd  NUMERIC(12,2) NOT NULL,
      expected_lam  BIGINT NOT NULL,
      sol_price_usd NUMERIC(12,4) NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      tx_signature  TEXT,
      received_lam  BIGINT,
      credited_usd  NUMERIC(12,2),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL,
      completed_at  TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sol_deposits_user    ON sol_deposits(user_id);
    CREATE INDEX IF NOT EXISTS idx_sol_deposits_address ON sol_deposits(address);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sol_deposits_txsig
      ON sol_deposits(tx_signature) WHERE tx_signature IS NOT NULL
  `);

  // Withdrawal requests
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sol_withdrawals (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_address    TEXT NOT NULL,
      requested_usd NUMERIC(12,2) NOT NULL,
      net_usd       NUMERIC(12,2) NOT NULL,
      sol_sent      NUMERIC(18,9),
      sol_price_usd NUMERIC(12,4),
      tx_signature  TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      error_msg     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at  TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sol_withdrawals_user ON sol_withdrawals(user_id)
  `);

  console.log("[solana-routes] DB tables ready");
}

// ─── HELPER: assign a stable sol_index to a user if they don't have one ───────

async function ensureSolIndex(pool, userId) {
  // Fast path – already has an index
  const { rows } = await pool.query(
    `SELECT sol_index, sol_address FROM users WHERE id = $1`,
    [userId]
  );
  if (rows[0]?.sol_index != null) {
    return { index: Number(rows[0].sol_index), address: rows[0].sol_address };
  }

  // Assign the next sequence value atomically
  const { rows: seqRows } = await pool.query(`SELECT nextval('sol_index_seq') AS idx`);
  const index   = Number(seqRows[0].idx);
  const address = getDepositAddress(index);

  await pool.query(
    `UPDATE users SET sol_index = $1, sol_address = $2 WHERE id = $3`,
    [index, address, userId]
  );

  return { index, address };
}

// ─── MOUNT FUNCTION ───────────────────────────────────────────────────────────

function mountSolanaRoutes(app, pool, helpers) {
  const { requireAuth, addCreditsTx, spendCreditsTx } = helpers;

  // Run DB migrations immediately
  initSolanaDb(pool).catch((err) =>
    console.error("[solana-routes] initSolanaDb error:", err)
  );

  // ── GET /api/solana/price ──────────────────────────────────────────────────
  // Returns the current SOL/USD price. Cached 60 s.
  app.get("/api/solana/price", async (_req, res) => {
    try {
      const price = await getSolPriceUSD();
      res.json({ ok: true, usdPerSol: price });
    } catch (err) {
      console.error("[solana] price error:", err);
      res.status(503).json({ error: "Could not fetch SOL price." });
    }
  });

  // ── POST /api/solana/deposit/create ───────────────────────────────────────
  // Creates a deposit request. Returns the address + exact SOL to send.
  //
  // Body: { usdAmount: number }
  app.post("/api/solana/deposit/create", requireAuth, async (req, res) => {
    try {
      const usdAmount = Number(req.body?.usdAmount);

      if (!Number.isFinite(usdAmount) || usdAmount < 1 || usdAmount > 500) {
        return res.status(400).json({ error: "Amount must be between $1 and $500." });
      }

      const { index, address } = await ensureSolIndex(pool, req.user.id);

      const deposit = await createDepositRequest({ userIndex: index, usdAmount });

      // Save to DB
      const { rows } = await pool.query(
        `INSERT INTO sol_deposits
           (user_id, address, expected_usd, expected_lam, sol_price_usd, expires_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
         RETURNING id`,
        [
          req.user.id,
          address,
          deposit.usdAmount,
          deposit.lamports,
          deposit.solPriceUsd,
          deposit.expiresAt,
        ]
      );

      res.json({
        ok: true,
        depositId: Number(rows[0].id),
        address:   deposit.address,
        solAmount: deposit.solAmount,
        usdAmount: deposit.usdAmount,
        lamports:  deposit.lamports,
        expiresAt: deposit.expiresAt,
        solPriceUsd: deposit.solPriceUsd,
      });
    } catch (err) {
      console.error("[solana] deposit/create error:", err);
      res.status(500).json({ error: "Failed to create deposit request." });
    }
  });

  // ── GET /api/solana/deposit/status/:id ────────────────────────────────────
  // Poll this from the frontend to check if a deposit has been confirmed.
  app.get("/api/solana/deposit/status/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, status, credited_usd, tx_signature, expires_at
         FROM sol_deposits
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      if (!rows[0]) return res.status(404).json({ error: "Deposit not found." });

      const d = rows[0];
      // Check if expired
      if (d.status === "pending" && new Date(d.expires_at) < new Date()) {
        await pool.query(
          `UPDATE sol_deposits SET status = 'expired' WHERE id = $1`,
          [d.id]
        );
        d.status = "expired";
      }

      res.json({
        ok: true,
        depositId:   Number(d.id),
        status:      d.status,
        creditedUsd: d.credited_usd ? Number(d.credited_usd) : null,
        txSignature: d.tx_signature,
        expiresAt:   d.expires_at,
      });
    } catch (err) {
      console.error("[solana] deposit/status error:", err);
      res.status(500).json({ error: "Failed to get deposit status." });
    }
  });

  // ── POST /api/solana/deposit-webhook ──────────────────────────────────────
  // Helius calls this when SOL arrives at any watched address.
  // You must register this URL in your Helius dashboard and set the
  // HELIUS_WEBHOOK_SECRET env var to the same value.
  //
  // To watch all your deposit addresses, register them in Helius by address
  // OR use a program/account subscription for your master address range.
  app.post(
    "/api/solana/deposit-webhook",
    express_rawBody,          // raw body middleware — see note below
    async (req, res) => {
      // Respond 200 immediately so Helius doesn't retry
      res.json({ ok: true });

      try {
        const payload    = req.body;
        const rawBody    = req.rawBody;
        const webhookSig = req.headers["x-helius-signature"] || "";

        // Which address received SOL?
        const event     = Array.isArray(payload) ? payload[0] : payload;
        const transfers = event?.nativeTransfers || [];

        for (const transfer of transfers) {
          const toAddr = transfer.toUserAccount;
          if (!toAddr) continue;

          // Find a pending deposit for this address
          const { rows } = await pool.query(
            `SELECT d.id, d.user_id, d.expected_lam, d.expected_usd, d.status
             FROM sol_deposits d
             JOIN users u ON u.id = d.user_id
             WHERE d.address = $1
               AND d.status  = 'pending'
               AND d.expires_at > NOW()
             ORDER BY d.created_at DESC
             LIMIT 1`,
            [toAddr]
          );

          if (!rows[0]) continue; // no pending deposit for this address

          const dep = rows[0];

          const result = await verifyDepositTransaction({
            payload,
            depositAddress:   toAddr,
            expectedLamports: Number(dep.expected_lam),
            rawBody,
            signature: webhookSig,
          });

          if (!result.ok) {
            console.warn("[solana] webhook verify failed:", result.reason);
            continue;
          }

          // Idempotency: check txsig not already processed
          const { rows: dupeRows } = await pool.query(
            `SELECT id FROM sol_deposits WHERE tx_signature = $1`,
            [result.signature]
          );
          if (dupeRows.length > 0) {
            console.log("[solana] duplicate tx ignored:", result.signature);
            continue;
          }

          // Credit the user
          const creditedUsd = result.usdValue;
          const newBalance  = await addCreditsTx(
            dep.user_id,
            creditedUsd,
            "sol_deposit",
            `SOL deposit ${result.signature.slice(0, 12)}… (+$${creditedUsd})`
          );

          // Mark deposit as completed
          await pool.query(
            `UPDATE sol_deposits
             SET status = 'completed',
                 tx_signature = $1,
                 received_lam = $2,
                 credited_usd = $3,
                 completed_at = NOW()
             WHERE id = $4`,
            [result.signature, result.lamports, creditedUsd, dep.id]
          );

          console.log(
            `[solana] deposit confirmed for user ${dep.user_id}: +$${creditedUsd} (${result.signature})`
          );

          // Notify user via socket.io if they're online
          // (helpers.notifyUser is optional — see integration note)
          if (helpers.notifyUser) {
            helpers.notifyUser(dep.user_id, "balanceUpdate", {
              wallet: newBalance,
              message: `Deposit of $${creditedUsd} confirmed!`,
            });
          }
        }
      } catch (err) {
        console.error("[solana] webhook processing error:", err);
      }
    }
  );

  // ── POST /api/solana/withdraw ─────────────────────────────────────────────
  // User requests a cashout. Deducts from DB balance, sends SOL on-chain.
  //
  // Body: { usdAmount: number, toAddress: string }
  app.post("/api/solana/withdraw", requireAuth, async (req, res) => {
    try {
      const usdAmount = Number(req.body?.usdAmount);
      const toAddress = String(req.body?.toAddress || "").trim();

      if (!Number.isFinite(usdAmount) || usdAmount < MIN_CASHOUT_USD) {
        return res.status(400).json({
          error: `Minimum cashout is $${MIN_CASHOUT_USD}.`,
        });
      }

      if (!toAddress) {
        return res.status(400).json({ error: "Solana wallet address is required." });
      }

      // Save cashout address for next time
      await pool.query(
        `UPDATE users SET cashout_address = $1 WHERE id = $2`,
        [toAddress, req.user.id]
      );

      // Deduct from DB balance first (prevents double-spend)
      let walletAfter;
      try {
        walletAfter = await spendCreditsTx(
          req.user.id,
          usdAmount,
          "sol_withdraw_debit",
          `Withdrawal of $${usdAmount} to ${toAddress.slice(0, 8)}…`
        );
      } catch (err) {
        if (err.code === "INSUFFICIENT_CREDITS") {
          return res.status(400).json({ error: "Not enough balance." });
        }
        throw err;
      }

      // Insert withdrawal record
      const netUsd = usdAmount * (1 - CASHOUT_FEE_PCT);
      const { rows } = await pool.query(
        `INSERT INTO sol_withdrawals
           (user_id, to_address, requested_usd, net_usd, status)
         VALUES ($1, $2, $3, $4, 'processing')
         RETURNING id`,
        [req.user.id, toAddress, usdAmount, netUsd]
      );
      const withdrawalId = Number(rows[0].id);

      // Respond immediately — on-chain tx happens async
      res.json({
        ok: true,
        withdrawalId,
        wallet: walletAfter,
        requestedUsd: usdAmount,
        netUsd:       Number(netUsd.toFixed(2)),
        feePct:       CASHOUT_FEE_PCT,
        status:       "processing",
      });

      // Send on-chain asynchronously
      sendWithdrawal({ toAddress, usdAmount })
        .then(async (result) => {
          await pool.query(
            `UPDATE sol_withdrawals
             SET status = 'completed',
                 tx_signature  = $1,
                 sol_sent      = $2,
                 sol_price_usd = $3,
                 completed_at  = NOW()
             WHERE id = $4`,
            [result.signature, result.solSent, result.solPriceUsd, withdrawalId]
          );

          if (helpers.notifyUser) {
            helpers.notifyUser(req.user.id, "withdrawalComplete", {
              withdrawalId,
              txid:    result.signature,
              solSent: result.solSent,
              usdSent: result.usdSent,
              message: `Cashout of $${result.usdSent} sent on-chain!`,
            });
          }

          console.log(
            `[solana] withdrawal complete for user ${req.user.id}: ` +
            `$${result.usdSent} → ${toAddress.slice(0, 8)}… (${result.signature})`
          );
        })
        .catch(async (err) => {
          console.error("[solana] withdrawal send error:", err);

          // Refund balance if send failed
          try {
            const refunded = await addCreditsTx(
              req.user.id,
              usdAmount,
              "sol_withdraw_refund",
              `Withdrawal refund (send failed): ${err.message}`
            );

            await pool.query(
              `UPDATE sol_withdrawals
               SET status = 'failed', error_msg = $1
               WHERE id = $2`,
              [err.message, withdrawalId]
            );

            if (helpers.notifyUser) {
              helpers.notifyUser(req.user.id, "withdrawalFailed", {
                withdrawalId,
                wallet:  refunded,
                message: "Withdrawal failed — your balance has been refunded.",
              });
            }
          } catch (refundErr) {
            console.error("[solana] CRITICAL: refund failed after failed withdrawal:", refundErr);
          }
        });
    } catch (err) {
      console.error("[solana] withdraw error:", err);
      res.status(500).json({ error: "Failed to process withdrawal." });
    }
  });

  // ── GET /api/solana/withdraw/history ──────────────────────────────────────
  app.get("/api/solana/withdraw/history", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, to_address, requested_usd, net_usd, sol_sent,
                tx_signature, status, created_at, completed_at
         FROM sol_withdrawals
         WHERE user_id = $1
         ORDER BY id DESC
         LIMIT 20`,
        [req.user.id]
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to load withdrawal history." });
    }
  });

  // ── GET /api/solana/deposit/history ───────────────────────────────────────
  app.get("/api/solana/deposit/history", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, expected_usd, credited_usd, tx_signature, status, created_at
         FROM sol_deposits
         WHERE user_id = $1
         ORDER BY id DESC
         LIMIT 20`,
        [req.user.id]
      );
      res.json({ ok: true, items: rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to load deposit history." });
    }
  });

  // ── GET /api/admin/hot-wallet (protect this in production!) ───────────────
  app.get("/api/admin/hot-wallet", requireAuth, async (req, res) => {
    try {
      const balance = await getHotWalletBalance();
      res.json({ ok: true, ...balance });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch hot wallet balance." });
    }
  });
}

// ─── RAW BODY MIDDLEWARE ──────────────────────────────────────────────────────
// Needed so we can verify Helius HMAC signatures on the raw bytes.
// Mount this only on the webhook route, not globally.

function express_rawBody(req, res, next) {
  let data = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => {
    req.rawBody = data;
    try {
      req.body = JSON.parse(data);
    } catch {
      req.body = {};
    }
    next();
  });
}

module.exports = { mountSolanaRoutes, initSolanaDb };
