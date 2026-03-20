const { expect } = require("chai");
const hre = require("hardhat");

describe("Integration Tests - Full Workflow", function () {
  let adaptiveAMM;
  let liquidityVault;
  let complianceRegistry;
  let atsRegistry;
  let treasuryManager;
  let mockAssetToken;   // RWAToken (ERC-3643)
  let mockQuoteToken;   // MockERC20 (USDC)
  let owner, user1, user2;
  let poolId;
  let lpTokenAddress;
  let lpToken;
  let rwaStakePoolId;
  let lpMiningPoolId;

  const INITIAL_ASSET_AMOUNT = hre.ethers.parseEther("1000");
  const INITIAL_QUOTE_AMOUNT = hre.ethers.parseEther("50000");
  const APPRAISAL_VALUE      = hre.ethers.parseEther("50000");
  const TRADING_FEE          = 30;
  const KYC_VALIDITY         = 365 * 24 * 3600;

  const RWA_REWARD_RATE = hre.ethers.parseEther("0.001");
  const LP_REWARD_RATE  = hre.ethers.parseEther("0.0001");

  async function whitelist(address) {
    const kycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(address + "-kyc"));
    await complianceRegistry.whitelistInvestor(address, kycHash, "US", true, KYC_VALIDITY);
  }

  async function verifyATS(address) {
    await atsRegistry.verifyInvestor(address, 840, "accredited");
  }

  before(async function () {
    [owner, user1, user2] = await hre.ethers.getSigners();
    console.log("\n🚀 Deploying all contracts...\n");

    // ── USDC (plain ERC-20 — quote token only) ──
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    mockQuoteToken = await MockERC20.deploy("USD Coin", "USDC");

    // ── Core contracts ──
    const AdaptiveAMM = await hre.ethers.getContractFactory("AdaptiveAMM");
    adaptiveAMM = await AdaptiveAMM.deploy();
    console.log("✅ AdaptiveAMM deployed");

    const LiquidityVault = await hre.ethers.getContractFactory("LiquidityVault");
    liquidityVault = await LiquidityVault.deploy();
    console.log("✅ LiquidityVault deployed");

    const ComplianceRegistry = await hre.ethers.getContractFactory("ComplianceRegistry");
    complianceRegistry = await ComplianceRegistry.deploy();
    console.log("✅ ComplianceRegistry deployed");

    const TreasuryManager = await hre.ethers.getContractFactory("TreasuryManager");
    treasuryManager = await TreasuryManager.deploy(2, 3600);
    console.log("✅ TreasuryManager deployed");

    // ── ATSIdentityRegistry — must deploy BEFORE RWAToken ──
    const ATSIdentityRegistry = await hre.ethers.getContractFactory("ATSIdentityRegistry");
    atsRegistry = await ATSIdentityRegistry.deploy();
    console.log("✅ ATSIdentityRegistry deployed");

    // ── Verify owner, user1, user2 in ATS BEFORE deploying RWAToken ──
    // RWAToken.mint() checks identity registry — must be verified first
    await verifyATS(owner.address);
    await verifyATS(user1.address);
    await verifyATS(user2.address);

    // ── Register AMM and Vault as authorized contracts ──
    // Per official T-REX whitepaper: "Liquidity Pool addresses need to be added
    // to the Identity Registry Storage, giving the Token Issuer and their agent(s)
    // the authority to approve or reject an exchange pair."
    await atsRegistry.registerContract(await adaptiveAMM.getAddress(), "amm");
    await atsRegistry.registerContract(await liquidityVault.getAddress(), "vault");
    console.log("✅ AMM and Vault registered as authorized contracts in ATS registry");

    // ── Deploy RWAToken (ERC-3643) ──
    const RWAToken = await hre.ethers.getContractFactory("RWAToken");
    mockAssetToken = await RWAToken.deploy(
      "RWA Property Token",
      "RWAPROP",
      "Commercial Property — Austin TX",
      APPRAISAL_VALUE,
      await atsRegistry.getAddress(),
      await complianceRegistry.getAddress()
    );
    console.log("✅ RWAToken (ERC-3643) deployed:", await mockAssetToken.getAddress());

    // ── Mint USDC ──
    await mockQuoteToken.mint(owner.address, hre.ethers.parseEther("500000"));
    await mockQuoteToken.mint(user1.address, hre.ethers.parseEther("250000"));
    await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("250000"));

    // ── Mint RWA tokens (identity-verified mint) ──
    await mockAssetToken.mint(owner.address, hre.ethers.parseEther("200000"));
    await mockAssetToken.mint(user1.address, hre.ethers.parseEther("5000"));
    await mockAssetToken.mint(user2.address, hre.ethers.parseEther("5000"));
    console.log("✅ Tokens minted\n");

    // ── Approvals ──
    const ammAddress   = await adaptiveAMM.getAddress();
    const vaultAddress = await liquidityVault.getAddress();

    for (const signer of [owner, user1, user2]) {
      await mockAssetToken.connect(signer).approve(ammAddress,   hre.ethers.MaxUint256);
      await mockQuoteToken.connect(signer).approve(ammAddress,   hre.ethers.MaxUint256);
      await mockAssetToken.connect(signer).approve(vaultAddress, hre.ethers.MaxUint256);
      await mockQuoteToken.connect(signer).approve(vaultAddress, hre.ethers.MaxUint256);
    }
  });

  describe("Complete User Journey", function () {

    it("1. Should whitelist investors in ComplianceRegistry", async function () {
      console.log("\n📋 Step 1: Whitelisting investors...");

      await whitelist(owner.address);
      await whitelist(user1.address);

      const ownerProfile = await complianceRegistry.getInvestorProfile(owner.address);
      const user1Profile = await complianceRegistry.getInvestorProfile(user1.address);

      expect(ownerProfile.isWhitelisted).to.be.true;
      expect(ownerProfile.isKYCVerified).to.be.true;
      expect(ownerProfile.isAccredited).to.be.true;
      expect(user1Profile.isWhitelisted).to.be.true;
      console.log("✅ Owner and user1 whitelisted with KYC + accreditation");
    });

    it("2. Should wire ComplianceRegistry to AdaptiveAMM and set asset restrictions", async function () {
      console.log("\n🛡️  Step 2: Wiring compliance...");

      await adaptiveAMM.setComplianceRegistry(await complianceRegistry.getAddress());
      expect(await adaptiveAMM.complianceEnabled()).to.be.true;

      await complianceRegistry.setAssetRestrictions(
        await mockAssetToken.getAddress(),
        true, true, 0, 0
      );
      await complianceRegistry.setExternalRegistry(
        await mockAssetToken.getAddress(),
        await atsRegistry.getAddress()
      );

      const restrictions = await complianceRegistry.getAssetRestrictions(
        await mockAssetToken.getAddress()
      );
      expect(restrictions.requiresKYC).to.be.true;
      expect(restrictions.requiresAccreditation).to.be.true;
      expect(restrictions.isActive).to.be.true;
      console.log("✅ ComplianceRegistry wired to AMM, asset restrictions set");
    });

    it("3. Should create liquidity pool in AdaptiveAMM", async function () {
      console.log("\n💧 Step 3: Creating liquidity pool...");

      const tx = await adaptiveAMM.createPool(
        await mockAssetToken.getAddress(),
        await mockQuoteToken.getAddress(),
        INITIAL_ASSET_AMOUNT,
        INITIAL_QUOTE_AMOUNT,
        APPRAISAL_VALUE,
        TRADING_FEE
      );
      const receipt = await tx.wait();
      const log = receipt.logs.find(l => {
        try { return adaptiveAMM.interface.parseLog(l).name === "PoolCreated"; }
        catch { return false; }
      });
      const parsed = adaptiveAMM.interface.parseLog(log);
      poolId         = parsed.args.poolId;
      lpTokenAddress = parsed.args.lpToken;

      const { abi } = await hre.artifacts.readArtifact("LPToken");
      lpToken = new hre.ethers.Contract(lpTokenAddress, abi, hre.ethers.provider);

      expect((await adaptiveAMM.getPool(poolId)).isActive).to.be.true;
      expect((await adaptiveAMM.getPool(poolId)).pegPrice).to.be.gt(0);
      expect((await adaptiveAMM.getPool(poolId)).amplification).to.equal(100);
      expect(lpTokenAddress).to.not.equal(hre.ethers.ZeroAddress);
      expect(await lpToken.balanceOf(owner.address)).to.be.gt(0);
      console.log("✅ Pool created. LP token:", lpTokenAddress);
    });

    it("4. Should initialize staking pools and fund reward vaults", async function () {
      console.log("\n🏦 Step 4: Initializing staking pools...");

      rwaStakePoolId = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["bytes32", "string"], [poolId, "stake"])
      );
      lpMiningPoolId = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["bytes32", "string"], [poolId, "lp"])
      );

      await liquidityVault.initializePool(
        rwaStakePoolId,
        await mockAssetToken.getAddress(),
        await mockQuoteToken.getAddress(),
        RWA_REWARD_RATE
      );
      await liquidityVault.initializePool(
        lpMiningPoolId,
        lpTokenAddress,
        await mockAssetToken.getAddress(),
        LP_REWARD_RATE
      );

      const vaultAddress = await liquidityVault.getAddress();
      await mockQuoteToken.approve(vaultAddress, hre.ethers.MaxUint256);
      await mockAssetToken.approve(vaultAddress, hre.ethers.MaxUint256);
      await liquidityVault.depositRewards(rwaStakePoolId, hre.ethers.parseEther("10000"));
      await liquidityVault.depositRewards(lpMiningPoolId, hre.ethers.parseEther("1000"));

      expect((await liquidityVault.getPoolInfo(rwaStakePoolId)).isActive).to.be.true;
      expect((await liquidityVault.getPoolInfo(lpMiningPoolId)).isActive).to.be.true;
      console.log("✅ Staking pools initialized and funded");
    });

    it("5. Should block swap for non-whitelisted user2", async function () {
      console.log("\n🚫 Step 5: Testing compliance enforcement...");

      // user2 is verified in ATS (from before block) but NOT in Liquid whitelist
      // ComplianceRegistry has ATS registry linked in step 2
      // user2 IS in ATS so this should actually pass — let's verify that too
      // First remove user2 from ATS to test the block
      await atsRegistry.revokeInvestor(user2.address);

      await expect(
        adaptiveAMM.connect(user2).swap(
          poolId,
          await mockQuoteToken.getAddress(),
          hre.ethers.parseEther("1000"),
          0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
      console.log("✅ Non-whitelisted user correctly blocked from trading");
    });

    it("6. Should allow swap after user2 completes KYC", async function () {
      console.log("\n✅ Step 6: KYC onboarding + swap...");

      // Re-verify user2 in ATS (simulates completing KYC)
      await verifyATS(user2.address);
      expect(
        await complianceRegistry.isVerifiedInATS(await mockAssetToken.getAddress(), user2.address)
      ).to.be.true;

      const initialBal = await mockAssetToken.balanceOf(user2.address);
      await adaptiveAMM.connect(user2).swap(
        poolId,
        await mockQuoteToken.getAddress(),
        hre.ethers.parseEther("5000"),
        0
      );
      const received = (await mockAssetToken.balanceOf(user2.address)) - initialBal;
      expect(received).to.be.gt(0);
      console.log(`✅ user2 bought ${hre.ethers.formatEther(received)} RWAPROP after KYC`);
    });

    it("7. Should execute swap for whitelisted user1 (buy RWA tokens)", async function () {
      console.log("\n💱 Step 7: Swap for user1...");

      const initialBal = await mockAssetToken.balanceOf(user1.address);
      await adaptiveAMM.connect(user1).swap(
        poolId,
        await mockQuoteToken.getAddress(),
        hre.ethers.parseEther("5000"),
        0
      );
      const received = (await mockAssetToken.balanceOf(user1.address)) - initialBal;
      expect(received).to.be.gt(0);
      console.log(`✅ user1 bought ${hre.ethers.formatEther(received)} RWAPROP`);
    });

    it("8. Should add liquidity and receive LP tokens", async function () {
      console.log("\n💧 Step 8: Adding liquidity...");

      await adaptiveAMM.connect(user1).addLiquidity(
        poolId,
        hre.ethers.parseEther("100"),
        hre.ethers.parseEther("5000")
      );
      const lpBal = await lpToken.balanceOf(user1.address);
      expect(lpBal).to.be.gt(0);
      console.log(`✅ user1 received ${hre.ethers.formatEther(lpBal)} LP tokens`);
    });

    it("9. Should stake RWAPROP to earn USDC", async function () {
      console.log("\n🔒 Step 9: Staking RWAPROP...");

      const stakeAmount = hre.ethers.parseEther("50");
      const vaultAddress = await liquidityVault.getAddress();
      await mockAssetToken.connect(user1).approve(vaultAddress, stakeAmount);
      await liquidityVault.connect(user1).stake(rwaStakePoolId, stakeAmount);

      const info = await liquidityVault.getStakeInfo(rwaStakePoolId, user1.address);
      expect(info.amount).to.equal(stakeAmount);
      console.log(`✅ user1 staked ${hre.ethers.formatEther(stakeAmount)} RWAPROP`);
    });

    it("10. Should stake LP tokens for liquidity mining", async function () {
      console.log("\n⛏️  Step 10: LP mining...");

      const lpBal = await lpToken.balanceOf(user1.address);
      const stakeAmount = lpBal / 2n;
      const vaultAddress = await liquidityVault.getAddress();

      const { abi } = await hre.artifacts.readArtifact("LPToken");
      const lp = new hre.ethers.Contract(lpTokenAddress, abi, user1);
      await lp.approve(vaultAddress, stakeAmount);
      await liquidityVault.connect(user1).stake(lpMiningPoolId, stakeAmount);

      const info = await liquidityVault.getStakeInfo(lpMiningPoolId, user1.address);
      expect(info.amount).to.equal(stakeAmount);
      console.log(`✅ user1 staked ${hre.ethers.formatEther(stakeAmount)} LP tokens`);
    });

    it("11. Should remove investor from whitelist and block further trades", async function () {
      console.log("\n🚫 Step 11: Revoking KYC...");

      // Revoke user2 from ATS registry (the compliance path user2 uses)
      await atsRegistry.revokeInvestor(user2.address);
      expect(
        await complianceRegistry.isVerifiedInATS(await mockAssetToken.getAddress(), user2.address)
      ).to.be.false;

      await expect(
        adaptiveAMM.connect(user2).swap(
          poolId,
          await mockQuoteToken.getAddress(),
          hre.ethers.parseEther("100"),
          0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
      console.log("✅ Revoked investor correctly blocked");
    });

    it("12. Should update pool appraisal value", async function () {
      console.log("\n📊 Step 12: Updating appraisal...");

      const newAppraisal = hre.ethers.parseEther("55000");
      await adaptiveAMM.updateAppraisal(poolId, newAppraisal);
      expect((await adaptiveAMM.getPool(poolId)).appraisalValue).to.equal(newAppraisal);
      expect((await adaptiveAMM.getPool(poolId)).pegPrice).to.be.gt(0);
      console.log("✅ pegPrice shifted:", (await adaptiveAMM.getPool(poolId)).pegPrice.toString());
      console.log("✅ Appraisal updated to $55,000");
    });

    it("13. Should unstake RWAPROP and receive tokens back", async function () {
      console.log("\n🔓 Step 13: Unstaking...");

      const stakeBefore = (await liquidityVault.getStakeInfo(rwaStakePoolId, user1.address)).amount;
      const balBefore = await mockAssetToken.balanceOf(user1.address);
      await liquidityVault.connect(user1).unstake(rwaStakePoolId, stakeBefore);
      expect((await mockAssetToken.balanceOf(user1.address)) - balBefore).to.equal(stakeBefore);
      console.log(`✅ Unstaked ${hre.ethers.formatEther(stakeBefore)} RWAPROP`);
    });

    it("14. Should deposit funds into treasury", async function () {
      console.log("\n💰 Step 14: Treasury deposit...");

      const depositAmount = hre.ethers.parseEther("10000");
      await mockQuoteToken.approve(await treasuryManager.getAddress(), depositAmount);
      await treasuryManager.deposit(await mockQuoteToken.getAddress(), depositAmount);
      expect(
        await treasuryManager.getTreasuryBalance(await mockQuoteToken.getAddress())
      ).to.equal(depositAmount);
      console.log(`✅ Deposited ${hre.ethers.formatEther(depositAmount)} USDC to treasury`);
    });

    it("15. Should create withdrawal request in treasury", async function () {
      console.log("\n📤 Step 15: Treasury withdrawal request...");

      await treasuryManager.requestWithdrawal(
        await mockQuoteToken.getAddress(),
        user1.address,
        hre.ethers.parseEther("1000"),
        "Hackathon demo withdrawal"
      );
      const request = await treasuryManager.getWithdrawalRequest(0);
      expect(request.amount).to.equal(hre.ethers.parseEther("1000"));
      expect(request.executed).to.be.false;
      console.log("✅ Withdrawal request created");
    });
  });

  // ============ System Health Checks ============

  describe("System Health Checks", function () {

    it("Should verify all contracts are deployed", async function () {
      expect(await adaptiveAMM.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await liquidityVault.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await complianceRegistry.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await treasuryManager.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      expect(await atsRegistry.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      console.log("\n✅ All contracts deployed including ATSIdentityRegistry");
    });

    it("Should verify compliance is wired and enforced", async function () {
      expect(await adaptiveAMM.complianceEnabled()).to.be.true;
      expect(await adaptiveAMM.complianceRegistry()).to.equal(
        await complianceRegistry.getAddress()
      );
      console.log("✅ Compliance wired and enforced");
    });

    it("Should verify pool is operational with reserves", async function () {
      const pool = await adaptiveAMM.getPool(poolId);
      expect(pool.isActive).to.be.true;
      expect(pool.assetReserve).to.be.gt(0);
      expect(pool.quoteReserve).to.be.gt(0);
      console.log("✅ Pool operational");
    });

    it("Should verify LP token is a real ERC20", async function () {
      const totalSupply = await lpToken.totalSupply();
      expect(totalSupply).to.be.gt(0);
      expect(await adaptiveAMM.getLPTotalSupply(poolId)).to.equal(totalSupply);
      console.log("✅ LP token is real ERC20");
    });

    it("Should verify RWAToken is ERC-3643 compliant", async function () {
      // Verify core ERC-3643 properties
      expect(await mockAssetToken.identityRegistry()).to.equal(await atsRegistry.getAddress());
      expect(await mockAssetToken.compliance()).to.equal(await complianceRegistry.getAddress());
      expect(await mockAssetToken.version()).to.equal("1.0.0");
      // Verify compliance is bound
      expect(await complianceRegistry.isTokenBound(await mockAssetToken.getAddress())).to.be.true;
      console.log("✅ RWAToken is ERC-3643 compliant");
      console.log("   Identity Registry:", await mockAssetToken.identityRegistry());
      console.log("   Compliance:", await mockAssetToken.compliance());
    });

    it("Should verify compliant investor can trade, non-compliant cannot", async function () {
      expect(await complianceRegistry.isInvestorCompliant(user1.address)).to.be.true;

      const out = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("100")
      );
      expect(out).to.be.gt(0);

      // user2 is revoked from ATS (from step 11) and not in Liquid whitelist
      await expect(
        adaptiveAMM.connect(user2).swap(
          poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("100"), 0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
      console.log("✅ Compliant/non-compliant access control verified");
    });

    it("Should verify both staking pools are active", async function () {
      expect((await liquidityVault.getPoolInfo(rwaStakePoolId)).isActive).to.be.true;
      expect((await liquidityVault.getPoolInfo(lpMiningPoolId)).isActive).to.be.true;
      console.log("✅ Both staking pools active");
    });
  });

  // ============ Hedera ATS Integration ============

  describe("Hedera ATS Integration", function () {
    let atsUser;

    before(async function () {
      // Fresh signer — not previously verified anywhere
      const signers = await hre.ethers.getSigners();
      atsUser = signers[3];

      await mockQuoteToken.mint(atsUser.address, hre.ethers.parseEther("10000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(atsUser).approve(ammAddress, hre.ethers.MaxUint256);
    });

    it("ATS-1. Should confirm ATSIdentityRegistry is deployed and linked", async function () {
      console.log("\n🔗 ATS-1: ATSIdentityRegistry status...");
      expect(await atsRegistry.getAddress()).to.not.equal(hre.ethers.ZeroAddress);
      // Confirm it's linked to the RWA token in ComplianceRegistry
      expect(
        await complianceRegistry.externalRegistry(await mockAssetToken.getAddress())
      ).to.equal(await atsRegistry.getAddress());
      // Confirm it's wired into the RWAToken itself
      expect(await mockAssetToken.identityRegistry()).to.equal(await atsRegistry.getAddress());
      console.log("   ✅ ATSIdentityRegistry deployed and linked at both token and AMM level");
    });

    it("ATS-2. Should confirm RWAToken enforces identity at token level", async function () {
      console.log("\n🔐 ATS-2: Token-level identity enforcement...");
      // Direct transfer to unverified address should fail at TOKEN level
      await expect(
        mockAssetToken.connect(owner).transfer(atsUser.address, hre.ethers.parseEther("1"))
      ).to.be.reverted;
      console.log("   ✅ Direct transfer to unverified address blocked at token level");
    });

    it("ATS-3. Should block unverified investor at AMM level", async function () {
      console.log("\n🚫 ATS-3: Pre-ATS KYC block at AMM...");
      await expect(
        adaptiveAMM.connect(atsUser).swap(
          poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("100"), 0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
      console.log("   ✅ Unverified investor blocked at AMM level");
    });

    it("ATS-4. Should allow trade after investor completes ATS KYC — no Liquid whitelist needed", async function () {
      console.log("\n✅ ATS-4: Single-KYC via ATS registry...");

      // Verify in ATS (simulates Hedera ATS KYC completion)
      await atsRegistry.verifyInvestor(atsUser.address, 840, "accredited");

      // Now the investor can also receive tokens directly
      await mockAssetToken.mint(atsUser.address, hre.ethers.parseEther("10"));

      // And trade on the AMM
      const balBefore = await mockAssetToken.balanceOf(atsUser.address);
      await adaptiveAMM.connect(atsUser).swap(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
      );
      const received = (await mockAssetToken.balanceOf(atsUser.address)) - balBefore;
      expect(received).to.be.gt(0);
      console.log(`   ✅ ATS-verified investor bought ${hre.ethers.formatEther(received)} RWAPROP`);
      console.log(`   ℹ️  No Liquid whitelist needed — KYC satisfied via Hedera ATS`);
    });

    it("ATS-5. Should revoke access when ATS verification is revoked", async function () {
      console.log("\n🚫 ATS-5: ATS revocation...");
      await atsRegistry.revokeInvestor(atsUser.address);

      await expect(
        adaptiveAMM.connect(atsUser).swap(
          poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("100"), 0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
      console.log("   ✅ Revoked ATS investor correctly blocked");
    });
  });

  after(function () {
    console.log("\n" + "=".repeat(50));
    console.log("🎉 INTEGRATION TESTS COMPLETE!");
    console.log("=".repeat(50) + "\n");
  });
});
