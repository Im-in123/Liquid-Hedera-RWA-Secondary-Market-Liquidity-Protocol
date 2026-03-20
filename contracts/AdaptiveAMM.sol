// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LPToken.sol";
import "./ComplianceRegistry.sol";

/**
 * @title AdaptiveAMM
 * @notice AMM using the Curve stableswap invariant, adapted for RWA tokens.
 *
 * DESIGN:
 * Standard x*y=k AMMs ignore fundamental value — price is pure supply/demand.
 * For RWA tokens (property, bonds, equity funds), a known real-world appraisal
 * exists. This AMM anchors price discovery to that appraisal via:
 *
 *   1. pegPrice  — derived from appraisalValue (NAV per token in USDC)
 *   2. Stableswap invariant — reserves are scaled by pegPrice so both sides
 *      are in "USDC units", letting the curve treat them as near-peg assets
 *   3. Amplification A — controls how tightly price stays near NAV.
 *      A=100 means low slippage within ~10% of peg, widening outside.
 *
 * STABLESWAP INVARIANT (n=2):
 *   A·n²·(x+y) + D = A·n²·D + D³/(n²·x·y)
 *
 * where x, y are USDC-scaled reserves and D is the invariant.
 * Solved via Newton's method — same approach as Curve Finance.
 *
 * APPRAISAL UPDATE:
 * When updateAppraisal() is called (e.g. annual property revaluation),
 * pegPrice shifts toward the new NAV. The stableswap equilibrium follows,
 * pulling market price toward fundamentals — without sudden price shocks.
 *
 * This directly solves the boutique RWA liquidity problem:
 * assets trade near NAV with institutional-quality price stability,
 * while still allowing a market-determined premium or discount.
 */
