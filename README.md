# Liquid Protocol- Boutique RWA Secondary Market And Liquidity Protocol

> **Hedera Hello Future Apex Hackathon 2026**  
> **Track:** DeFi & Tokenization  
> **Bounty:** AWS (Secure Key Management)  
> **Team:** IdeaTeam

---

## 🎯 Problem Statement

Boutique firms can now tokenize real-world assets using Hedera's Asset Tokenization Studio. But tokenization solved ownership — not liquidity.

**RWA tokens exist on-chain, but there is nowhere to trade them with any depth.**

Once a boutique issuer mints a $2M property token or a private equity fund token, investors who want to exit have no market to sell into. New buyers have no pool to buy from. There's no AMM, no price discovery, no liquidity. The token is valuable in theory and illiquid in practice.

- **Swarm** provides liquidity for liquid traditional assets (Apple stock, Tesla)
- **StegX/Zoniqx** serves institutional real estate ($100M+ deals)
- **Boutique firms** tokenizing $500K-$5M assets have ZERO secondary market solutions

Research shows **$25B+ in tokenized RWAs have negligible secondary-market depth**, with most tokens exhibiting low transfer activity, long holding periods, and no meaningful price discovery outside issuer-controlled redemption windows.

---

## 💡 Solution

**Liquid** is the missing liquidity layer for small-cap tokenized assets on Hedera.

### Core Features



1. **Dual-Mode Liquidity & Staking System**
   - Liquidity Pools add USDC + RWA token pairs to earn 0.3% trading fees and receive LP tokens
   - **RWA Staking:** Stake RWA tokens directly → earn USDC yield (simulating real asset income)
   - **LP Mining:** Stake LP tokens → earn bonus RWA token rewards
   - Two-step flow: add liquidity → receive LP tokens → stake LP tokens for compounded yield

2. **Appraisal-Anchored Adaptive AMM**
   - Uses Curve Finance's stableswap invariant adapted for RWA tokens
   - Price is anchored to a real-world NAV (appraisal value) via a `pegPrice` parameter — both reserves are scaled to USDC units so the curve treats them as near-peg assets
   - Amplification factor (A) controls how tightly price tracks NAV — not pure supply/demand
   - Works for assets with ZERO trading history — price discovery starts from fundamentals
   
3. **Compliance-Aware Trading (ERC-3643 / T-REX)**
   - RWA tokens implement the full ERC-3643 standard — compliance is enforced at the token level
   - Every transfer checks identity (ATSIdentityRegistry) and compliance (ComplianceRegistry)
   - Whitelist/KYC managed server-side via `/api/whitelist` — deployer key never touches the browser
   - Jurisdiction-aware: 13 supported regions including US, EU, SG, AE, GH, NG, ZA

4. **AWS KMS Secure Key Management (AWS Bounty)**
   - All compliance operator signing — both EVM transactions and native Hedera HCS messages — is performed exclusively by AWS KMS. No private key exists anywhere in the codebase or environment
   - Custom `KmsEthersSigner` extends `ethers.AbstractSigner`, fetches the secp256k1 public key from KMS, parses DER-encoded signatures, enforces EIP-2 low-s, and determines the correct recovery bit (`v`) via `ethers.recoverAddress()` against the KMS-derived EVM address
   - HCS messages are signed via `frozenTx.signWith(hederaPubKey, kmsSignCallback)` — the KMS key signs the transaction digest directly
   - Every signing operation is recorded in AWS CloudTrail
   - `TreasuryManager.sol` requires a `kmsSignature` parameter on `executeWithdrawal`, stores the KMS signature hash on-chain, and emits a `KMSSignatureRecorded` event — full on-chain audit trail of treasury actions
   - Every KYC approval and audit log event published to HCS includes `signedWithKMS: true` and `kmsKeyId` in the message payload

5. **Live HCS Audit Trail**
   - Every protocol action (swap, stake, unstake, liquidity add/remove, KYC request, KYC approval) is published to HCS topic `0.0.8305515`
   - The `/audit` page streams these events live from the Mirror Node with colour-coded event types, timestamps, and transaction links
   - All HCS messages are KMS-signed, giving an immutable, CloudTrail-backed audit trail of all operator actions

---

## 🏗️ Technical Architecture

### Smart Contracts (Hedera EVM — Solidity 0.8.28)

