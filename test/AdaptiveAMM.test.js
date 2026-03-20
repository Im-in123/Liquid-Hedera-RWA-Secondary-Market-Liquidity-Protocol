const { expect } = require("chai");
const hre = require("hardhat");

describe("AdaptiveAMM — Stableswap RWA", function () {
  let adaptiveAMM;
  let complianceRegistry;
  let atsRegistry;
  let mockAssetToken;  // RWAToken (ERC-3643)
  let mockQuoteToken;  // MockERC20 (USDC)
  let owner;
  let user1;
  let user2;

  const INITIAL_ASSET_AMOUNT = hre.ethers.parseEther("1000");
  const INITIAL_QUOTE_AMOUNT = hre.ethers.parseEther("50000");
  const APPRAISAL_VALUE      = hre.ethers.parseEther("50000");
  const TRADING_FEE          = 30;
  const KYC_VALIDITY         = 365 * 24 * 3600;

  // Whitelist in Liquid's internal registry
  async function whitelist(address) {
    const kycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(address + "-kyc"));
    await complianceRegistry.whitelistInvestor(address, kycHash, "US", true, KYC_VALIDITY);
  }

  // Verify in ATS registry
  async function verifyATS(address) {
    await atsRegistry.verifyInvestor(address, 840, "accredited");
  }

  async function createPool(signer) {
    const s = signer ?? owner;
    const tx = await adaptiveAMM.connect(s).createPool(
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
    return { poolId: parsed.args.poolId, lpTokenAddress: parsed.args.lpToken };
  }

  async function getLPToken(poolId) {
    const lpTokenAddress = await adaptiveAMM.getLPToken(poolId);
    const { abi } = await hre.artifacts.readArtifact("LPToken");
    return new hre.ethers.Contract(lpTokenAddress, abi, hre.ethers.provider);
  }

  beforeEach(async function () {
    [owner, user1, user2] = await hre.ethers.getSigners();

    // Deploy USDC (plain ERC-20 — quote token)
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    mockQuoteToken = await MockERC20.deploy("USD Coin", "USDC");

    // Deploy ComplianceRegistry
    const ComplianceRegistry = await hre.ethers.getContractFactory("ComplianceRegistry");
    complianceRegistry = await ComplianceRegistry.deploy();

    // Deploy ATSIdentityRegistry
    const ATSIdentityRegistry = await hre.ethers.getContractFactory("ATSIdentityRegistry");
    atsRegistry = await ATSIdentityRegistry.deploy();

    // Verify owner and user1 in ATS BEFORE deploying RWAToken
    // (RWAToken constructor calls bindToken on compliance, and mint checks identity)
    await verifyATS(owner.address);
    await verifyATS(user1.address);

    // Also whitelist in Liquid's internal registry
    await whitelist(owner.address);
    await whitelist(user1.address);

    // Deploy RWAToken (ERC-3643) — wired to ATSIdentityRegistry + ComplianceRegistry
    const RWAToken = await hre.ethers.getContractFactory("RWAToken");
    mockAssetToken = await RWAToken.deploy(
      "RWA Property Token",
      "RWAPROP",
      "Commercial Property — Austin TX",
      APPRAISAL_VALUE,
      await atsRegistry.getAddress(),
      await complianceRegistry.getAddress()
    );

    // Deploy AdaptiveAMM and wire compliance
    const AdaptiveAMM = await hre.ethers.getContractFactory("AdaptiveAMM");
    adaptiveAMM = await AdaptiveAMM.deploy();
    await adaptiveAMM.setComplianceRegistry(await complianceRegistry.getAddress());

    // ── Register AMM in ATS identity registry ──
    // Per official T-REX whitepaper: "Liquidity Pool addresses need to be added
    // to the Identity Registry Storage, giving the Token Issuer and their agent(s)
    // the authority to approve or reject an exchange pair."
    await atsRegistry.registerContract(await adaptiveAMM.getAddress(), "amm");

    // Set asset restrictions + link ATS registry
    await complianceRegistry.setAssetRestrictions(
      await mockAssetToken.getAddress(),
      true, true, 0, 0
    );
    await complianceRegistry.setExternalRegistry(
      await mockAssetToken.getAddress(),
      await atsRegistry.getAddress()
    );

    // Mint tokens — RWAToken.mint checks identity registry first
    await mockAssetToken.mint(owner.address, hre.ethers.parseEther("10000"));
    await mockQuoteToken.mint(owner.address, hre.ethers.parseEther("500000"));
    await mockAssetToken.mint(user1.address, hre.ethers.parseEther("5000"));
    await mockQuoteToken.mint(user1.address, hre.ethers.parseEther("250000"));

    const ammAddress = await adaptiveAMM.getAddress();
    await mockAssetToken.approve(ammAddress, hre.ethers.MaxUint256);
    await mockQuoteToken.approve(ammAddress, hre.ethers.MaxUint256);
    await mockAssetToken.connect(user1).approve(ammAddress, hre.ethers.MaxUint256);
    await mockQuoteToken.connect(user1).approve(ammAddress, hre.ethers.MaxUint256);
  });

  // ============ Pool Creation ============

  describe("Pool Creation", function () {
    it("Should create pool and emit PoolCreated with lpToken", async function () {
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
      expect(log).to.not.be.undefined;
      const parsed = adaptiveAMM.interface.parseLog(log);
      expect(parsed.args.lpToken).to.not.equal(hre.ethers.ZeroAddress);
      expect(await adaptiveAMM.getPoolCount()).to.equal(1);
    });

    it("Should deploy a real ERC20 LP token on pool creation", async function () {
      const { poolId } = await createPool();
      const lpToken = await getLPToken(poolId);
      expect(await lpToken.balanceOf(owner.address)).to.be.gt(0);
    });

    it("Should set pegPrice and amplification on pool creation", async function () {
      const { poolId } = await createPool();
      const pool = await adaptiveAMM.getPool(poolId);
      const expectedPeg = (INITIAL_QUOTE_AMOUNT * hre.ethers.parseEther("1")) / INITIAL_ASSET_AMOUNT;
      expect(pool.pegPrice).to.equal(expectedPeg);
      expect(pool.amplification).to.equal(100);
    });

    it("Should reject pool creation with zero amounts", async function () {
      await expect(
        adaptiveAMM.createPool(
          await mockAssetToken.getAddress(),
          await mockQuoteToken.getAddress(),
          0, INITIAL_QUOTE_AMOUNT, APPRAISAL_VALUE, TRADING_FEE
        )
      ).to.be.revertedWith("Zero amounts");
    });

    it("Should reject pool creation with excessive fee", async function () {
      await expect(
        adaptiveAMM.createPool(
          await mockAssetToken.getAddress(),
          await mockQuoteToken.getAddress(),
          INITIAL_ASSET_AMOUNT, INITIAL_QUOTE_AMOUNT, APPRAISAL_VALUE, 1000
        )
      ).to.be.revertedWith("Fee too high");
    });
  });

  // ============ ERC-3643 Token-Level Compliance ============

  describe("ERC-3643 Token-Level Compliance", function () {
    it("Should block direct wallet transfer to non-verified address", async function () {
      // user2 is NOT in ATS registry or Liquid whitelist
      // Even a direct wallet transfer should revert at token level
      await expect(
        mockAssetToken.connect(owner).transfer(user2.address, hre.ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("Should allow direct wallet transfer to ATS-verified address", async function () {
      await verifyATS(user2.address);
      const bal = await mockAssetToken.balanceOf(user2.address);
      await mockAssetToken.connect(owner).transfer(user2.address, hre.ethers.parseEther("10"));
      expect(await mockAssetToken.balanceOf(user2.address)).to.equal(bal + hre.ethers.parseEther("10"));
    });

    it("Should block mint to non-verified address", async function () {
      await expect(
        mockAssetToken.mint(user2.address, hre.ethers.parseEther("100"))
      ).to.be.revertedWith("Recipient not verified");
    });

    it("Should allow mint to ATS-verified address", async function () {
      await verifyATS(user2.address);
      const balBefore = await mockAssetToken.balanceOf(user2.address);
      await mockAssetToken.mint(user2.address, hre.ethers.parseEther("100"));
      expect(await mockAssetToken.balanceOf(user2.address)).to.equal(balBefore + hre.ethers.parseEther("100"));
    });

    it("Token pause should block all transfers", async function () {
      await mockAssetToken.pause();
      await expect(
        mockAssetToken.connect(owner).transfer(user1.address, hre.ethers.parseEther("1"))
      ).to.be.revertedWith("Token is paused");
      await mockAssetToken.unpause();
    });

    it("Frozen address cannot send tokens", async function () {
      await mockAssetToken.setAddressFrozen(owner.address, true);
      await expect(
        mockAssetToken.connect(owner).transfer(user1.address, hre.ethers.parseEther("1"))
      ).to.be.revertedWith("Sender address frozen");
      await mockAssetToken.setAddressFrozen(owner.address, false);
    });

    it("forcedTransfer should work regardless of compliance (official ERC-3643 behaviour)", async function () {
      await verifyATS(user2.address);
      await mockAssetToken.mint(user2.address, hre.ethers.parseEther("100"));
      // Revoke user2 from ATS — they are now non-compliant
      await atsRegistry.revokeInvestor(user2.address);
      // forcedTransfer to owner (who IS verified) should still work
      // Per official EIP-3643: forcedTransfer only requires receiver to be identity-verified
      // It bypasses canTransfer() compliance check by design
      const balBefore = await mockAssetToken.balanceOf(owner.address);
      await mockAssetToken.forcedTransfer(user2.address, owner.address, hre.ethers.parseEther("50"));
      expect(await mockAssetToken.balanceOf(owner.address)).to.equal(balBefore + hre.ethers.parseEther("50"));
    });
  });

  // ============ faucetMint — Demo Mode ============

  describe("RWAToken faucetMint (Demo Mode)", function () {
    it("Should revert faucetMint when demo mode is off", async function () {
      // demo mode is off by default in tests
      await expect(
        mockAssetToken.connect(user2).faucetMint()
      ).to.be.revertedWith("Demo mode not enabled");
    });

    it("Should revert faucetMint for unverified address even in demo mode", async function () {
      await mockAssetToken.setDemoMode(true);
      // user2 is NOT verified in ATS at this point
      await expect(
        mockAssetToken.connect(user2).faucetMint()
      ).to.be.revertedWith("Must be identity verified first");
      await mockAssetToken.setDemoMode(false);
    });

    it("Should allow verified address to faucetMint in demo mode", async function () {
      await mockAssetToken.setDemoMode(true);
      await verifyATS(user2.address);

      const balBefore = await mockAssetToken.balanceOf(user2.address);
      await mockAssetToken.connect(user2).faucetMint();
      const balAfter = await mockAssetToken.balanceOf(user2.address);

      expect(balAfter - balBefore).to.equal(await mockAssetToken.FAUCET_AMOUNT());
      await mockAssetToken.setDemoMode(false);
    });

    it("Should block double claim from same address", async function () {
      await mockAssetToken.setDemoMode(true);
      await verifyATS(user2.address);

      await mockAssetToken.connect(user2).faucetMint();
      await expect(
        mockAssetToken.connect(user2).faucetMint()
      ).to.be.revertedWith("Already claimed from faucet");
      await mockAssetToken.setDemoMode(false);
    });

    it("Should only allow owner to toggle demo mode", async function () {
      await expect(
        mockAssetToken.connect(user1).setDemoMode(true)
      ).to.be.reverted;
    });

    it("FAUCET_AMOUNT should be 1000 tokens", async function () {
      expect(await mockAssetToken.FAUCET_AMOUNT()).to.equal(
        hre.ethers.parseEther("1000")
      );
    });
  });

  // ============ AMM-Level Compliance (unchanged) ============

  describe("Compliance Enforcement", function () {
    let poolId;

    beforeEach(async function () {
      ({ poolId } = await createPool());
    });

    it("Should block swap for non-whitelisted address", async function () {
      await expect(
        adaptiveAMM.connect(user2).swap(
          poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
    });

    it("Should block addLiquidity for non-whitelisted address", async function () {
      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("50000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      await expect(
        adaptiveAMM.connect(user2).addLiquidity(
          poolId, hre.ethers.parseEther("100"), hre.ethers.parseEther("5000")
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
    });

    it("Should block removeLiquidity for non-whitelisted address", async function () {
      await adaptiveAMM.connect(user1).addLiquidity(
        poolId, hre.ethers.parseEther("100"), hre.ethers.parseEther("5000")
      );
      const lpToken = await getLPToken(poolId);
      const lpBal = await lpToken.balanceOf(user1.address);

      const { abi } = await hre.artifacts.readArtifact("LPToken");
      const lp = new hre.ethers.Contract(await lpToken.getAddress(), abi, user1);
      await lp.transfer(user2.address, lpBal);
      const ammAddress = await adaptiveAMM.getAddress();
      const lp2 = new hre.ethers.Contract(await lpToken.getAddress(), abi, user2);
      await lp2.approve(ammAddress, lpBal);

      await expect(
        adaptiveAMM.connect(user2).removeLiquidity(poolId, lpBal)
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
    });

    it("Should allow swap after address is whitelisted", async function () {
      await verifyATS(user2.address);
      await whitelist(user2.address);
      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("10000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      const initialBal = await mockAssetToken.balanceOf(user2.address);
      await adaptiveAMM.connect(user2).swap(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
      );
      expect(await mockAssetToken.balanceOf(user2.address)).to.be.gt(initialBal);
    });

    it("Should allow owner to toggle compliance off", async function () {
      await adaptiveAMM.toggleCompliance(false);

      await verifyATS(user2.address);
      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("10000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      const initialBal = await mockAssetToken.balanceOf(user2.address);
      await adaptiveAMM.connect(user2).swap(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
      );
      expect(await mockAssetToken.balanceOf(user2.address)).to.be.gt(initialBal);
      await adaptiveAMM.toggleCompliance(true);
    });
  });

  // ============ Liquidity Management ============

  describe("Liquidity Management", function () {
    let poolId;
    let lpToken;

    beforeEach(async function () {
      const result = await createPool();
      poolId = result.poolId;
      lpToken = await getLPToken(poolId);
    });

    it("Should add liquidity and mint LP tokens for whitelisted user", async function () {
      const initialLPBalance = await lpToken.balanceOf(user1.address);
      const initialPool = await adaptiveAMM.getPool(poolId);

      await adaptiveAMM.connect(user1).addLiquidity(
        poolId, hre.ethers.parseEther("100"), hre.ethers.parseEther("5000")
      );

      expect(await lpToken.balanceOf(user1.address)).to.be.gt(initialLPBalance);
      expect((await adaptiveAMM.getPool(poolId)).assetReserve).to.be.gt(initialPool.assetReserve);
    });

    it("getLPBalance should return the ERC20 LP token balance", async function () {
      const lpBal = await adaptiveAMM.getLPBalance(poolId, owner.address);
      expect(lpBal).to.equal(await lpToken.balanceOf(owner.address));
      expect(lpBal).to.be.gt(0);
    });

    it("getLPTotalSupply should match LP token totalSupply", async function () {
      expect(await adaptiveAMM.getLPTotalSupply(poolId)).to.equal(await lpToken.totalSupply());
    });

    it("Should remove liquidity and return underlying assets", async function () {
      await adaptiveAMM.connect(user1).addLiquidity(
        poolId, hre.ethers.parseEther("100"), hre.ethers.parseEther("5000")
      );

      const lpBalance = await lpToken.balanceOf(user1.address);
      const initialAsset = await mockAssetToken.balanceOf(user1.address);
      const initialQuote = await mockQuoteToken.balanceOf(user1.address);

      const ammAddress = await adaptiveAMM.getAddress();
      const { abi } = await hre.artifacts.readArtifact("LPToken");
      const lp = new hre.ethers.Contract(await lpToken.getAddress(), abi, user1);
      await lp.approve(ammAddress, lpBalance);

      await adaptiveAMM.connect(user1).removeLiquidity(poolId, lpBalance / 2n);

      expect(await mockAssetToken.balanceOf(user1.address)).to.be.gt(initialAsset);
      expect(await mockQuoteToken.balanceOf(user1.address)).to.be.gt(initialQuote);
      expect(await lpToken.balanceOf(user1.address)).to.be.lt(lpBalance);
    });

    it("Should reject removing more LP than held", async function () {
      await expect(
        adaptiveAMM.connect(user1).removeLiquidity(poolId, hre.ethers.parseEther("999999"))
      ).to.be.revertedWith("Insufficient LP balance");
    });
  });

  // ============ Swapping ============

  describe("Swapping", function () {
    let poolId;

    beforeEach(async function () {
      ({ poolId } = await createPool());
    });

    it("Should swap quote → asset (buy) for whitelisted user", async function () {
      const initialBal = await mockAssetToken.balanceOf(user1.address);
      await adaptiveAMM.connect(user1).swap(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
      );
      expect(await mockAssetToken.balanceOf(user1.address)).to.be.gt(initialBal);
    });

    it("Should swap asset → quote (sell) for whitelisted user", async function () {
      const initialBal = await mockQuoteToken.balanceOf(user1.address);
      await adaptiveAMM.connect(user1).swap(
        poolId, await mockAssetToken.getAddress(), hre.ethers.parseEther("10"), 0
      );
      expect(await mockQuoteToken.balanceOf(user1.address)).to.be.gt(initialBal);
    });

    it("Should reject swap when slippage is exceeded", async function () {
      const swapAmount = hre.ethers.parseEther("1000");
      const expectedOut = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), swapAmount
      );
      await expect(
        adaptiveAMM.connect(user1).swap(
          poolId, await mockQuoteToken.getAddress(), swapAmount, expectedOut * 2n
        )
      ).to.be.revertedWith("Slippage exceeded");
    });
  });

  // ============ Stableswap Price Discovery ============

  describe("Stableswap Price Discovery", function () {
    let poolId;

    beforeEach(async function () {
      ({ poolId } = await createPool());
    });

    it("Should calculate output amount > 0 for a valid swap", async function () {
      const out = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000")
      );
      expect(out).to.be.gt(0);
    });

    it("Buy price near peg: 50 USDC should yield ~1 RWAPROP (stableswap low slippage)", async function () {
      const out = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("50")
      );
      const outFloat = parseFloat(hre.ethers.formatEther(out));
      expect(outFloat).to.be.gt(0.95);
      expect(outFloat).to.be.lt(1.05);
    });

    it("Large trade should have higher slippage than small trade (curve effect)", async function () {
      const smallOut = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("50")
      );
      const largeOut = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("10000")
      );
      const smallPrice = 50.0 / parseFloat(hre.ethers.formatEther(smallOut));
      const largePrice = 10000.0 / parseFloat(hre.ethers.formatEther(largeOut));
      expect(largePrice).to.be.gt(smallPrice);
    });

    it("Buy and sell outputs should be roughly symmetric near peg", async function () {
      const buyOut = await adaptiveAMM.getAmountOut(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("500")
      );
      const sellOut = await adaptiveAMM.getAmountOut(
        poolId, await mockAssetToken.getAddress(), buyOut
      );
      const ratio = parseFloat(hre.ethers.formatEther(sellOut)) / 500.0;
      expect(ratio).to.be.gt(0.98);
      expect(ratio).to.be.lt(1.0);
    });

    it("Should update appraisal and shift pegPrice", async function () {
      const poolBefore = await adaptiveAMM.getPool(poolId);
      const oldPeg = poolBefore.pegPrice;
      const newAppraisal = hre.ethers.parseEther("60000");
      await adaptiveAMM.updateAppraisal(poolId, newAppraisal);
      const poolAfter = await adaptiveAMM.getPool(poolId);
      expect(poolAfter.appraisalValue).to.equal(newAppraisal);
      expect(poolAfter.pegPrice).to.be.gt(oldPeg);
    });

    it("Should update amplification parameter", async function () {
      const { poolId: pid } = await createPool();
      await adaptiveAMM.updateAmplification(pid, 200);
      expect((await adaptiveAMM.getPool(pid)).amplification).to.equal(200);
    });

    it("Higher amplification should produce less slippage near peg", async function () {
      const { poolId: pool1 } = await createPool();
      const tx = await adaptiveAMM.createPool(
        await mockAssetToken.getAddress(),
        await mockQuoteToken.getAddress(),
        INITIAL_ASSET_AMOUNT, INITIAL_QUOTE_AMOUNT, APPRAISAL_VALUE, TRADING_FEE
      );
      const receipt = await tx.wait();
      const log = receipt.logs.find(l => {
        try { return adaptiveAMM.interface.parseLog(l).name === "PoolCreated"; }
        catch { return false; }
      });
      const pool2 = adaptiveAMM.interface.parseLog(log).args.poolId;
      await adaptiveAMM.updateAmplification(pool2, 500);

      const swapAmount = hre.ethers.parseEther("500");
      const out1 = await adaptiveAMM.getAmountOut(pool1, await mockQuoteToken.getAddress(), swapAmount);
      const out2 = await adaptiveAMM.getAmountOut(pool2, await mockQuoteToken.getAddress(), swapAmount);
      expect(out2).to.be.gte(out1);
    });
  });

  // ============ View Functions ============

  describe("View Functions", function () {
    it("Should return correct pool count", async function () {
      expect(await adaptiveAMM.getPoolCount()).to.equal(0);
      await createPool();
      expect(await adaptiveAMM.getPoolCount()).to.equal(1);
      await createPool();
      expect(await adaptiveAMM.getPoolCount()).to.equal(2);
    });

    it("getLPToken should return the LP token address", async function () {
      const { poolId, lpTokenAddress } = await createPool();
      expect(await adaptiveAMM.getLPToken(poolId)).to.equal(lpTokenAddress);
    });

    it("getCurrentPrice should return pegPrice", async function () {
      const { poolId } = await createPool();
      const pool = await adaptiveAMM.getPool(poolId);
      expect(await adaptiveAMM.getCurrentPrice(poolId)).to.equal(pool.pegPrice);
    });

    it("Should expose complianceRegistry address", async function () {
      expect(await adaptiveAMM.complianceRegistry()).to.equal(
        await complianceRegistry.getAddress()
      );
    });

    it("Should report complianceEnabled as true after wiring", async function () {
      expect(await adaptiveAMM.complianceEnabled()).to.be.true;
    });
  });

  // ============ ATS Identity Registry Integration ============

  describe("ATS Identity Registry Integration", function () {
    let poolId;

    beforeEach(async function () {
      ({ poolId } = await createPool());
    });

    it("Should allow swap for investor verified in ATS registry (not in Liquid whitelist)", async function () {
      await verifyATS(user2.address);
      // user2 is in ATS but NOT in Liquid whitelist
      // Compliance passes via ATS path
      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("10000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      const initialBal = await mockAssetToken.balanceOf(user2.address);
      await adaptiveAMM.connect(user2).swap(
        poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
      );
      expect(await mockAssetToken.balanceOf(user2.address)).to.be.gt(initialBal);
    });

    it("Should block swap if investor is in ATS but their country is blocked", async function () {
      await atsRegistry.verifyInvestor(user2.address, 408, "retail");
      await atsRegistry.blockCountry(408);

      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("10000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      await expect(
        adaptiveAMM.connect(user2).swap(
          poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
    });

    it("Should block swap if ATS verification is revoked", async function () {
      await verifyATS(user2.address);
      await atsRegistry.revokeInvestor(user2.address);

      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("10000"));
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      await expect(
        adaptiveAMM.connect(user2).swap(
          poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("1000"), 0
        )
      ).to.be.revertedWith("Compliance: Sender not whitelisted");
    });

    it("isVerifiedInATS should return correct status", async function () {
      const assetAddress = await mockAssetToken.getAddress();
      expect(await complianceRegistry.isVerifiedInATS(assetAddress, user2.address)).to.be.false;
      await verifyATS(user2.address);
      expect(await complianceRegistry.isVerifiedInATS(assetAddress, user2.address)).to.be.true;
      await atsRegistry.revokeInvestor(user2.address);
      expect(await complianceRegistry.isVerifiedInATS(assetAddress, user2.address)).to.be.false;
    });

    it("Should accept investor via Liquid whitelist OR ATS registry", async function () {
      await verifyATS(user2.address);
      const ammAddress = await adaptiveAMM.getAddress();
      await mockQuoteToken.mint(user2.address, hre.ethers.parseEther("10000"));
      await mockQuoteToken.connect(user2).approve(ammAddress, hre.ethers.MaxUint256);

      const bal1Before = await mockAssetToken.balanceOf(user1.address);
      await adaptiveAMM.connect(user1).swap(poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("500"), 0);
      expect(await mockAssetToken.balanceOf(user1.address)).to.be.gt(bal1Before);

      const bal2Before = await mockAssetToken.balanceOf(user2.address);
      await adaptiveAMM.connect(user2).swap(poolId, await mockQuoteToken.getAddress(), hre.ethers.parseEther("500"), 0);
      expect(await mockAssetToken.balanceOf(user2.address)).to.be.gt(bal2Before);
    });
  });
});
