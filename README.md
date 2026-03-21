# Liquid Protocol — Boutique RWA Secondary Market & Liquidity Protocol

> **Hedera Hello Future Apex Hackathon 2026**
> **Track:** DeFi & Tokenization | **Bounty:** AWS (Secure Key Management)
> **Team:** IdeaTeam

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-00C9A7?style=for-the-badge)](https://liquid-hedera-rwa-secondary-market.vercel.app/)
[![Demo Video](https://img.shields.io/badge/Demo%20Video-YouTube-red?style=for-the-badge)](https://youtu.be/VbBAlbYbEpE)
[![Hedera Testnet](https://img.shields.io/badge/Network-Hedera%20Testnet-6C47FF?style=for-the-badge)](https://hashscan.io/testnet)

---
## Links

- **Live Demo:** https://liquid-hedera-rwa-secondary-market.vercel.app/
- **Demo Video:** https://youtu.be/VbBAlbYbEpE
- **GitHub:** https://github.com/Im-in123/Liquid-Hedera-RWA-Secondary-Market-Liquidity-Protocol
- **AWS KMS Operator Account:** `0.0.8290378`
- **HCS Audit Topic:** `0.0.8305515`
## The Problem

Boutique firms can now tokenize real-world assets using Hedera's Asset Tokenization Studio. But **tokenization solved ownership — not liquidity.**

Once a boutique issuer mints a $2M property token or a private equity fund token, investors who want to exit have no market to sell into. New buyers have no pool to buy from. There's no AMM, no price discovery, no liquidity. The token is valuable in theory and illiquid in practice.

| Platform | Serves |
|---|---|
| Swarm | Liquid traditional assets (Apple, Tesla) |
| StegX / Zoniqx | Institutional real estate ($100M+ deals) |
| **Boutique firms ($500K–$5M)** | **ZERO secondary market solutions** |

> Research shows **$25B+ in tokenized RWAs have negligible secondary-market depth**, with most tokens exhibiting long holding periods and no meaningful price discovery outside issuer-controlled redemption windows.

---

## The Solution

**Liquid** is the missing liquidity layer for small-cap tokenized assets on Hedera.

### Core Features

1. **Dual-Mode Liquidity, Staking & Earn**
   - **Provide Liquidity:** Add USDC + RWA token pairs → earn 0.3% trading fees + LP tokens
   - **RWA Staking:** Stake RWA tokens directly → earn USDC yield (simulating real asset income)
   - **LP Mining:** Stake LP tokens → earn bonus RWA token rewards
   - Two-step flow: add liquidity → receive LP tokens → stake LP tokens for compounded yield

2. **Appraisal-Anchored Adaptive Automated MArket Maker(AMM)**
   - Solves the cold-start problem for assets with zero trading history
   - Uses Curve Finance's stableswap invariant adapted for RWA tokens
   - Price is anchored to a real-world NAV via a `pegPrice` parameter — both reserves are scaled to USDC units so the curve treats them as near-peg assets
   - Amplification factor (A) controls how tightly price tracks NAV — not pure supply/demand

3. **RWA Marketplace**
   - Browse all live RWA pools and execute compliant buy/sell swaps against USDC

4. **Compliance-Aware Trading (ERC-3643 / T-REX)**
   - RWA tokens implement the full ERC-3643 standard — compliance enforced at the token level
   - Every transfer checks identity (ATSIdentityRegistry) and compliance (ComplianceRegistry)
   - KYC managed server-side via `/api/whitelist` — operator key never touches the browser

5. **AWS KMS Secure Key Management**
   - All compliance operator signing — both EVM transactions and native Hedera HCS messages — is performed exclusively by AWS KMS
   - No private key exists anywhere in the codebase or environment
   - Every signing operation is recorded in AWS CloudTrail

6. **Live HCS Audit Trail**
   - Every protocol action (swap, stake, unstake, liquidity add/remove, KYC request/approval) is published to an HCS topic
   - Streams events live from the Mirror Node with colour-coded event types, timestamps, and transaction links
   - All HCS messages are KMS-signed — immutable, CloudTrail-backed audit trail of all operator actions

---


### Deployed Contract Addresses (Hedera Testnet)

| Contract | Address |
|---|---|
| AdaptiveAMM | `0xe8424D5F825C09f06063a1d089788726e5Fb01B5` |
| LiquidityVault | `0x7F68E4B9f0B0196777659a4804289904e2699765` |
| ComplianceRegistry | `0x627bEe1347c8C4A57813EE8517c3043E2c2674B6` |
| TreasuryManager | `0x70417984c62d17Cd9fe1Ac58152a903d6bf5631C` |
| ATSIdentityRegistry | `0xD13e101fAF4ae4569Eb7C08b390BD3198a0185ad` |
| USDC (Mock) | `0x373785c571025d0Bb407e77073490FE7b325eB44` |
| KMS Operator | `0.0.8290378` → `0x764df5f8022c2e1d23f2422b2b8f24bcccc02865` |

### Deployed RWA Tokens & Pools

| Token | Address | Initial Price | Pool ID |
|---|---|---|---|
| RWAPROP (Commercial Property, Austin TX) | `0x37b2d3230707FD12c133af35132EA89A0e32ebF5` | $200 | `0xfd2dea48...` |
| RWAEQUITY (Private Equity Fund) | `0x47046D3b278CCb57B035f0fA50d03A063B2bFb1b` | $50 | `0xde2ede45...` |
| RWABOND (Corporate Bond) | `0x60a4F6C5891e02B19d28db11141b76386eadC0AD` | $100 | `0xe28669389...` |

**HCS Audit Topic:** `0.0.8305515`

---

### Frontend (Vite + React 19)

| Route | Page | Description |
|---|---|---|
| `/` | Home | Landing page |
| `/marketplace` | Marketplace | Browse all tokenized RWA assets and pool stats |
| `/trade/:poolId` | Trade | Swap RWA tokens against USDC |
| `/pools` | Liquidity | Add/remove liquidity, view LP positions |
| `/stake` | Stake & Earn | Stake RWA tokens or LP tokens, claim rewards |
| `/dashboard` | Portfolio | Holdings, positions, staking, on-chain activity |
| `/faucet` | Faucet | Mint testnet RWAPROP, RWAEQUITY, RWABOND, USDC |
| `/compliance` | KYC | Submit KYC/AML verification to unlock trading |
| `/audit` | Audit Log | Live HCS event stream — all KMS-signed protocol events |

---

### AWS KMS Architecture (`/api/whitelist.js`)

The Vercel serverless function is the sole compliance operator. It never holds a private key:

1. On KYC request, `KmsEthersSigner` fetches the secp256k1 public key from KMS via `GetPublicKeyCommand`
2. The EVM address is derived on the fly from the KMS public key (`keccak256(pubkey[1:])[12:]`)
3. All EVM transactions are signed via `SignCommand` with `ECDSA_SHA_256` — the DER-encoded signature is parsed, low-s is enforced (EIP-2), and the correct `v` is selected by calling `ethers.recoverAddress()` against the known KMS address
4. HCS messages are signed via `frozenTx.signWith(hederaPubKey, kmsCallback)` — same KMS key, raw secp256k1 `r || s` format for the Hedera SDK
5. Every operation is automatically logged to AWS CloudTrail
6. `TreasuryManager` records the KMS signature hash on-chain on every withdrawal, creating a verifiable on-chain link to CloudTrail

```
KYC Request → Vercel /api/whitelist → AWS KMS SignCommand → Hedera EVM + HCS → CloudTrail
```

### Wallet & Transaction Architecture

Liquid uses **Hedera WalletConnect** with **HashPack** for all on-chain interactions:

1. Contract calls are built as native Hedera `ContractExecuteTransaction` using `@hashgraph/sdk`
2. ABI-encoded via `ethers.Interface.encodeFunctionData`
3. Transaction is frozen, serialized to base64 via `transactionToBase64String`
4. Sent to HashPack via `dAppConnector.signAndExecuteTransaction` — user signs in their wallet
5. Read operations use `ethers.Contract` directly against Hashio JSON-RPC relay

**No private keys in the frontend** — all user signing happens in HashPack.

---

## Tech Stack

### Smart Contracts
- Solidity 0.8.28
- Hardhat 2.x (compilation, testing, deployment)
- OpenZeppelin Contracts 5.x (ERC-20, AccessControl, ReentrancyGuard, Ownable)
- TypeChain (type-safe contract bindings)
- ethers.js v6

### Frontend
- Vite + React 19
- React Router v6
- TailwindCSS 4
- ethers.js v6
- `@hashgraph/sdk` v2.80 (transaction building)
- `@hashgraph/hedera-wallet-connect` v2 (HashPack integration)
- Recharts (price/pool charts)

### Backend / Infrastructure
- Vercel (frontend hosting + serverless functions)
- `/api/whitelist.js` — AWS KMS-backed compliance operator
- `@aws-sdk/client-kms` — AWS KMS signing
- Hedera Mirror Node API (live on-chain data)
- HCS topic `0.0.8305515` (immutable KMS-signed audit trail)
- Hedera Testnet, Chain ID 296, RPC: `https://testnet.hashio.io/api`

---
 

### Smart Contracts (Hedera EVM — Solidity 0.8.28)

All contracts are deployed and live on **Hedera Testnet**.

#### `AdaptiveAMM.sol`
Core AMM using the Curve stableswap invariant adapted for RWA price anchoring.

| Function | Description |
|---|---|
| `createPool(assetToken, quoteToken, appraisalValue, amplification)` | Deploy a new pool with a dedicated LP token |
| `addLiquidity(poolId, assetAmount, quoteAmount)` | Add liquidity, receive LP tokens |
| `removeLiquidity(poolId, lpAmount)` | Burn LP tokens, receive underlying tokens |
| `swap(poolId, tokenIn, amountIn, minAmountOut)` | Execute a compliant trade |
| `getCurrentPrice(poolId)` | Get current market price in USDC |
| `updateAppraisal(poolId, newAppraisal)` | Update NAV anchor (e.g. annual revaluation) |
| `updateAmplification(poolId, newA)` | Adjust price stability parameter |

#### `LiquidityVault.sol`
Dual-mode staking vault — RWA staking (earn USDC) and LP mining (earn RWA tokens).

| Function | Description |
|---|---|
| `initializePool(poolId, stakedToken, rewardToken, rewardRate)` | Create a staking pool |
| `stake(poolId, amount)` | Stake tokens |
| `unstake(poolId, amount)` | Unstake tokens |
| `claimRewards(poolId)` | Claim pending rewards |
| `pendingRewards(poolId, user)` | View unclaimed rewards |

#### `RWAToken.sol`
ERC-3643 (T-REX) compliant security token representing a tokenized real-world asset. Every `_update()` call enforces identity and compliance checks before executing. Cannot be transferred to any address not verified in `ATSIdentityRegistry`. Fully ERC-20 compatible.

#### `ComplianceRegistry.sol`
Platform-level compliance — KYC/AML whitelist and transfer rule enforcement.

| Function | Description |
|---|---|
| `whitelistInvestor(address, kycHash, jurisdiction, isAccredited, validityPeriod)` | Approve investor |
| `canTransfer(from, to, asset, amount)` | Gate check for all AMM and vault operations |
| `bindToken(token)` / `unbindToken(token)` | Register RWA tokens under compliance |

#### `ATSIdentityRegistry.sol`
ERC-3643 identity registry simulating Hedera's Asset Tokenization Studio (ATS).

| Function | Description |
|---|---|
| `selfRegister()` | Demo mode: users can self-register on testnet |
| `verifyInvestor(address, country, tier)` | Operator verifies an investor (called by `/api/whitelist` via KMS signer) |
| `registerContract(address)` | Whitelist smart contracts (AMM, Vault) so they can hold/transfer RWA tokens |
| `blockCountry(uint16)` / `unblockCountry(uint16)` | Block or restore entire jurisdictions |

#### `TreasuryManager.sol` *(AWS Bounty)*
Secure protocol treasury with multi-sig approvals, timelocks, and on-chain KMS signature recording.

| Function | Description |
|---|---|
| `deposit(token, amount)` | Deposit HBAR or ERC-20 into treasury |
| `requestWithdrawal(token, recipient, amount, reason)` | Initiate a withdrawal (TREASURER_ROLE) |
| `approveWithdrawal(requestId)` | Approve a pending withdrawal (APPROVER_ROLE) |
| `executeWithdrawal(requestId, kmsSignature)` | Execute after timelock + approvals; records KMS signature hash on-chain |

#### `LPToken.sol`
ERC-20 LP receipt token — one deployed per AMM pool by `AdaptiveAMM`. Only the AMM can mint/burn.

---

## Local Development

### Prerequisites
```bash
node >= 18.x
npm >= 9.x
```

### Installation
```bash
git clone https://github.com/Im-in123/Liquid-Hedera-RWA-Secondary-Market-Liquidity-Protocol
cd Liquid-Hedera-RWA-Secondary-Market-Liquidity-Protocol
npm install
cp .env.example .env
```

### Environment Variables
```env
# Hedera
DEPLOYER_ACCOUNT_ID=0.0.xxxxx
DEPLOYER_PRIVATE_KEY=0x302...

# AWS KMS (compliance operator)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxx
KMS_KEY_ID=your-kms-key-id

# Frontend
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

### Run
```bash
npm run compile       # compile contracts
npm run deploy:testnet  # deploy to Hedera testnet
npm start           # start vercel frontend and vercel api for whitelisting. frontend at http://localhost:5173
```

### Testing
```bash
npm run test          # 69 tests, all passing
```

 
 
---

## Post-Hackathon Roadmap

### Phase 1: Launch (Months 1–3)
- Mainnet deployment
- Partner with 10 boutique RWA issuers

### Phase 2: Scale (Months 4–6)
- Cross-asset collateral system (use Property A as collateral to buy Property B)
- Institutional LP onboarding
- Governance token launch
- Mobile app

### Phase 3: Ecosystem (Months 7–12)
- Integrate with all Hedera RWA platforms
- Secondary market API for issuers
- DAO governance
- Multi-chain expansion

---



---

## Team

**IdeaTeam** — Hedera Hello Future Apex Hackathon 2026

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

---

 