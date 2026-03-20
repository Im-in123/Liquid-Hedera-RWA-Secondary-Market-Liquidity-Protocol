const hre = require("hardhat");
const fs  = require("fs");
const { KMSClient, GetPublicKeyCommand } = require("@aws-sdk/client-kms");
const { ethers } = require("ethers");
 
// Derive EVM address from KMS public key
// KMS returns DER-encoded SPKI — strip 23-byte prefix to get 65-byte uncompressed key
// Then keccak256 the 64-byte portion (without 0x04 prefix), take last 20 bytes
const KMS_SPKI_PREFIX_LEN = 23;

async function deriveKmsEvmAddress() {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) return null;

  try {
    const kms    = new KMSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    const result    = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
    const der       = Buffer.from(result.PublicKey);
    const pubKey    = der.slice(KMS_SPKI_PREFIX_LEN); // 65 bytes: 0x04 || x || y
    const hash      = ethers.keccak256(pubKey.slice(1)); // hash of 64-byte key
    return ethers.getAddress('0x' + hash.slice(-40));
  } catch (err) {
    console.warn("   ⚠️  Could not derive KMS address:", err.message);
    return null;
  }
}

const ASSETS = [
  {
    name: "RWA Property Token",
    symbol: "RWAPROP",
    description: "Commercial Property — Austin TX",
    seedAsset: "1000",
    seedQuote: "200000",
    appraisal: "200000",
    stakeRewardRate: "1000000000000000",
    lpRewardRate:   "100000000000000",
    stakeRewardFund: "31536",
    lpRewardFund:    "3154",
  },
  {
    name: "RWA Equity Token",
    symbol: "RWAEQUITY",
    description: "Private Equity Fund",
    seedAsset: "1000",
    seedQuote: "50000",
    appraisal: "50000",
    stakeRewardRate: "500000000000000",
    lpRewardRate:   "100000000000000",
    stakeRewardFund: "15768",
    lpRewardFund:    "3154",
  },
  {
    name: "RWA Bond Token",
    symbol: "RWABOND",
    description: "Corporate Bond",
    seedAsset: "1000",
    seedQuote: "100000",
    appraisal: "100000",
    stakeRewardRate: "800000000000000",
    lpRewardRate:   "100000000000000",
    stakeRewardFund: "25228",
    lpRewardFund:    "3154",
  },
];

const TRADING_FEE = 30; // 0.3%

/**
 * Retry wrapper for Hedera testnet calls.
 * Testnet JSON-RPC relay (Hashio) can be flaky — timeouts and 503s are common.
 * This retries up to maxAttempts times with exponential backoff before failing.
 */