contract AdaptiveAMM is Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION     = 1e18;
    uint256 public constant MIN_LIQUIDITY = 1000;
    uint256 public constant BASIS_POINTS  = 10000;
    uint256 public constant N             = 2;       // number of tokens
    uint256 private constant MAX_ITER     = 255;     // Newton iterations (Curve reference)

    // ============ Pool Struct ============

    struct Pool {
        address assetToken;      // RWA token address
        address quoteToken;      // USDC address
        address lpToken;         // Dedicated ERC20 LP token for this pool
        uint256 assetReserve;    // Raw RWA token reserve
        uint256 quoteReserve;    // Raw USDC reserve
        uint256 appraisalValue;  // Real-world NAV in USDC (18 decimals)
        uint256 pegPrice;        // USDC per 1 RWA token (18 decimals) — the stableswap anchor
        uint256 amplification;   // A parameter: higher = tighter peg, lower = more Uniswap-like
        uint256 lastUpdateTime;
        uint256 tradingFee;      // Basis points (30 = 0.3%)
        bool isActive;
    }

    mapping(bytes32 => Pool) public pools;
    bytes32[] public poolIds;

    ComplianceRegistry public complianceRegistry;
    bool public complianceEnabled;

    // ============ Events ============

    event PoolCreated(bytes32 indexed poolId, address indexed assetToken, address indexed quoteToken, address lpToken, uint256 initialAssetAmount, uint256 initialQuoteAmount);
    event LiquidityAdded(bytes32 indexed poolId, address indexed provider, uint256 assetAmount, uint256 quoteAmount, uint256 lpTokens);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed provider, uint256 assetAmount, uint256 quoteAmount, uint256 lpTokens);
    event Swap(bytes32 indexed poolId, address indexed trader, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);
    event AppraisalUpdated(bytes32 indexed poolId, uint256 oldValue, uint256 newValue, uint256 newPegPrice);
    event AmplificationUpdated(bytes32 indexed poolId, uint256 oldA, uint256 newA);
    event ComplianceRegistrySet(address indexed registry);
    event ComplianceToggled(bool enabled);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Compliance ============

    function setComplianceRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        complianceRegistry = ComplianceRegistry(_registry);
        complianceEnabled = true;
        emit ComplianceRegistrySet(_registry);
    }

    function toggleCompliance(bool _enabled) external onlyOwner {
        complianceEnabled = _enabled;
        emit ComplianceToggled(_enabled);
    }

    function _checkCompliance(address asset, address from, address to, uint256 amount) internal view {
        if (!complianceEnabled || address(complianceRegistry) == address(0)) return;
        (bool allowed, string memory reason) = complianceRegistry.checkTransferAllowed(asset, from, to, amount);
        require(allowed, string(abi.encodePacked("Compliance: ", reason)));
    }

    // ============ Pool Creation ============

    /**
     * @notice Create a new stableswap RWA pool.
     *
     * pegPrice is set to initialQuote / initialAsset — the seed price.
     * Amplification defaults to 100. Both can be updated post-deployment.
     *
     * LP tokens = sqrt(assetScaled * quoteReserve) where assetScaled = asset * pegPrice.
     * This geometric mean ensures LP value is denominated in USDC units on both sides.
     */
    function createPool(
        address assetToken,
        address quoteToken,
        uint256 initialAsset,
        uint256 initialQuote,
        uint256 appraisalValue,
        uint256 tradingFee
    ) external nonReentrant returns (bytes32 poolId) {
        require(assetToken != address(0) && quoteToken != address(0), "Invalid tokens");
        require(initialAsset > 0 && initialQuote > 0, "Zero amounts");
        require(appraisalValue > 0, "Zero appraisal");
        require(tradingFee <= 500, "Fee too high");

        poolId = keccak256(abi.encodePacked(assetToken, quoteToken, block.timestamp));
        require(pools[poolId].assetToken == address(0), "Pool exists");

        // pegPrice: how many USDC per 1 RWA token (18 decimal fixed point)
        uint256 pegPrice = (initialQuote * PRECISION) / initialAsset;

        // LP = sqrt(assetScaled * quoteReserve) — both in USDC units
        uint256 assetScaled = (initialAsset * pegPrice) / PRECISION;
        uint256 initialLp   = _sqrt(assetScaled * initialQuote);
        require(initialLp > MIN_LIQUIDITY, "Insufficient liquidity");

        LPToken lpToken = new LPToken("Liquid LP", "LP");

        IERC20(assetToken).transferFrom(msg.sender, address(this), initialAsset);
        IERC20(quoteToken).transferFrom(msg.sender, address(this), initialQuote);

        pools[poolId] = Pool({
            assetToken:     assetToken,
            quoteToken:     quoteToken,
            lpToken:        address(lpToken),
            assetReserve:   initialAsset,
            quoteReserve:   initialQuote,
            appraisalValue: appraisalValue,
            pegPrice:       pegPrice,
            amplification:  100,
            lastUpdateTime: block.timestamp,
            tradingFee:     tradingFee,
            isActive:       true
        });

        poolIds.push(poolId);
        lpToken.mint(msg.sender, initialLp);

        emit PoolCreated(poolId, assetToken, quoteToken, address(lpToken), initialAsset, initialQuote);
        emit LiquidityAdded(poolId, msg.sender, initialAsset, initialQuote, initialLp);
    }

    // ============ Liquidity ============

    function addLiquidity(
        bytes32 poolId,
        uint256 assetAmount,
        uint256 quoteAmount
    ) external nonReentrant returns (uint256 lpTokens) {
        Pool storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(assetAmount > 0 && quoteAmount > 0, "Zero amounts");

        _checkCompliance(pool.assetToken, msg.sender, msg.sender, assetAmount);

        LPToken lpToken = LPToken(pool.lpToken);
        uint256 lpSupply = lpToken.totalSupply();

        uint256 assetRatio = (assetAmount * PRECISION) / pool.assetReserve;
        uint256 quoteRatio = (quoteAmount * PRECISION) / pool.quoteReserve;
        uint256 ratio      = assetRatio < quoteRatio ? assetRatio : quoteRatio;
        lpTokens           = (lpSupply * ratio) / PRECISION;
        require(lpTokens > 0, "Insufficient LP tokens");

        IERC20(pool.assetToken).transferFrom(msg.sender, address(this), assetAmount);
        IERC20(pool.quoteToken).transferFrom(msg.sender, address(this), quoteAmount);

        pool.assetReserve += assetAmount;
        pool.quoteReserve += quoteAmount;

        lpToken.mint(msg.sender, lpTokens);
        emit LiquidityAdded(poolId, msg.sender, assetAmount, quoteAmount, lpTokens);
    }

    function removeLiquidity(
        bytes32 poolId,
        uint256 lpTokens
    ) external nonReentrant returns (uint256 assetAmount, uint256 quoteAmount) {
        Pool storage pool = pools[poolId];
        require(lpTokens > 0, "Zero LP tokens");

        _checkCompliance(pool.assetToken, msg.sender, msg.sender, lpTokens);

        LPToken lpToken = LPToken(pool.lpToken);
        uint256 lpSupply = lpToken.totalSupply();
        require(lpToken.balanceOf(msg.sender) >= lpTokens, "Insufficient LP balance");

        assetAmount = (pool.assetReserve * lpTokens) / lpSupply;
        quoteAmount = (pool.quoteReserve * lpTokens) / lpSupply;
        require(assetAmount > 0 && quoteAmount > 0, "Insufficient withdrawal");

        lpToken.burn(msg.sender, lpTokens);
        pool.assetReserve -= assetAmount;
        pool.quoteReserve -= quoteAmount;

        IERC20(pool.assetToken).transfer(msg.sender, assetAmount);
        IERC20(pool.quoteToken).transfer(msg.sender, quoteAmount);

        emit LiquidityRemoved(poolId, msg.sender, assetAmount, quoteAmount, lpTokens);
    }

    // ============ Swap ============

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(amountIn > 0, "Zero amount");
        require(tokenIn == pool.assetToken || tokenIn == pool.quoteToken, "Invalid token");

        amountOut = getAmountOut(poolId, tokenIn, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        _checkCompliance(pool.assetToken, msg.sender, msg.sender, amountIn);

        bool buyingAsset      = (tokenIn == pool.quoteToken);
        uint256 fee           = (amountIn * pool.tradingFee) / BASIS_POINTS;
        uint256 amountInAfterFee = amountIn - fee;
        address tokenOut      = buyingAsset ? pool.assetToken : pool.quoteToken;

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);

        if (buyingAsset) {
            pool.quoteReserve += amountInAfterFee;
            pool.assetReserve -= amountOut;
        } else {
            pool.assetReserve += amountInAfterFee;
            pool.quoteReserve -= amountOut;
        }

        pool.lastUpdateTime = block.timestamp;
        emit Swap(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ============ Stableswap Pricing ============

    /**
     * @notice Compute swap output using the stableswap invariant.
     *
     * Both reserves are first scaled to USDC units using pegPrice,
     * making the stableswap math treat the pool as near-parity.
     * The curve then enforces low slippage near peg and high slippage far from it.
     *
     * For a buy (USDC → RWA):
     *   - xIn  = quoteReserve (USDC, already in USDC units)
     *   - yOut = assetReserve scaled to USDC
     *   - Add effectiveIn to xIn, solve for new yOut, delta → unscale to RWA tokens
     *
     * For a sell (RWA → USDC):
     *   - xIn  = assetReserve scaled to USDC
     *   - yOut = quoteReserve (USDC)
     *   - Scale effectiveIn to USDC, add to xIn, solve for new yOut, delta = USDC out
     */
    function getAmountOut(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) public view returns (uint256 amountOut) {
        Pool memory pool = pools[poolId];
        require(pool.isActive, "Pool not active");

        // Scale asset reserve to USDC units for stableswap math
        uint256 assetScaled = (pool.assetReserve * pool.pegPrice) / PRECISION;
        uint256 quoteRaw    = pool.quoteReserve;

        // Deduct fee from input
        uint256 fee         = (amountIn * pool.tradingFee) / BASIS_POINTS;
        uint256 effectiveIn = amountIn - fee;

        bool buyingAsset = (tokenIn == pool.quoteToken);

        if (buyingAsset) {
            // User sends USDC, receives RWA
            // xIn token  = USDC (quoteRaw)
            // yOut token = RWA  (assetScaled)
            uint256 newQuote      = quoteRaw + effectiveIn;
            // Find new assetScaled that preserves D given newQuote
            uint256 newAssetScaled = _getY(pool.amplification, newQuote, quoteRaw, assetScaled);
            // Asset received in scaled units → convert to raw token amount
            uint256 deltaScaled   = assetScaled > newAssetScaled ? assetScaled - newAssetScaled : 0;
            amountOut = (deltaScaled * PRECISION) / pool.pegPrice;
        } else {
            // User sends RWA, receives USDC
            // xIn token  = RWA  (assetScaled)
            // yOut token = USDC (quoteRaw)
            uint256 effectiveInScaled = (effectiveIn * pool.pegPrice) / PRECISION;
            uint256 newAssetScaled    = assetScaled + effectiveInScaled;
            // Find new quoteRaw that preserves D given newAssetScaled
            uint256 newQuote          = _getY(pool.amplification, newAssetScaled, assetScaled, quoteRaw);
            amountOut = quoteRaw > newQuote ? quoteRaw - newQuote : 0;
        }

        require(amountOut > 0, "Zero output");
    }

    /**
     * @notice Compute stableswap invariant D via Newton's method.
     *
     * Invariant: A·n²·(x+y) + D = A·n²·D + D³/(n²·x·y)
     *
     * Newton iteration:
     *   Dp    = D³ / (n² · x · y)
     *   D_new = (A·n²·S + n·Dp) · D / ((A·n² - 1)·D + (n+1)·Dp)
     *
     * Converges in <10 iterations for typical pool sizes.
     */
    function _getD(uint256 A, uint256 x, uint256 y) internal pure returns (uint256 D) {
        uint256 S = x + y;
        if (S == 0) return 0;

        D = S;
        uint256 Ann = A * N * N; // A·n²

        for (uint256 i = 0; i < MAX_ITER; i++) {
            // Dp = D³ / (n²·x·y) — split to avoid overflow
            uint256 Dp = D;
            Dp = (Dp * D) / (N * x + 1); // +1 to avoid div-by-zero at extremes
            Dp = (Dp * D) / (N * y + 1);

            uint256 Dprev = D;
            // Newton step
            D = ((Ann * S + N * Dp) * D) / ((Ann - 1) * D + (N + 1) * Dp);

            if (D > Dprev) {
                if (D - Dprev <= 1) break;
            } else {
                if (Dprev - D <= 1) break;
            }
        }
    }

    /**
     * @notice Given new x reserve, compute new y that preserves invariant D.
     *
     * Rearranging the invariant as a quadratic in y:
     *   y² + b·y - c = 0
     * where:
     *   b = newX + D/Ann - D
     *   c = D³ / (Ann · n² · newX)
     *
     * Newton step: y_new = (y² + c) / (2y + b)
     *
     * @param A    Amplification parameter
     * @param newX New reserve of the input token (after deposit)
     * @param x0   Original reserve of the input token
     * @param y0   Original reserve of the output token
     * @return y   New reserve of the output token
     */
    function _getY(
        uint256 A,
        uint256 newX,
        uint256 x0,
        uint256 y0
    ) internal pure returns (uint256 y) {
        uint256 D   = _getD(A, x0, y0);
        uint256 Ann = A * N * N;

        // c = D³ / (Ann · n² · newX)
        // Computed in two steps to manage precision
        uint256 c = (D * D / (Ann * N * N)) * D / (newX + 1);

        // b = newX + D/Ann - D
        // Can be negative — we handle the sign in the Newton step
        uint256 dOverAnn = D / Ann;
        bool bNeg        = (D > newX + dOverAnn);
        uint256 bAbs     = bNeg
            ? D - newX - dOverAnn
            : newX + dOverAnn - D;

        // Initial guess
        y = D;

        for (uint256 i = 0; i < MAX_ITER; i++) {
            uint256 yPrev = y;

            uint256 num = y * y + c;
            uint256 den;
            if (bNeg) {
                // b is negative: denominator = 2y - |b|
                den = 2 * y > bAbs ? 2 * y - bAbs : 1;
            } else {
                // b is positive: denominator = 2y + b
                den = 2 * y + bAbs;
            }

            if (den == 0) break;
            y = num / den;

            if (y > yPrev) {
                if (y - yPrev <= 1) break;
            } else {
                if (yPrev - y <= 1) break;
            }
        }
    }

    // ============ Admin: Appraisal & Amplification ============

    /**
     * @notice Update real-world appraisal and shift the stableswap peg.
     *
     * pegPrice is blended 50/50 between current market price and the
     * new appraisal-implied price. This prevents sudden shocks while
     * still pulling the curve toward the updated fundamental value.
     *
     * In production, this would be called by a trusted oracle (e.g.
     * Chainlink feed connected to a valuation service).
     */
    function updateAppraisal(bytes32 poolId, uint256 newAppraisal) external onlyOwner {
        Pool storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(newAppraisal > 0, "Invalid appraisal");

        uint256 oldValue = pool.appraisalValue;
        pool.appraisalValue = newAppraisal;

        // Blend market price and appraisal-implied price 50/50
        uint256 marketPeg     = (pool.quoteReserve * PRECISION) / pool.assetReserve;
        uint256 appraisalPeg  = (newAppraisal * PRECISION) / pool.assetReserve;
        pool.pegPrice         = (marketPeg + appraisalPeg) / 2;
        pool.lastUpdateTime   = block.timestamp;

        emit AppraisalUpdated(poolId, oldValue, newAppraisal, pool.pegPrice);
    }

    /**
     * @notice Update the amplification parameter A.
     * A=50:   wide price range, handles large deviations from NAV
     * A=100:  default — balanced stability and flexibility
     * A=500:  very tight peg, minimal slippage near NAV
     */
    function updateAmplification(bytes32 poolId, uint256 newA) external onlyOwner {
        Pool storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(newA >= 1 && newA <= 10000, "A out of range");
        uint256 oldA      = pool.amplification;
        pool.amplification = newA;
        emit AmplificationUpdated(poolId, oldA, newA);
    }

    // ============ View Functions ============

    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getLPBalance(bytes32 poolId, address user) external view returns (uint256) {
        return IERC20(pools[poolId].lpToken).balanceOf(user);
    }

    function getLPToken(bytes32 poolId) external view returns (address) {
        return pools[poolId].lpToken;
    }

    function getLPTotalSupply(bytes32 poolId) external view returns (uint256) {
        return IERC20(pools[poolId].lpToken).totalSupply();
    }

    function getPoolCount() external view returns (uint256) {
        return poolIds.length;
    }

    function getPoolId(uint256 index) external view returns (bytes32) {
        require(index < poolIds.length, "Index out of bounds");
        return poolIds[index];
    }

    /// @notice Current effective price: USDC per RWA token (18 decimals)
    function getCurrentPrice(bytes32 poolId) external view returns (uint256) {
        return pools[poolId].pegPrice;
    }

    // ============ Internal Helpers ============

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
        return y;
    }
}