All contracts are deployed and live on **Hedera Testnet**.

#### 1. `AdaptiveAMM.sol`
- **Purpose:** Core AMM using the Curve stableswap invariant adapted for RWA price anchoring
- **Key Functions:**
  - `createPool(assetToken, quoteToken, appraisalValue, amplification)` — Deploy a new pool with a dedicated LP token
  - `addLiquidity(poolId, assetAmount, quoteAmount)` — Add liquidity, receive LP tokens
  - `removeLiquidity(poolId, lpAmount)` — Burn LP tokens, receive underlying tokens
  - `swap(poolId, tokenIn, amountIn, minAmountOut)` — Execute a trade
  - `getCurrentPrice(poolId)` — Get current market price in USDC
  - `updateAppraisal(poolId, newAppraisal)` — Update NAV anchor (e.g. annual revaluation)
  - `updateAmplification(poolId, newA)` — Adjust price stability parameter

#### 2. `LiquidityVault.sol`
- **Purpose:** Dual-mode staking vault — RWA staking (earn USDC) and LP mining (earn RWA tokens)
- **Key Functions:**
  - `initializePool(poolId, stakedToken, rewardToken, rewardRate)` — Create a staking pool
  - `stake(poolId, amount)` — Stake tokens into a pool
  - `unstake(poolId, amount)` — Unstake tokens back to wallet
  - `claimRewards(poolId)` — Claim pending rewards
  - `pendingRewards(poolId, user)` — View unclaimed rewards
  - `getStakeInfo(poolId, user)` — Returns `{amount, rewardDebt, lastStakeTime, pendingRewardsAmount}`

#### 3. `RWAToken.sol`
- **Purpose:** ERC-3643 (T-REX) compliant security token representing a tokenized real-world asset
- **Key Behaviour:**
  - Every `_update()` (called by `transfer` and `transferFrom`) enforces identity and compliance checks before executing
  - Cannot be transferred to any address not verified in `ATSIdentityRegistry`
  - Implements `forcedTransfer` and `recoveryAddress` per T-REX spec
  - Fully ERC-20 compatible — works with any DeFi protocol without modification

#### 4. `LPToken.sol`
- **Purpose:** ERC-20 LP receipt token, one deployed per AMM pool by `AdaptiveAMM`
- Only the AMM contract can mint/burn LP tokens

#### 5. `ComplianceRegistry.sol`
- **Purpose:** Platform-level compliance — KYC/AML whitelist and transfer rule enforcement
- **Key Functions:**
  - `whitelistInvestor(address, kycHash, jurisdiction, isAccredited, validityPeriod)` — Approve investor
  - `canTransfer(from, to, asset, amount)` — Gate check for all AMM and vault operations
  - `isInvestorCompliant(address)` — Check investor status
  - `bindToken(token)` / `unbindToken(token)` — Register RWA tokens under compliance

#### 6. `ATSIdentityRegistry.sol`
- **Purpose:** ERC-3643 identity registry simulating Hedera's Asset Tokenization Studio (ATS)
- **Key Functions:**
  - `selfRegister()` — Demo mode: users can self-register for testnet
  - `verifyInvestor(address, country, tier)` — Operator verifies an investor (called by `/api/whitelist` via KMS signer)
  - `registerContract(address)` — Whitelist smart contracts (AMM, Vault) so they can hold and transfer RWA tokens
  - `isVerified(address)` — Token-level identity check called on every RWA transfer
  - `blockCountry(uint16)` / `unblockCountry(uint16)` — Block or restore entire jurisdictions

#### 7. `TreasuryManager.sol` *(AWS Bounty Integration)*
- **Purpose:** Secure protocol treasury with multi-sig approvals, timelocks, and AWS KMS signature recording
- **Supported assets:** Native HBAR (`address(0)`) and any ERC-20 token
- **Key Functions:**
  - `deposit(token, amount)` — Deposit HBAR or ERC-20 into treasury
  - `requestWithdrawal(token, recipient, amount, reason)` — Initiate a withdrawal (requires TREASURER_ROLE)
  - `approveWithdrawal(requestId)` — Approve a pending withdrawal (requires APPROVER_ROLE)
  - `executeWithdrawal(requestId, kmsSignature)` — Execute after timelock + sufficient approvals; stores KMS signature hash on-chain and emits `KMSSignatureRecorded`
  - `getTreasuryBalance(token)` — View current treasury balance

