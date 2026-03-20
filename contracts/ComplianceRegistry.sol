// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IERC3643IdentityRegistry.sol";
import "./interfaces/IERC3643Compliance.sol";

/**
 * @title ComplianceRegistry
 * @notice ERC-3643 compliant compliance contract for Liquid Protocol RWA tokens.
 *
 * IMPLEMENTS: IERC3643Compliance
 * This means RWAToken.sol can point directly at this contract as its
 * compliance module — no adapter needed. Every RWA token transfer calls
 * canTransfer() on this contract before executing.
 *
 * HEDERA ATS INTEGRATION:
 * Supports dual-path KYC:
 *   1. ATS external registry path — investors verified in Hedera ATS trade immediately
 *   2. Liquid internal whitelist path — manual KYC for non-ATS investors
 *
 * COMPLIANCE FLOW (canTransfer):
 *   1. Check if investor is verified in linked ATS identity registry
 *   2. OR check Liquid's own whitelist + KYC expiry
 *   3. Apply asset restrictions (accreditation, jurisdiction, holding period, limits)
 *
 * TOKEN BINDING:
 * Each RWAToken binds itself to this registry on deployment via bindToken().
 * This creates a two-way link: token enforces compliance, compliance tracks tokens.
 */
contract ComplianceRegistry is Ownable, IERC3643Compliance {

    // ============ State Variables ============

    struct InvestorProfile {
        bool isWhitelisted;
        bool isKYCVerified;
        bool isAccredited;
        uint256 kycExpiryTime;
        string jurisdiction;
        uint256 maxTransferAmount;
        uint256 lastUpdateTime;
        bytes32 kycHash;
    }

    struct AssetRestrictions {
        bool requiresKYC;
        bool requiresAccreditation;
        uint256 minHoldingPeriod;
        uint256 maxTransferAmount;
        mapping(string => bool) blockedJurisdictions;
        bool isActive;
    }

    mapping(address => InvestorProfile) public investors;
    mapping(address => AssetRestrictions) public assetRestrictions;
    mapping(address => mapping(address => uint256)) public purchaseTime;
    mapping(address => bool) public complianceOperators;

    // ERC-3643: ATS external identity registry per asset token
    mapping(address => address) public externalRegistry;

    // ERC-3643: bound tokens
    mapping(address => bool) private _boundTokens;

    // ERC-3643: token agents (can mint, burn, forcedTransfer)
    mapping(address => bool) private _tokenAgents;

    // ============ Events ============

    event InvestorWhitelisted(address indexed investor, bytes32 kycHash);
    event InvestorRemoved(address indexed investor);
    event KYCVerified(address indexed investor, uint256 expiryTime);
    event AccreditationUpdated(address indexed investor, bool isAccredited);
    event AssetRestrictionsSet(address indexed asset, bool requiresKYC, bool requiresAccreditation);
    event JurisdictionBlocked(address indexed asset, string jurisdiction);
    event JurisdictionUnblocked(address indexed asset, string jurisdiction);
    event ComplianceOperatorAdded(address indexed operator);
    event ComplianceOperatorRemoved(address indexed operator);
    event TransferRestrictionUpdated(address indexed asset, uint256 maxAmount);
    event ExternalRegistrySet(address indexed asset, address indexed registry);
    event TokenAgentAdded(address indexed agent);
    event TokenAgentRemoved(address indexed agent);

    // ============ Modifiers ============

    modifier onlyComplianceOperator() {
        require(
            complianceOperators[msg.sender] || msg.sender == owner(),
            "Not compliance operator"
        );
        _;
    }

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {
        complianceOperators[msg.sender] = true;
        _tokenAgents[msg.sender] = true;
    }

    // ============ IERC3643Compliance Implementation ============

    /**
     * @notice Bind an RWAToken to this compliance contract.
     * Called automatically by RWAToken during setCompliance().
     * Only bound tokens can call transferred/created/destroyed.
     */
    function bindToken(address _token) external override {
        require(_token != address(0), "Invalid token");
        require(
            msg.sender == _token || msg.sender == owner(),
            "Only token or owner"
        );
        _boundTokens[_token] = true;
        emit TokenBound(_token);
    }

    function unbindToken(address _token) external override {
        require(
            msg.sender == _token || msg.sender == owner(),
            "Only token or owner"
        );
        _boundTokens[_token] = false;
        emit TokenUnbound(_token);
    }

    /**
     * @notice Called by RWAToken after every successful transfer.
     * Records purchase time for holding period enforcement.
     */
    function transferred(address _from, address _to, uint256 _amount) external override {
        require(_boundTokens[msg.sender], "Token not bound");
        // Record purchase time for holding period checks
        purchaseTime[msg.sender][_to] = block.timestamp;
        _amount; _from; // suppress unused warnings
    }

    /**
     * @notice Called by RWAToken after mint.
     */
    function created(address _to, uint256 _amount) external override {
        require(_boundTokens[msg.sender], "Token not bound");
        purchaseTime[msg.sender][_to] = block.timestamp;
        _amount;
    }

    /**
     * @notice Called by RWAToken after burn.
     * Clears purchase time so holding period resets if tokens are re-issued.
     */
    function destroyed(address _from, uint256 _amount) external override {
        require(_boundTokens[msg.sender], "Token not bound");
        delete purchaseTime[msg.sender][_from];
        _amount;
    }

    /**
     * @notice ERC-3643 compliance check — called by RWAToken before every transfer.
     *
     * This is the core compliance gate. It checks:
     *   1. ATS external registry (if linked) — single-KYC path
     *   2. Liquid internal whitelist — manual KYC path
     *   3. Asset-level restrictions (accreditation, jurisdiction, holding period)
     *
     * Returns true if transfer is allowed, false otherwise.
     * READ-ONLY — no state changes allowed here.
     */
    function canTransfer(
        address _from,
        address _to,
        uint256 _amount
    ) external view override returns (bool) {
        // msg.sender is the token contract
        address asset = msg.sender;

        // If no restrictions set for this asset, allow
        if (!assetRestrictions[asset].isActive) return true;

        AssetRestrictions storage restrictions = assetRestrictions[asset];

        // ── ATS External Registry Check ──
        bool fromATS = isVerifiedInATS(asset, _from);
        bool toATS   = isVerifiedInATS(asset, _to);

        // ── Liquid Internal Whitelist Check ──
        InvestorProfile memory fromProfile = investors[_from];
        InvestorProfile memory toProfile   = investors[_to];

        bool fromAllowed = fromATS || fromProfile.isWhitelisted;
        bool toAllowed   = toATS   || toProfile.isWhitelisted;

        if (!fromAllowed || !toAllowed) return false;

        // ── KYC Check ──
        if (restrictions.requiresKYC) {
            if (!fromATS && (!fromProfile.isKYCVerified || block.timestamp > fromProfile.kycExpiryTime)) return false;
            if (!toATS   && (!toProfile.isKYCVerified   || block.timestamp > toProfile.kycExpiryTime))   return false;
        }

        // ── Accreditation Check ──
        if (restrictions.requiresAccreditation) {
            if (!toATS && !toProfile.isAccredited) return false;
        }

        // ── Jurisdiction Check ──
        if (!toATS && restrictions.blockedJurisdictions[toProfile.jurisdiction]) return false;

        // ── Holding Period Check ──
        if (_from != address(0)) {
            uint256 pt = purchaseTime[asset][_from];
            if (pt > 0 && block.timestamp < pt + restrictions.minHoldingPeriod) return false;
        }

        // ── Transfer Amount Limit ──
        if (restrictions.maxTransferAmount > 0 && _amount > restrictions.maxTransferAmount) return false;

        return true;
    }

    function isTokenAgent(address _agentAddress) external view override returns (bool) {
        return _tokenAgents[_agentAddress] || complianceOperators[_agentAddress] || _agentAddress == owner();
    }

    function isTokenBound(address _token) external view override returns (bool) {
        return _boundTokens[_token];
    }

    // ============ Agent Management ============

    function addTokenAgent(address agent) external onlyOwner {
        require(agent != address(0), "Invalid agent");
        _tokenAgents[agent] = true;
        emit TokenAgentAdded(agent);
    }

    function removeTokenAgent(address agent) external onlyOwner {
        _tokenAgents[agent] = false;
        emit TokenAgentRemoved(agent);
    }

    // ============ ATS Integration ============

    function setExternalRegistry(address asset, address identityRegistry) external onlyOwner {
        require(asset != address(0), "Invalid asset");
        require(identityRegistry != address(0), "Invalid registry");
        externalRegistry[asset] = identityRegistry;
        emit ExternalRegistrySet(asset, identityRegistry);
    }

    function removeExternalRegistry(address asset) external onlyOwner {
        delete externalRegistry[asset];
        emit ExternalRegistrySet(asset, address(0));
    }

    function isVerifiedInATS(address asset, address investor) public view returns (bool) {
        address registry = externalRegistry[asset];
        if (registry == address(0)) return false;
        try IERC3643IdentityRegistry(registry).isVerified(investor) returns (bool verified) {
            return verified;
        } catch {
            return false;
        }
    }

    // ============ Legacy checkTransferAllowed (used by AdaptiveAMM) ============

    /**
     * @notice Legacy compliance check — used by AdaptiveAMM._checkCompliance().
     * Delegates to canTransfer logic but with explicit asset parameter.
     * Required because AdaptiveAMM passes the asset address explicitly.
     */
    function checkTransferAllowed(
        address asset,
        address from,
        address to,
        uint256 amount
    ) external view returns (bool allowed, string memory reason) {
        if (!assetRestrictions[asset].isActive) return (true, "");

        AssetRestrictions storage restrictions = assetRestrictions[asset];

        bool fromATS = isVerifiedInATS(asset, from);
        bool toATS   = isVerifiedInATS(asset, to);

        InvestorProfile memory fromProfile = investors[from];
        InvestorProfile memory toProfile   = investors[to];

        bool fromAllowed = fromATS || fromProfile.isWhitelisted;
        bool toAllowed   = toATS   || toProfile.isWhitelisted;

        if (!fromAllowed) return (false, "Sender not whitelisted");
        if (!toAllowed)   return (false, "Recipient not whitelisted");

        if (restrictions.requiresKYC) {
            if (!fromATS && (!fromProfile.isKYCVerified || block.timestamp > fromProfile.kycExpiryTime))
                return (false, "Sender KYC expired");
            if (!toATS && (!toProfile.isKYCVerified || block.timestamp > toProfile.kycExpiryTime))
                return (false, "Recipient KYC expired");
        }

        if (restrictions.requiresAccreditation) {
            if (!toATS && !toProfile.isAccredited)
                return (false, "Recipient not accredited");
        }

        if (!toATS && restrictions.blockedJurisdictions[toProfile.jurisdiction])
            return (false, "Recipient jurisdiction blocked");

        if (from != address(0)) {
            uint256 pt = purchaseTime[asset][from];
            if (pt > 0 && block.timestamp < pt + restrictions.minHoldingPeriod)
                return (false, "Minimum holding period not met");
        }

        if (restrictions.maxTransferAmount > 0 && amount > restrictions.maxTransferAmount)
            return (false, "Transfer amount exceeds limit");

        return (true, "");
    }

    // ============ Compliance Operator Management ============

    function addComplianceOperator(address operator) external onlyOwner {
        require(operator != address(0), "Invalid operator");
        require(!complianceOperators[operator], "Already operator");
        complianceOperators[operator] = true;
        emit ComplianceOperatorAdded(operator);
    }

    function removeComplianceOperator(address operator) external onlyOwner {
        require(complianceOperators[operator], "Not an operator");
        complianceOperators[operator] = false;
        emit ComplianceOperatorRemoved(operator);
    }

    // ============ Investor Management ============

    function whitelistInvestor(
        address investor,
        bytes32 kycHash,
        string calldata jurisdiction,
        bool isAccredited,
        uint256 kycValidityPeriod
    ) external onlyComplianceOperator {
        require(investor != address(0), "Invalid investor");
        require(kycHash != bytes32(0), "Invalid KYC hash");
        require(bytes(jurisdiction).length > 0, "Invalid jurisdiction");

        InvestorProfile storage profile = investors[investor];
        profile.isWhitelisted   = true;
        profile.isKYCVerified   = true;
        profile.isAccredited    = isAccredited;
        profile.kycHash         = kycHash;
        profile.jurisdiction    = jurisdiction;
        profile.kycExpiryTime   = block.timestamp + kycValidityPeriod;
        profile.lastUpdateTime  = block.timestamp;

        emit InvestorWhitelisted(investor, kycHash);
        emit KYCVerified(investor, profile.kycExpiryTime);
        if (isAccredited) emit AccreditationUpdated(investor, true);
    }

    function removeInvestor(address investor) external onlyComplianceOperator {
        require(investors[investor].isWhitelisted, "Not whitelisted");
        delete investors[investor];
        emit InvestorRemoved(investor);
    }

    function updateAccreditation(address investor, bool isAccredited) external onlyComplianceOperator {
        require(investors[investor].isWhitelisted, "Not whitelisted");
        investors[investor].isAccredited = isAccredited;
        investors[investor].lastUpdateTime = block.timestamp;
        emit AccreditationUpdated(investor, isAccredited);
    }

    function renewKYC(address investor, bytes32 newKycHash, uint256 validityPeriod) external onlyComplianceOperator {
        require(investors[investor].isWhitelisted, "Not whitelisted");
        InvestorProfile storage profile = investors[investor];
        profile.kycHash       = newKycHash;
        profile.kycExpiryTime = block.timestamp + validityPeriod;
        profile.lastUpdateTime = block.timestamp;
        emit KYCVerified(investor, profile.kycExpiryTime);
    }

    // ============ Asset Restriction Management ============

    function setAssetRestrictions(
        address asset,
        bool requiresKYC,
        bool requiresAccreditation,
        uint256 minHoldingPeriod,
        uint256 maxTransferAmount
    ) external onlyOwner {
        require(asset != address(0), "Invalid asset");
        AssetRestrictions storage restrictions = assetRestrictions[asset];
        restrictions.requiresKYC           = requiresKYC;
        restrictions.requiresAccreditation = requiresAccreditation;
        restrictions.minHoldingPeriod      = minHoldingPeriod;
        restrictions.maxTransferAmount     = maxTransferAmount;
        restrictions.isActive              = true;
        emit AssetRestrictionsSet(asset, requiresKYC, requiresAccreditation);
        emit TransferRestrictionUpdated(asset, maxTransferAmount);
    }

    function blockJurisdiction(address asset, string calldata jurisdiction) external onlyOwner {
        require(assetRestrictions[asset].isActive, "Asset not active");
        assetRestrictions[asset].blockedJurisdictions[jurisdiction] = true;
        emit JurisdictionBlocked(asset, jurisdiction);
    }

    function unblockJurisdiction(address asset, string calldata jurisdiction) external onlyOwner {
        require(assetRestrictions[asset].isActive, "Asset not active");
        assetRestrictions[asset].blockedJurisdictions[jurisdiction] = false;
        emit JurisdictionUnblocked(asset, jurisdiction);
    }

    function recordPurchase(address asset, address buyer) external {
        purchaseTime[asset][buyer] = block.timestamp;
    }

    // ============ View Functions ============

    function getInvestorProfile(address investor) external view returns (
        bool isWhitelisted, bool isKYCVerified, bool isAccredited,
        uint256 kycExpiryTime, string memory jurisdiction
    ) {
        InvestorProfile memory profile = investors[investor];
        return (profile.isWhitelisted, profile.isKYCVerified, profile.isAccredited, profile.kycExpiryTime, profile.jurisdiction);
    }

    function getAssetRestrictions(address asset) external view returns (
        bool requiresKYC, bool requiresAccreditation,
        uint256 minHoldingPeriod, uint256 maxTransferAmount, bool isActive
    ) {
        AssetRestrictions storage r = assetRestrictions[asset];
        return (r.requiresKYC, r.requiresAccreditation, r.minHoldingPeriod, r.maxTransferAmount, r.isActive);
    }

    function isJurisdictionBlocked(address asset, string calldata jurisdiction) external view returns (bool) {
        return assetRestrictions[asset].blockedJurisdictions[jurisdiction];
    }

    function isInvestorCompliant(address investor) external view returns (bool) {
        InvestorProfile memory profile = investors[investor];
        return profile.isWhitelisted &&
               profile.isKYCVerified &&
               block.timestamp <= profile.kycExpiryTime;
    }
}
