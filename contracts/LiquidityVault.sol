// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LiquidityVault
 * @notice Staking vault supporting multiple pools, each with their own staked token
 * @dev Each pool tracks its own staked token (RWA token or LP token) and pays
 *      rewards in a per-pool reward token. Supports both:
 *      - RWA token staking (stake RWAPROP, earn USDC)
 *      - LP token staking / liquidity mining (stake LP tokens, earn RWA tokens)
 */
contract LiquidityVault is Ownable, ReentrancyGuard {

    // ============ State Variables ============

    struct StakeInfo {
        uint256 amount;           // Amount of tokens staked
        uint256 rewardDebt;       // Reward debt for calculation
        uint256 lastStakeTime;    // Last time user staked
        uint256 pendingRewards;   // Unclaimed rewards accumulated
    }

    struct PoolConfig {
        address stakedToken;       // Token users deposit (RWA token or LP token)
        address rewardToken;       // Token paid out as rewards
        uint256 rewardRate;        // Reward tokens per second
        uint256 accRewardPerShare; // Accumulated rewards per share (scaled by PRECISION)
        uint256 lastRewardTime;    // Last time rewards were calculated
        uint256 totalStaked;       // Total tokens staked in this pool
        bool isActive;             // Whether pool accepts new stakes
    }

    // Pool ID => Pool config
    mapping(bytes32 => PoolConfig) public pools;

    // Pool ID => User => Stake info
    mapping(bytes32 => mapping(address => StakeInfo)) public stakes;

    // Track all pool IDs for enumeration
    bytes32[] public poolIds;

    // Constants
    uint256 public constant PRECISION = 1e18;

    // ============ Events ============

    event PoolInitialized(bytes32 indexed poolId, address stakedToken, address rewardToken, uint256 rewardRate);
    event Staked(bytes32 indexed poolId, address indexed user, uint256 amount);
    event Unstaked(bytes32 indexed poolId, address indexed user, uint256 amount);
    event RewardsClaimed(bytes32 indexed poolId, address indexed user, uint256 amount);
    event RewardRateUpdated(bytes32 indexed poolId, uint256 oldRate, uint256 newRate);
    event EmergencyWithdraw(bytes32 indexed poolId, address indexed user, uint256 amount);
    event RewardsDeposited(bytes32 indexed poolId, address rewardToken, uint256 amount);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Admin Functions ============

    /**
     * @notice Initialize a new staking pool
     * @param poolId      Unique identifier (can match AMM poolId for LP staking)
     * @param stakedToken Token users will stake (RWA token or LP token)
     * @param rewardToken Token paid out as rewards
     * @param rewardRate  Reward tokens distributed per second across all stakers
     */
    function initializePool(
        bytes32 poolId,
        address stakedToken,
        address rewardToken,
        uint256 rewardRate
    ) external onlyOwner {
        require(!pools[poolId].isActive, "Pool already active");
        require(stakedToken != address(0), "Invalid staked token");
        require(rewardToken != address(0), "Invalid reward token");

        pools[poolId] = PoolConfig({
            stakedToken: stakedToken,
            rewardToken: rewardToken,
            rewardRate: rewardRate,
            accRewardPerShare: 0,
            lastRewardTime: block.timestamp,
            totalStaked: 0,
            isActive: true
        });

        poolIds.push(poolId);

        emit PoolInitialized(poolId, stakedToken, rewardToken, rewardRate);
    }

    /**
     * @notice Update the reward rate for a pool
     */
    function updateRewardRate(bytes32 poolId, uint256 newRate) external onlyOwner {
        PoolConfig storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");

        _updatePool(poolId);

        uint256 oldRate = pool.rewardRate;
        pool.rewardRate = newRate;

        emit RewardRateUpdated(poolId, oldRate, newRate);
    }

    /**
     * @notice Deposit reward tokens into a pool so stakers can be paid out
     */
    function depositRewards(bytes32 poolId, uint256 amount) external onlyOwner {
        PoolConfig storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(amount > 0, "Cannot deposit 0");

        IERC20(pool.rewardToken).transferFrom(msg.sender, address(this), amount);

        emit RewardsDeposited(poolId, pool.rewardToken, amount);
    }

    // ============ Core Staking Functions ============

    /**
     * @notice Stake tokens to earn rewards
     */
    function stake(bytes32 poolId, uint256 amount) external nonReentrant {
        PoolConfig storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");
        require(amount > 0, "Cannot stake 0");

        _updatePool(poolId);

        StakeInfo storage userStake = stakes[poolId][msg.sender];

        // Settle any pending rewards before changing stake amount
        if (userStake.amount > 0) {
            uint256 pending = (userStake.amount * pool.accRewardPerShare / PRECISION) - userStake.rewardDebt;
            if (pending > 0) {
                userStake.pendingRewards += pending;
            }
        }

        // Transfer staked tokens from user into vault
        IERC20(pool.stakedToken).transferFrom(msg.sender, address(this), amount);

        // Update user stake
        userStake.amount += amount;
        userStake.lastStakeTime = block.timestamp;
        userStake.rewardDebt = userStake.amount * pool.accRewardPerShare / PRECISION;

        pool.totalStaked += amount;

        emit Staked(poolId, msg.sender, amount);
    }

    /**
     * @notice Unstake tokens (rewards remain claimable)
     */
    function unstake(bytes32 poolId, uint256 amount) external nonReentrant {
        PoolConfig storage pool = pools[poolId];
        StakeInfo storage userStake = stakes[poolId][msg.sender];

        require(userStake.amount >= amount, "Insufficient staked amount");
        require(amount > 0, "Cannot unstake 0");

        _updatePool(poolId);

        // Settle pending rewards
        uint256 pending = (userStake.amount * pool.accRewardPerShare / PRECISION) - userStake.rewardDebt;
        if (pending > 0) {
            userStake.pendingRewards += pending;
        }

        userStake.amount -= amount;
        userStake.rewardDebt = userStake.amount * pool.accRewardPerShare / PRECISION;
        pool.totalStaked -= amount;

        // Return staked tokens to user
        IERC20(pool.stakedToken).transfer(msg.sender, amount);

        emit Unstaked(poolId, msg.sender, amount);
    }

    /**
     * @notice Claim all accumulated rewards
     */
    function claimRewards(bytes32 poolId) external nonReentrant {
        PoolConfig storage pool = pools[poolId];
        require(pool.isActive, "Pool not active");

        _updatePool(poolId);

        StakeInfo storage userStake = stakes[poolId][msg.sender];

        uint256 pending = (userStake.amount * pool.accRewardPerShare / PRECISION) - userStake.rewardDebt;
        uint256 totalRewards = userStake.pendingRewards + pending;

        require(totalRewards > 0, "No rewards to claim");

        userStake.pendingRewards = 0;
        userStake.rewardDebt = userStake.amount * pool.accRewardPerShare / PRECISION;

        IERC20(pool.rewardToken).transfer(msg.sender, totalRewards);

        emit RewardsClaimed(poolId, msg.sender, totalRewards);
    }

    /**
     * @notice Emergency withdraw — returns staked tokens, forfeits all rewards
     */
    function emergencyWithdraw(bytes32 poolId) external nonReentrant {
        PoolConfig storage pool = pools[poolId];
        StakeInfo storage userStake = stakes[poolId][msg.sender];

        uint256 amount = userStake.amount;
        require(amount > 0, "Nothing to withdraw");

        pool.totalStaked -= amount;

        userStake.amount = 0;
        userStake.rewardDebt = 0;
        userStake.pendingRewards = 0;

        IERC20(pool.stakedToken).transfer(msg.sender, amount);

        emit EmergencyWithdraw(poolId, msg.sender, amount);
    }

    // ============ Internal Functions ============

    function _updatePool(bytes32 poolId) internal {
        PoolConfig storage pool = pools[poolId];

        if (block.timestamp <= pool.lastRewardTime) return;

        if (pool.totalStaked == 0 || pool.rewardRate == 0) {
            pool.lastRewardTime = block.timestamp;
            return;
        }

        uint256 timeElapsed = block.timestamp - pool.lastRewardTime;
        uint256 reward = timeElapsed * pool.rewardRate;

        pool.accRewardPerShare += (reward * PRECISION) / pool.totalStaked;
        pool.lastRewardTime = block.timestamp;
    }

    // ============ View Functions ============

    function pendingRewards(bytes32 poolId, address user) external view returns (uint256) {
        PoolConfig memory pool = pools[poolId];
        StakeInfo memory userStake = stakes[poolId][user];

        uint256 accRewardPerShare = pool.accRewardPerShare;

        if (block.timestamp > pool.lastRewardTime && pool.totalStaked > 0 && pool.rewardRate > 0) {
            uint256 timeElapsed = block.timestamp - pool.lastRewardTime;
            uint256 reward = timeElapsed * pool.rewardRate;
            accRewardPerShare += (reward * PRECISION) / pool.totalStaked;
        }

        uint256 pending = (userStake.amount * accRewardPerShare / PRECISION) - userStake.rewardDebt;
        return userStake.pendingRewards + pending;
    }

    function getStakeInfo(bytes32 poolId, address user) external view returns (
        uint256 amount,
        uint256 rewardDebt,
        uint256 lastStakeTime,
        uint256 pendingRewardsAmount
    ) {
        StakeInfo memory s = stakes[poolId][user];
        return (s.amount, s.rewardDebt, s.lastStakeTime, s.pendingRewards);
    }

    function getPoolInfo(bytes32 poolId) external view returns (
        address stakedToken,
        address rewardToken,
        uint256 rewardRatePerSecond,
        uint256 totalStakedAmount,
        uint256 accumulatedRewardPerShare,
        bool isActive
    ) {
        PoolConfig memory pool = pools[poolId];
        return (pool.stakedToken, pool.rewardToken, pool.rewardRate, pool.totalStaked, pool.accRewardPerShare, pool.isActive);
    }

    function getPoolCount() external view returns (uint256) {
        return poolIds.length;
    }

    function getPoolId(uint256 index) external view returns (bytes32) {
        require(index < poolIds.length, "Index out of bounds");
        return poolIds[index];
    }

    function getVaultRewardBalance(bytes32 poolId) external view returns (uint256) {
        return IERC20(pools[poolId].rewardToken).balanceOf(address(this));
    }
}