### Deployed Contract Addresses (Hedera Testnet)

| Contract | Address |
|---|---|
| AdaptiveAMM | `0xe8424D5F825C09f06063a1d089788726e5Fb01B5` |
| LiquidityVault | `0x7F68E4B9f0B0196777659a4804289904e2699765` |
| ComplianceRegistry | `0x627bEe1347c8C4A57813EE8517c3043E2c2674B6` |
| TreasuryManager | `0x70417984c62d17Cd9fe1Ac58152a903d6bf5631C` |
| ATSIdentityRegistry | `0xD13e101fAF4ae4569Eb7C08b390BD3198a0185ad` |
| USDC (Mock) | `0x373785c571025d0Bb407e77073490FE7b325eB44` |
| KMS Operator Account | `0.0.8290378` (`0x764df5f8022c2e1d23f2422b2b8f24bcccc02865`) |

### Deployed RWA Tokens & Pools

| Token | Address | Initial Price | AMM Pool ID | LP Token |
|---|---|---|---|---|
| RWAPROP (Commercial Property, Austin TX) | `0x37b2d3230707FD12c133af35132EA89A0e32ebF5` | $200 | `0xfd2dea48...` | `0x6093b5a7...` |
| RWAEQUITY (Private Equity Fund) | `0x47046D3b278CCb57B035f0fA50d03A063B2bFb1b` | $50 | `0xde2ede45...` | `0xDc141925...` |
| RWABOND (Corporate Bond) | `0x60a4F6C5891e02B19d28db11141b76386eadC0AD` | $100 | `0xe28669389...` | `0xd03BdCb3...` |

**HCS Audit Topic:** `0.0.8305515`

---

### Frontend (Vite + React 19)

#### Pages & Routes
| Route | Page | Description |
|---|---|---|
| `/` | Home | Landing page |
| `/marketplace` | Marketplace | Browse all tokenized RWA assets and pool stats |
| `/trade/:poolId` | Trade | Swap RWA tokens against USDC |
| `/pools` | Liquidity | Add/remove liquidity, view LP positions |
| `/stake` | Stake & Earn | Stake RWA tokens or LP tokens, claim rewards |
| `/dashboard` | Portfolio | Full portfolio view — holdings, positions, staking, on-chain activity |
| `/faucet` | Faucet | Mint testnet RWAPROP, RWAEQUITY, RWABOND, USDC (1000 each) |
| `/compliance` | KYC | Submit KYC/AML verification to unlock trading |
| `/audit` | Audit Log | Live HCS event stream — all swaps, stakes, KYC events, liquidity changes, KMS-signed |

#### Key Components
- `NotificationContext` — Real-time notification system polling on-chain state every 30s; surfaces rewards ready, idle LP tokens, missing liquidity positions, low liquidity warnings
- `WalletContext` — Hedera WalletConnect + HashPack integration; builds native `ContractExecuteTransaction` via Hedera SDK, serializes to base64, sends to HashPack for signing
- `NotificationBanner` — In-page contextual banners shown on every page, filtered by relevance
- `KYCBanner` — Compliance gate shown to unverified users
- `Toast` — Transaction feedback system
- `useMirrorNode` — Live on-chain data from Hedera Mirror Node REST API (not from backend)
- `useHCS` — Reads protocol events from HCS topic for the Audit Log page

### Wallet & Transaction Architecture

Liquid uses **Hedera WalletConnect** with **HashPack** for all on-chain interactions:

1. Contract calls are built as native Hedera `ContractExecuteTransaction` using `@hashgraph/sdk`
2. ABI-encoded via `ethers.Interface.encodeFunctionData`
3. Transaction is frozen, serialized to base64 via `transactionToBase64String`
4. Sent to HashPack via `dAppConnector.signAndExecuteTransaction` — user signs in their wallet
5. Read operations use `ethers.Contract` directly against Hashio JSON-RPC relay

This means **no private keys in the frontend** — all signing happens in the user's wallet.

### AWS KMS Architecture (`/api/whitelist.js`)

The Vercel serverless function is the sole compliance operator. It never holds a private key:

