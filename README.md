# PIPO.IO

Multiplayer skill-based betting game with real Solana deposits and withdrawals.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables
Copy `.env.example` to `.env` and fill in the values:
```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Any long random string |
| `MASTER_WALLET_PRIVATE_KEY` | Base58 private key of your Solana hot wallet |
| `SOLANA_RPC_URL` | Helius RPC URL (free at helius.dev) |
| `HELIUS_WEBHOOK_SECRET` | Random string — paste same value in Helius dashboard |

### 3. Generate your master wallet (one time only)
```bash
node -e "
  const { Keypair } = require('@solana/web3.js');
  const bs58 = require('bs58');
  const kp = Keypair.generate();
  console.log('Public key:', kp.publicKey.toString());
  console.log('Private key (base58):', bs58.encode(kp.secretKey));
"
```
Save the private key in your `.env` as `MASTER_WALLET_PRIVATE_KEY`.  
**Never share or commit it.**

### 4. Set up Helius webhook
1. Sign up at https://helius.dev (free tier is fine)
2. Create a new **Enhanced Transactions** webhook
3. Webhook URL: `https://yourdomain.com/api/solana/deposit-webhook`
4. Transaction type: `TRANSFER`
5. Account address: your master wallet **public** key
6. Auth secret: your `HELIUS_WEBHOOK_SECRET` value

### 5. Fund your hot wallet
Send some SOL to your master wallet public key.  
Keep enough to cover pending withdrawals (check `/api/admin/hot-wallet`).

### 6. Start the server
```bash
npm start
```

---

## How the money works

```
User clicks Add Funds ($20)
  → Server creates a unique deposit address per user (HD derived from master key)
  → Shows QR code + exact SOL amount to send
  → User sends SOL from their wallet
  → Helius webhook fires → server verifies on-chain → credits $20 to account
  → Socket pushes balance update instantly

In-game wins/losses
  → Pure database arithmetic — blockchain never touched mid-match

User clicks Cash Out ($15)
  → Server deducts $15 from DB immediately
  → Sends SOL from master wallet to user's address async
  → Socket fires "withdrawalComplete" with txid when sent
  → 3% house fee applied (configurable in solana-wallet.js)
```

---

## Project structure

```
pipo-io/
├── server.js          Main Express + Socket.io server
├── solana-wallet.js   Solana HD derivation, pricing, send/receive logic
├── solana-routes.js   Express routes for deposit/withdraw endpoints
├── package.json
├── .env.example
└── public/
    ├── index.html
    ├── game.js        Client — all game + UI logic
    ├── style.css      Dark green theme
    └── audio/         MP3 files for in-menu music
```

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/solana/price` | No | Current SOL/USD price |
| POST | `/api/solana/deposit/create` | Yes | Create deposit (returns address + SOL amount) |
| GET | `/api/solana/deposit/status/:id` | Yes | Poll deposit status |
| POST | `/api/solana/deposit-webhook` | Helius | Called by Helius when SOL arrives |
| POST | `/api/solana/withdraw` | Yes | Cash out USD to SOL address |
| GET | `/api/solana/withdraw/history` | Yes | Withdrawal history |
| GET | `/api/solana/deposit/history` | Yes | Deposit history |
| GET | `/api/admin/hot-wallet` | Yes | Hot wallet SOL balance |