async function withRetry(fn, label, maxAttempts = 5, baseDelayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.message?.includes('timeout') ||
        err.message?.includes('502') ||
        err.message?.includes('503') ||
        err.message?.includes('504') ||
        err.message?.includes('TIMEOUT');

      if (!isRetryable || attempt === maxAttempts) {
        console.error(`   ❌ ${label} failed after ${attempt} attempt(s):`, err.message);
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1); // exponential backoff
      console.warn(`   ⚠️  ${label} timed out (attempt ${attempt}/${maxAttempts}). Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 DEPLOYING LIQUID PROTOCOL — MULTI-ASSET RWA MARKET");
  console.log("=".repeat(60) + "\n");

  const [deployer] = await hre.ethers.getSigners();

  // Patch HardhatEthersProvider.estimateGas directly — this is the exact method
  // the signer calls before every tx. Hashio's simulation rejects with
  // INSUFFICIENT_TX_FEE when gasPrice is stale/low, so we bypass it entirely.
  hre.ethers.provider.estimateGas = async () => 4_000_000n;

  console.log("📍 Deploying from:", deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(deployer.address)
  ), "HBAR\n");

  // ============ STEP 1: Deploy USDC ============
  console.log("📦 Step 1: Deploying USDC...");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const usdc = await withRetry(() => MockERC20.deploy("USD Coin", "USDC").then(c => c.waitForDeployment().then(() => c)), "Deploy USDC");
  const usdcAddress = await usdc.getAddress();
  console.log("   ✅ USDC:", usdcAddress);

  // ============ STEP 2: Deploy Core Infrastructure ============
  console.log("\n🏗️  Step 2: Deploying core infrastructure...");

  const AdaptiveAMM = await hre.ethers.getContractFactory("AdaptiveAMM");
  const amm = await withRetry(() => AdaptiveAMM.deploy().then(c => c.waitForDeployment().then(() => c)), "Deploy AdaptiveAMM");
  const ammAddress = await amm.getAddress();
  console.log("   ✅ AdaptiveAMM:", ammAddress);

  const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
  const vault = await withRetry(() => LiquidityVault.deploy().then(c => c.waitForDeployment().then(() => c)), "Deploy LiquidityVault");
  const vaultAddress = await vault.getAddress();
  console.log("   ✅ LiquidityVault:", vaultAddress);

  const ComplianceRegistry = await hre.ethers.getContractFactory("ComplianceRegistry");
  const compliance = await withRetry(() => ComplianceRegistry.deploy().then(c => c.waitForDeployment().then(() => c)), "Deploy ComplianceRegistry");
  const complianceAddress = await compliance.getAddress();
  console.log("   ✅ ComplianceRegistry:", complianceAddress);

  const TreasuryManager = await hre.ethers.getContractFactory("TreasuryManager");
  const treasury = await withRetry(() => TreasuryManager.deploy(2, 3600).then(c => c.waitForDeployment().then(() => c)), "Deploy TreasuryManager");
  const treasuryAddress = await treasury.getAddress();
  console.log("   ✅ TreasuryManager:", treasuryAddress);

  // ============ STEP 3: Deploy ATSIdentityRegistry ============
  console.log("\n🔗 Step 3: Deploying ATSIdentityRegistry (Hedera ATS simulation)...");
  const ATSIdentityRegistry = await hre.ethers.getContractFactory("ATSIdentityRegistry");
  const atsRegistry = await withRetry(() => ATSIdentityRegistry.deploy().then(c => c.waitForDeployment().then(() => c)), "Deploy ATSIdentityRegistry");
  const atsRegistryAddress = await atsRegistry.getAddress();
  console.log("   ✅ ATSIdentityRegistry:", atsRegistryAddress);

  // ============ STEP 4: Verify deployer ============
  console.log("\n🛡️  Step 4: Registering deployer in ATS identity registry...");
  await withRetry(() => atsRegistry.verifyInvestor(deployer.address, 840, "accredited"), "Verify deployer in ATS");
  console.log("   ✅ Deployer verified in ATS registry (US, accredited)");

  // Enable demo mode so testnet users can self-register via the faucet
  // This is a testnet-only feature — never enabled in production
  await withRetry(() => atsRegistry.setDemoMode(true), "Enable ATS demo mode");
  console.log("   ✅ ATS demo mode enabled (testnet self-registration active)");

  const deployerKycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(deployer.address + "-kyc-deployer"));
  await withRetry(() => compliance.whitelistInvestor(deployer.address, deployerKycHash, "US", true, 365 * 24 * 3600), "Whitelist deployer");
  console.log("   ✅ Deployer whitelisted in ComplianceRegistry");

  // Authorize AWS KMS operator as compliance operator
  // Derive the KMS operator EVM address dynamically from the KMS public key —
  // no hardcoded addresses, works with any KMS key rotation.
  console.log("\n🔐 Deriving KMS operator address from AWS KMS...");
  const kmsOperatorAddress = await deriveKmsEvmAddress();
  if (kmsOperatorAddress) {
    console.log("   ℹ️  KMS operator EVM address will be authorized after account creation in Step 12");
  } else {
    console.warn("   ⚠️  KMS_KEY_ID not set or unreachable — skipping KMS operator authorization");
  }

  // ============ STEP 5: Deploy ERC-3643 RWA Tokens ============
  console.log("\n📦 Step 5: Deploying ERC-3643 RWA Tokens...");
  const RWAToken = await hre.ethers.getContractFactory("RWAToken");
  const rwaTokens = [];

  for (const asset of ASSETS) {
    const token = await withRetry(() =>
      RWAToken.deploy(
        asset.name, asset.symbol, asset.description,
        hre.ethers.parseEther(asset.appraisal),
        atsRegistryAddress, complianceAddress
      ).then(c => c.waitForDeployment().then(() => c)),
      `Deploy ${asset.symbol}`
    );
    const addr = await token.getAddress();
    rwaTokens.push({ ...asset, token, address: addr });
    console.log(`   ✅ ${asset.symbol} (ERC-3643): ${addr}`);
  }

  // ============ STEP 6: Configure compliance ============
  console.log("\n🛡️  Step 6: Configuring compliance...");

  await withRetry(() => amm.setComplianceRegistry(complianceAddress), "Wire ComplianceRegistry to AMM");
  console.log("   ✅ ComplianceRegistry wired to AdaptiveAMM");

  // Per official T-REX whitepaper: LP/AMM addresses must be registered in identity registry
  await withRetry(() => atsRegistry.registerContract(ammAddress, "amm"), "Register AMM in ATS");
  console.log("   ✅ AdaptiveAMM registered as authorized contract in ATS registry");
  await withRetry(() => atsRegistry.registerContract(vaultAddress, "vault"), "Register Vault in ATS");
  console.log("   ✅ LiquidityVault registered as authorized contract in ATS registry");

  for (const rwa of rwaTokens) {
    await withRetry(() => compliance.setAssetRestrictions(rwa.address, true, true, 0, 0), `Asset restrictions ${rwa.symbol}`);
    console.log(`   ✅ Asset restrictions set for ${rwa.symbol}`);
    await withRetry(() => compliance.setExternalRegistry(rwa.address, atsRegistryAddress), `ATS registry link ${rwa.symbol}`);
    console.log(`   ✅ ATS registry linked for ${rwa.symbol}`);
    await withRetry(() => rwa.token.setDemoMode(true), `Enable demo mode ${rwa.symbol}`);
    console.log(`   ✅ Demo mode enabled for ${rwa.symbol}`);
  }

  console.log("   ℹ️  Deployer can now trade via ATS path OR Liquid whitelist path");

  // ============ STEP 7: Mint USDC and approve ============
  console.log("\n⚙️  Step 7: Minting USDC and setting approvals...");
  await withRetry(() => usdc.mint(deployer.address, hre.ethers.parseEther("500000")), "Mint USDC");
  console.log("   ✅ Minted 500,000 USDC");

  await withRetry(() => usdc.approve(ammAddress, hre.ethers.MaxUint256), "Approve USDC for AMM");
  await withRetry(() => usdc.approve(vaultAddress, hre.ethers.MaxUint256), "Approve USDC for Vault");
  console.log("   ✅ USDC approvals set");

  // ============ STEP 8: Mint RWA tokens ============
  console.log("\n⚙️  Step 8: Minting ERC-3643 RWA tokens to deployer...");
  for (const rwa of rwaTokens) {
    await withRetry(() => rwa.token.mint(deployer.address, hre.ethers.parseEther("110000")), `Mint ${rwa.symbol}`);
    console.log(`   ✅ Minted 110,000 ${rwa.symbol} (identity-verified mint)`);
    await withRetry(() => rwa.token.approve(ammAddress, hre.ethers.MaxUint256), `Approve ${rwa.symbol} for AMM`);
    await withRetry(() => rwa.token.approve(vaultAddress, hre.ethers.MaxUint256), `Approve ${rwa.symbol} for Vault`);
  }
  console.log("   ✅ RWA token approvals set");

  // ============ STEP 9: Create AMM pools ============
  console.log("\n💧 Step 9: Creating AMM pools...");
  const poolResults = [];

  for (const rwa of rwaTokens) {
    console.log(`\n   Creating ${rwa.symbol}/USDC pool...`);
    const tx = await withRetry(() => amm.createPool(
      rwa.address, usdcAddress,
      hre.ethers.parseEther(rwa.seedAsset),
      hre.ethers.parseEther(rwa.seedQuote),
      hre.ethers.parseEther(rwa.appraisal),
      TRADING_FEE
    ), `Create pool ${rwa.symbol}`);
    const receipt = await tx.wait();

    const log = receipt.logs.find(l => {
      try { return amm.interface.parseLog(l).name === "PoolCreated"; }
      catch { return false; }
    });
    const parsed = amm.interface.parseLog(log);
    const poolId = parsed.args.poolId;
    const lpTokenAddress = parsed.args.lpToken;

    console.log(`   ✅ Pool ID:  ${poolId}`);
    console.log(`   ✅ LP Token: ${lpTokenAddress}`);
    poolResults.push({ ...rwa, poolId, lpTokenAddress });
  }

  // ============ STEP 10: Initialize staking pools ============
  console.log("\n🔒 Step 10: Initializing staking pools...");

  for (const pool of poolResults) {
    const stakePoolId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["bytes32", "string"], [pool.poolId, "stake"])
    );
    const lpMiningPoolId = hre.ethers.keccak256(
      hre.ethers.solidityPacked(["bytes32", "string"], [pool.poolId, "lp"])
    );

    await withRetry(() => vault.initializePool(stakePoolId, pool.address, usdcAddress, pool.stakeRewardRate), `Init stake pool ${pool.symbol}`);
    console.log(`   ✅ ${pool.symbol} staking (RWA → USDC): ${stakePoolId}`);

    await withRetry(() => vault.initializePool(lpMiningPoolId, pool.lpTokenAddress, pool.address, pool.lpRewardRate), `Init LP pool ${pool.symbol}`);
    console.log(`   ✅ ${pool.symbol} LP mining (LP → ${pool.symbol}): ${lpMiningPoolId}`);

    pool.stakePoolId = stakePoolId;
    pool.lpMiningPoolId = lpMiningPoolId;
  }

  // ============ STEP 11: Fund reward vaults ============
  console.log("\n💰 Step 11: Funding reward vaults...");

  for (const pool of poolResults) {
    await withRetry(() => vault.depositRewards(pool.stakePoolId, hre.ethers.parseEther(pool.stakeRewardFund)), `Fund stake vault ${pool.symbol}`);
    console.log(`   ✅ ${pool.stakeRewardFund} USDC → ${pool.symbol} staking vault`);

    await withRetry(() => vault.depositRewards(pool.lpMiningPoolId, hre.ethers.parseEther(pool.lpRewardFund)), `Fund LP vault ${pool.symbol}`);
    console.log(`   ✅ ${pool.lpRewardFund} ${pool.symbol} → ${pool.symbol} LP mining vault`);
  }

  // ============ STEP 12: Create Hedera account for KMS operator ============
  console.log("\n🔐 Step 12: Creating Hedera account for KMS operator...");

  const {
    TopicCreateTransaction,
    AccountCreateTransaction,
    Client,
    PrivateKey,
    AccountId,
    PublicKey,
    Hbar,
  } = require("@hashgraph/sdk");

  let kmsOperatorAccountId = null;
  let kmsEvmAddress = kmsOperatorAddress; // fallback to key-derived address
  if (kmsOperatorAddress) {
    try {
      const setupClient = Client.forTestnet();
      setupClient.setOperator(
        AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID),
        PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY.replace("0x", ""))
      );

      // Derive compressed public key from KMS for Hedera account creation
      const { KMSClient: KMS, GetPublicKeyCommand: GetPubKey } = require("@aws-sdk/client-kms");
      const kmsSetup  = new KMS({
        region: process.env.AWS_REGION ?? 'us-east-1',
        credentials: {
          accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
      const pubResult  = await kmsSetup.send(new GetPubKey({ KeyId: process.env.KMS_KEY_ID }));
      const pubRaw     = Buffer.from(pubResult.PublicKey).slice(23);
      const pubHash    = hre.ethers.keccak256(pubRaw.slice(1));
      const kmsKeyDerivedEvmAddress = hre.ethers.getAddress('0x' + pubHash.slice(-40));
      console.log(`   🔑 KMS key-derived EVM address: ${kmsKeyDerivedEvmAddress}`);

      // Auto-create Hedera account by sending HBAR to the key-derived EVM address.
      // This creates an account whose EVM address MATCHES the key-derived address —
      // which means the network can recover the sender correctly from signed transactions.
      // Standard AccountCreateTransaction assigns a different 0x000...accountNum address.
      const { TransferTransaction, Hbar: HbarSDK } = require("@hashgraph/sdk");
      const activateTx = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID), new HbarSDK(-10))
        .addHbarTransfer(kmsKeyDerivedEvmAddress, new HbarSDK(10))
        .execute(setupClient);
      await activateTx.getReceipt(setupClient);
      console.log(`   ✅ Auto-created KMS account via HBAR transfer to EVM alias`);

      // Wait for mirror node to index then fetch the assigned account ID
      await new Promise(r => setTimeout(r, 5000));
      const mirrorRes  = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${kmsKeyDerivedEvmAddress}`);
      const mirrorData = await mirrorRes.json();
      kmsOperatorAccountId = mirrorData.account;
      kmsEvmAddress        = mirrorData.evm_address ?? kmsKeyDerivedEvmAddress;
      console.log(`   ✅ KMS operator account: ${kmsOperatorAccountId}`);
      console.log(`   ✅ KMS EVM address: ${kmsEvmAddress}`);

      setupClient.close();
    } catch (err) {
      console.error("   ❌ KMS account creation failed:", err.message);
      process.exit(1);
    }

    // Authorize KMS EVM address in both registries — FATAL if this fails
    console.log("\n🔐 Authorizing KMS EVM address in compliance registries...");
    await withRetry(() => compliance.addComplianceOperator(kmsEvmAddress), "Authorize KMS in ComplianceRegistry");
    console.log(`   ✅ KMS authorized in ComplianceRegistry: ${kmsEvmAddress}`);
    await withRetry(() => atsRegistry.addComplianceOperator(kmsEvmAddress), "Authorize KMS in ATSIdentityRegistry");
    console.log(`   ✅ KMS authorized in ATSIdentityRegistry: ${kmsEvmAddress}`);
  } else {
    console.warn("   ⚠️  KMS_KEY_ID not set — skipping KMS account creation");
  }

  // ============ STEP 13: Create HCS Audit Topic ============
  console.log("\n📡 Step 13: Creating HCS Audit Log topic...");

  let hcsTopicId = null;
  try {
    const hederaClient = Client.forTestnet();
    const accountIdStr = process.env.DEPLOYER_ACCOUNT_ID;
    if (!accountIdStr) throw new Error("DEPLOYER_ACCOUNT_ID not set in .env");
    const operatorId = AccountId.fromString(accountIdStr);
    const privKey = PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY.replace("0x", ""));
    hederaClient.setOperator(operatorId, privKey);

    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo("Liquid Protocol — RWA Audit Log")
      .setSubmitKey(privKey.publicKey)
      .execute(hederaClient);

    const topicReceipt = await topicTx.getReceipt(hederaClient);
    hcsTopicId = topicReceipt.topicId.toString();
    console.log(`   ✅ HCS Topic created: ${hcsTopicId}`);
    hederaClient.close();
  } catch (err) {
    console.error("   ❌ HCS topic creation failed:", err.message);
    process.exit(1);
  }

  // ============ SAVE ADDRESSES ============
  const addresses = {
    network: "hedera-testnet",
    chainId: 296,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    hcsTopicId,
    kmsOperator: {
      evmAddress:  kmsEvmAddress ?? null,
      accountId:   kmsOperatorAccountId ?? null
    },
    contracts: {
      usdc: usdcAddress,
      adaptiveAMM: ammAddress,
      liquidityVault: vaultAddress,
      complianceRegistry: complianceAddress,
      treasuryManager: treasuryAddress,
      atsIdentityRegistry: atsRegistryAddress,
    },
    tokens: Object.fromEntries(
      rwaTokens.map(t => [t.symbol, {
        address: t.address,
        name: t.name,
        description: t.description,
        standard: "ERC-3643",
      }])
    ),
    pools: Object.fromEntries(
      poolResults.map(p => [p.symbol, {
        ammPoolId: p.poolId,
        lpTokenAddress: p.lpTokenAddress,
        assetToken: p.address,
        assetSymbol: p.symbol,
        quoteToken: usdcAddress,
        quoteSymbol: "USDC",
        initialPrice: (parseFloat(p.seedQuote) / parseFloat(p.seedAsset)).toFixed(2),
        tradingFee: "0.3%",
        staking: {
          rwaStakePoolId: p.stakePoolId,
          lpMiningPoolId: p.lpMiningPoolId,
        }
      }])
    ),
  };

  fs.writeFileSync("deployed-addresses.json", JSON.stringify(addresses, null, 2));

  // ============ AUTO-GENERATE src/config/contracts.js ============
  const contractsJs = `// Auto-generated from deployed-addresses.json — do not edit manually
// KMS Operator: ${kmsOperatorAddress ?? 'not configured'}

export const CONTRACTS = {
  USDC:                 '${usdcAddress}',
  ADAPTIVE_AMM:         '${ammAddress}',
  LIQUIDITY_VAULT:      '${vaultAddress}',
  COMPLIANCE_REGISTRY:  '${complianceAddress}',
  TREASURY_MANAGER:     '${treasuryAddress}',
  ATS_IDENTITY_REGISTRY:'${atsRegistryAddress}',
}

export const TOKENS = {
  USDC: {
    address: '${usdcAddress}',
    symbol: 'USDC',
    name: 'USD Coin',
    description: 'Quote token for all pools',
  },
${rwaTokens.map(t => `  ${t.symbol}: {
    address: '${t.address}',
    symbol: '${t.symbol}',
    name: '${t.name}',
    description: '${t.description}',
    standard: 'ERC-3643',
  },`).join('\n')}
}

// All AMM pools — keyed by RWA token symbol
export const POOLS = {
${poolResults.map(p => `  ${p.symbol}: {
    ammPoolId:      '${p.poolId}',
    lpToken:        '${p.lpTokenAddress}',
    assetToken:     '${p.address}',
    assetSymbol:    '${p.symbol}',
    quoteToken:     '${usdcAddress}',
    quoteSymbol:    'USDC',
    initialPrice:   '${(parseFloat(p.seedQuote) / parseFloat(p.seedAsset)).toFixed(2)}',
    rwaStakePoolId: '${p.stakePoolId}',
    lpMiningPoolId: '${p.lpMiningPoolId}',
  },`).join('\n')}
}

// Ordered list for UI display
export const POOL_SYMBOLS = [${rwaTokens.map(t => `'${t.symbol}'`).join(', ')}]

// RWA tokens available from faucet
export const FAUCET_TOKENS = [${rwaTokens.map(t => `'${t.symbol}'`).join(', ')}, 'USDC']

export const HCS_TOPIC_ID = '${hcsTopicId}';

export const NETWORK = {
  chainId: 296,
  name: 'Hedera Testnet',
  rpcUrl: 'https://testnet.hashio.io/api',
  explorerUrl: 'https://hashscan.io/testnet',
}

// Default export for useContracts.js compatibility
export default {
  AdaptiveAMM:          '${ammAddress}',
  LiquidityVault:       '${vaultAddress}',
  ComplianceRegistry:   '${complianceAddress}',
  TreasuryManager:      '${treasuryAddress}',
  ATSIdentityRegistry:  '${atsRegistryAddress}',
}
`;

  fs.writeFileSync("src/config/contracts.js", contractsJs);
  console.log("💾 Auto-generated: src/config/contracts.js");

  // ============ SUMMARY ============
  console.log("\n" + "=".repeat(60));
  console.log("✅ DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("\n📋 CONTRACTS:");
  console.log("   USDC:                ", usdcAddress);
  console.log("   AdaptiveAMM:         ", ammAddress);
  console.log("   LiquidityVault:      ", vaultAddress);
  console.log("   ComplianceRegistry:  ", complianceAddress);
  console.log("   TreasuryManager:     ", treasuryAddress);
  console.log("   ATSIdentityRegistry: ", atsRegistryAddress);
  console.log("\n🔐 ERC-3643 RWA TOKENS:");
  for (const t of rwaTokens) {
    console.log(`   ${t.symbol} (ERC-3643): ${t.address}`);
  }
  console.log("\n🌊 POOLS:");
  for (const p of poolResults) {
    const price = (parseFloat(p.seedQuote) / parseFloat(p.seedAsset)).toFixed(2);
    console.log(`\n   ${p.symbol}/USDC @ $${price}`);
    console.log(`     AMM Pool:  ${p.poolId}`);
    console.log(`     LP Token:  ${p.lpTokenAddress}`);
    console.log(`     Stake:     ${p.stakePoolId}`);
    console.log(`     LP Mining: ${p.lpMiningPoolId}`);
  }
  console.log("\n🔐 AWS KMS INTEGRATION:");
  console.log("   KMS Operator EVM:", kmsOperatorAddress ?? "not configured");
  console.log("   KMS Operator Account:", kmsOperatorAccountId ?? "not created");
  console.log("   Key ID:", process.env.KMS_KEY_ID ?? "not configured");
  console.log("   All compliance signing routed through AWS KMS — no private key in memory");
  console.log("\n🔗 HEDERA ATS INTEGRATION:");
  console.log("   ATSIdentityRegistry:", atsRegistryAddress);
  console.log("   All RWA tokens are ERC-3643 — compliance enforced at token level");
  console.log("   Deployer verified in ATS registry (US, accredited)");
  console.log("\n📡 HCS AUDIT LOG:");
  console.log("   Topic ID:", hcsTopicId);
  console.log("   View: https://hashscan.io/testnet/topic/" + hcsTopicId);
  console.log("\n💾 Saved to: deployed-addresses.json");
  console.log("=".repeat(60) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:\n", error);
    process.exit(1);
  });