1. On KYC request, `KmsEthersSigner` fetches the secp256k1 public key from KMS via `GetPublicKeyCommand`
2. The EVM address is derived on the fly from the KMS public key (`keccak256(pubkey[1:])[12:]`)
3. All EVM transactions are signed by calling `SignCommand` with `ECDSA_SHA_256` — the DER-encoded signature is parsed, low-s is enforced (EIP-2), and the correct `v` value is selected by calling `ethers.recoverAddress()` against the known KMS address
4. HCS messages are signed via `frozenTx.signWith(hederaPubKey, kmsCallback)` — same KMS key, different signing path (raw secp256k1 `r || s` for Hedera SDK)
5. Every operation is logged to AWS CloudTrail automatically

---

## 📦 Tech Stack

### Smart Contracts
- Solidity 0.8.28
- Hardhat 2.x (compilation, testing, deployment)
- OpenZeppelin Contracts 5.x (ERC-20, AccessControl, ReentrancyGuard, Ownable)
- TypeChain (type-safe contract bindings for frontend)
- ethers.js v6

### Frontend
- Vite 4 + React 19
- React Router v6
- TailwindCSS 4
- ethers.js v6
- `@hashgraph/sdk` v2.80 (transaction building)
- `@hashgraph/hedera-wallet-connect` v2 (HashPack integration)
- Recharts (price/pool charts)

### Backend / Infrastructure
- Vercel (frontend hosting + serverless functions)
- `/api/whitelist.js` — Vercel serverless function; AWS KMS-backed compliance operator handling KYC registration and HCS audit logging
- `@aws-sdk/client-kms` — AWS KMS signing for all operator transactions
- Hedera Mirror Node API (live on-chain data)
- HCS topic `0.0.8305515` (immutable KMS-signed audit trail)
- Hedera Testnet, Chain ID 296, RPC: `https://testnet.hashio.io/api`

---

## 🔧 Local Development Setup

### Prerequisites
```bash
node >= 18.x
npm >= 9.x
```

### Installation
```bash
# Clone repo
git clone [repo-url]
cd liquid-hedera

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Add your Hedera testnet credentials
```

### Environment Variables
```
# Hedera
DEPLOYER_ACCOUNT_ID=0.0.xxxxx          # fee-payer account  
DEPLOYER_PRIVATE_KEY=0x302...          # fee-payer ECDSA private key  
 
# AWS KMS (compliance operator)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxx
KMS_KEY_ID=d7f7f847-27ab-467e-abbf-aa6dfba6d621

# Frontend
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

### Run Development Server
```bash
# Compile contracts
npm run compile

# Deploy to testnet
npm run deploy:testnet

# Run frontend
npm run dev

