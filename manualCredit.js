/**
 * scripts/manualCredit.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME USE: Manually credits a user's balance for an out-of-band SOL
 * deposit (i.e. SOL arrived on-chain but no pending deposit record existed).
 *
 * Usage:
 *   node scripts/manualCredit.js
 *
 * Delete or archive this file after running it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

require("dotenv").config(); // loads DATABASE_URL etc. from your .env

const { Pool } = require("pg");

// ─── FILL THESE IN ────────────────────────────────────────────────────────────

const USERNAME        = "jbessa";
const CREDIT_USD      = 1.74;
const TX_SIGNATURE    = "2EBtq4ukKFPcqr58MhrjYX9GPkXP2zwTYLWdbV3SpL8hkPfsEHqxbfkZr4m4bwxj6SLLZVNz6Xi7Av2Q5CMxLhH";   // ← still need this
const RECEIVED_LAM    = 13000000;               // 0.013 SOL in lamports
const SOL_PRICE_USD   = 134;                    // 0.013 SOL ≈ $1.74 → ~$134/SOL at time of tx

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Look up the user
    const { rows: userRows } = await client.query(
      `SELECT id, username, wallet FROM users WHERE username = $1`,
      [USERNAME]
    );

    if (!userRows.length) {
      throw new Error(`User "${USERNAME}" not found.`);
    }

    const user = userRows[0];
    console.log(`Found user: id=${user.id}, username=${user.username}, current wallet=$${user.wallet}`);

    // 2. Guard: make sure we haven't already credited this tx
    const { rows: dupRows } = await client.query(
      `SELECT id FROM sol_deposits WHERE tx_signature = $1`,
      [TX_SIGNATURE]
    );

    if (dupRows.length) {
      throw new Error(`TX ${TX_SIGNATURE} has already been credited (sol_deposits id=${dupRows[0].id}). Aborting.`);
    }

    // 3. Credit the user's balance
    const { rows: balRows } = await client.query(
      `UPDATE users
       SET wallet = wallet + $1
       WHERE id = $2
       RETURNING wallet`,
      [CREDIT_USD, user.id]
    );

    const newBalance = balRows[0].wallet;
    console.log(`Balance updated: $${user.wallet} → $${newBalance}`);

    // 4. Insert a completed deposit record for the audit trail
    await client.query(
      `INSERT INTO sol_deposits
         (user_id, address, expected_usd, expected_lam, sol_price_usd,
          status, tx_signature, received_lam, credited_usd,
          expires_at, completed_at)
       VALUES
         ($1,
          (SELECT sol_address FROM users WHERE id = $1),
          $2, $3, $4,
          'completed', $5, $6, $7,
          NOW(), NOW())`,
      [
        user.id,
        CREDIT_USD,
        RECEIVED_LAM,
        SOL_PRICE_USD,
        TX_SIGNATURE,
        RECEIVED_LAM,
        CREDIT_USD,
      ]
    );

    console.log(`Deposit record inserted for tx ${TX_SIGNATURE}`);

    await client.query("COMMIT");
    console.log("✅ Done. Manual credit applied successfully.");
    console.log(`   User: ${USERNAME} | Credited: $${CREDIT_USD} | New balance: $${newBalance}`);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error — transaction rolled back:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