# Open http://localhost:5173
```

### Testing
```bash
# Run contract tests (69 passing)
npm run test
```

---

## 🎯 Judging Criteria Alignment

### Innovation (10%)
✅ First appraisal-anchored stableswap AMM for illiquid RWAs on Hedera  
✅ NAV-pegged price discovery — assets trade near fundamental value, not pure speculation  
✅ Solves verified market gap ($25B+ in illiquid tokenized assets)

### Feasibility (10%)
✅ Built on existing Hedera infrastructure (EVM, HCS, Mirror Node)  
✅ Directly complements Hedera Asset Tokenization Studio  
✅ All contracts deployed and live on Hedera Testnet

### Execution (20%)
✅ Fully working product: trade, add/remove liquidity, stake, claim rewards, KYC, audit log  
✅ Real-time notification system across all pages  
✅ Complete compliance flow: ERC-3643 token-level + platform-level checks  
✅ 7 smart contracts deployed, full frontend with 9 pages

### Integration (15%)
✅ Hedera EVM for all smart contracts  
✅ HCS (Hedera Consensus Service) for immutable KMS-signed protocol audit trail  
✅ Hedera Mirror Node API for live on-chain data  
✅ HashPack + Hedera WalletConnect for native transaction signing  
✅ AWS KMS: all compliance operator signing (EVM + HCS) performed by KMS; no private key in environment; every operation in CloudTrail; `TreasuryManager` records KMS signature hash on-chain

### Success (20%)
✅ Enables boutique firms to access liquid secondary markets  
✅ Every trade, stake, and liquidity event increases Hedera TPS  
✅ Creates new Hedera accounts (LPs, traders, issuers)  
✅ Positions Hedera as the platform for small-cap RWA secondary markets

### Validation (15%)
✅ 3 tokenized RWA assets live on testnet  
✅ Measurable TVL and trading activity  
✅ Full compliance and KYC flow end-to-end

### Pitch (10%)
✅ Clear problem: boutique RWA liquidity gap  
✅ Simple narrative: Hedera has the issuance layer, Liquid adds the trading layer  
✅ David vs Goliath: empowering $500K-$5M issuers to compete with institutional platforms

---

## 🎬 Demo Video Script

**[0:00-0:15] Hook**
> "Boutique firms can tokenize real-world assets on Hedera. But tokenization solved ownership, not liquidity. Once issued, there's no market to trade these tokens against. No pool, no price discovery, no exit for investors."

**[0:15-0:45] Problem**
> "Swarm provides liquidity for Apple stock. StegX serves $100M institutional real estate. But what about a $2M commercial property tokenized by a boutique firm in Austin? ZERO solutions exist."

**[0:45-1:30] Solution Demo**
> "We built Liquid — the secondary market for boutique RWAs on Hedera.
> 
> Here's RWAPROP — a $2M commercial property token. Zero trading history. Our AMM anchors the price to the real-world appraisal value.
> 
> Watch me buy $5,000 worth... [execute trade] ...3-second settlement.
> 
> Here's the liquidity pool. LPs earn 0.3% on every trade.
> 
> Stake your LP tokens for bonus RWAPROP rewards. Or stake RWAPROP directly to earn USDC yield — just like real rental income.
> 
> Full compliance — KYC whitelist, ERC-3643 transfer restrictions on every transaction.
> 
> And here's the Audit Log — every action, KMS-signed, immutably recorded on Hedera Consensus Service."

**[1:30-2:00] Traction**
> "Live on Hedera Testnet:
> - 3 tokenized RWA assets
> - [TVL figure] in liquidity pools
> - [Trade count] trades executed
> - All operator keys managed by AWS KMS — no private key ever in the environment"

**[2:00-2:30] Vision**
> "Hedera has the issuance layer. We built the liquidity layer. Together, boutique firms can finally compete with institutional RWA platforms."

---

## 🏆 Hackathon Submission Checklist

### GitHub Repository
- [x] Public repo with Apache 2.0 license
- [x] Complete README.md
- [x] All smart contract source code (7 contracts)
- [x] Frontend source code (9 pages)
- [x] Deployment scripts
- [ ] Demo video link

### Project Details
- **Track:** DeFi & Tokenization
- **Bounty:** AWS (Secure Key Management)
- **Live Demo:** [Vercel deployment URL]
- **Demo Video:** [YouTube link]

### Tech Stack Summary
- Smart Contracts: Solidity 0.8.28, Hardhat, OpenZeppelin, TypeChain
- Frontend: Vite, React 19, React Router, TailwindCSS, ethers.js v6
- Hedera: EVM smart contracts, HCS audit trail, Mirror Node API, HashPack WalletConnect
- AWS: KMS (secp256k1) for all compliance operator signing — EVM and native Hedera HCS
- Infrastructure: Vercel, Hedera Testnet (Chain ID 296)

---

## 🚀 Post-Hackathon Roadmap

### Phase 1: Launch (Months 1-3)
- Mainnet deployment
- Partner with 10 boutique RWA issuers
- $1M+ TVL target

### Phase 2: Scale (Months 4-6)
- Cross-asset collateral system (use Property A as collateral to buy Property B)
- Institutional LP onboarding
- Governance token launch
- Mobile app

### Phase 3: Ecosystem (Months 7-12)
- Integrate with all Hedera RWA platforms
- Secondary market API for issuers
- DAO governance launch
- Multi-chain expansion

---

## 📞 Contact

- **Team:** IdeaTeam
- **Team Lead:** [Your Name]
- **Email:** [your-email]
- **Twitter:** [@yourhandle]
- **Discord:** [yourhandle]

---

## 📄 License

Apache 2.0 — see LICENSE file for details.

---

## 🙏 Acknowledgments

- Hedera Team for Asset Tokenization Studio and developer tooling
- Curve Finance for the stableswap invariant that inspired the AMM design
- OpenZeppelin for battle-tested contract primitives
- AWS for KMS secp256k1 key management
- Hedera Hello Future Apex Hackathon 2026 organizers

---

**Built with ❤️ on Hedera Hashgraph**