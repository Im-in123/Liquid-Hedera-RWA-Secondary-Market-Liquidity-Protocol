// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IERC3643IdentityRegistry.sol";

/**
 * @title ATSIdentityRegistry
 * @notice ERC-3643 identity registry simulating Hedera Asset Tokenization Studio
 *
 * PURPOSE:
 * Simulates the identity registry that Hedera's Asset Tokenization Studio deploys
 * alongside every tokenized RWA. The interface is identical to what real ATS uses.
 *
 * OFFICIAL ERC-3643 PATTERN — SMART CONTRACT REGISTRATION:
 * Per the official T-REX whitepaper (Tokeny, v4):
 *   "Liquidity Pool addresses need to be added to the Identity Registry Storage,
 *    giving the Token Issuer and their agent(s) the authority to approve or
 *    reject an exchange pair."
 *
 * This means AMM contracts, vault contracts, and other authorized smart contracts
 * that hold or route ERC-3643 tokens MUST be registered in the identity registry.
 * This is done via registerContract() — separate from verifyInvestor() — because
 * smart contracts are not investors but they are still authorized token holders.
 *
 * This is NOT a bypass or workaround. It is the officially documented pattern.
 *
 * TWO REGISTRATION PATHS:
 *   1. verifyInvestor()   — for human investors completing KYC/AML
 *   2. registerContract() — for authorized smart contracts (AMM, vault, LP pool)
 *      registered by the token issuer or their agents, per the T-REX whitepaper
 */
contract ATSIdentityRegistry is IERC3643IdentityRegistry, Ownable {

    // ============ Investor Identity ============

    struct Identity {
        address onchainId;   // ONCHAINID (simplified: wallet address)
        uint16  country;     // ISO 3166-1 numeric country code
        bool    isVerified;  // KYC/AML verification status
        uint256 verifiedAt;  // Timestamp of verification
        string  tier;        // "retail", "accredited", "institutional"
    }

    mapping(address => Identity) private _identities;
    address[] private _registeredInvestors;

    // ============ Smart Contract Registration ============
    // Per T-REX whitepaper: LP/AMM addresses must be registered by the token issuer.

    struct RegisteredContract {
        bool    isRegistered;
        string  contractType;  // "amm", "vault", "lp_token", "treasury", etc.
        uint256 registeredAt;
    }

    mapping(address => RegisteredContract) private _registeredContracts;
    address[] private _contractList;

    // ============ Country Blocking ============

    mapping(uint16 => bool) public blockedCountries;

    // ============ Compliance Operators ============
    // Authorized addresses that can call verifyInvestor() — e.g. KMS compliance operator

    mapping(address => bool) public complianceOperators;

    event ComplianceOperatorAdded(address indexed operator);
    event ComplianceOperatorRemoved(address indexed operator);

    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || complianceOperators[msg.sender],
            "Not authorized: must be owner or compliance operator"
        );
        _;
    }

    function addComplianceOperator(address operator) external onlyOwner {
        require(operator != address(0), "Invalid operator");
        complianceOperators[operator] = true;
        emit ComplianceOperatorAdded(operator);
    }

    function removeComplianceOperator(address operator) external onlyOwner {
        complianceOperators[operator] = false;
        emit ComplianceOperatorRemoved(operator);
    }

    // ============ Events ============

    event IdentityVerified(address indexed investor, uint16 country, string tier);
    event IdentityRevoked(address indexed investor);
    event ContractRegistered(address indexed contractAddress, string contractType);
    event ContractUnregistered(address indexed contractAddress);
    event CountryBlocked(uint16 country);
    event CountryUnblocked(uint16 country);

    constructor() Ownable(msg.sender) {}

    // ============ Demo Mode — Testnet Self-Registration ============

    /**
     * @notice Demo mode allows users to self-register on testnet.
     *
     * In production, verifyInvestor() is called by the token issuer or ATS
     * after completing KYC/AML checks. On testnet, we enable self-registration
     * so faucet users can onboard without a compliance operator.
     *
     * This flag is ONLY enabled on testnet deployments. Never in production.
     */
    bool public demoModeEnabled;

    event DemoModeSet(bool enabled);
    event SelfRegistered(address indexed investor);

    function setDemoMode(bool enabled) external onlyOwner {
        demoModeEnabled = enabled;
        emit DemoModeSet(enabled);
    }

    /**
     * @notice Self-register as a testnet investor (demo mode only).
     * Registers the caller as a US accredited investor in the ATS registry.
     * Only available when demoModeEnabled is true.
     */
    function selfRegister() external {
        require(demoModeEnabled, "Self-registration not available");
        require(msg.sender != address(0), "Invalid caller");

        if (_identities[msg.sender].onchainId == address(0)) {
            _registeredInvestors.push(msg.sender);
        }

        _identities[msg.sender] = Identity({
            onchainId:  msg.sender,
            country:    840,          // US
            isVerified: true,
            verifiedAt: block.timestamp,
            tier:       "accredited"
        });

        emit SelfRegistered(msg.sender);
        emit IdentityVerified(msg.sender, 840, "accredited");
    }

    // ============ Investor Management ============

    /**
     * @notice Register and verify a human investor (simulates ATS KYC completion).
     * @param investor  Wallet address
     * @param country   ISO 3166-1 numeric country code (840 = US, 826 = UK, etc.)
     * @param tier      "retail", "accredited", or "institutional"
     */
    function verifyInvestor(
        address investor,
        uint16 country,
        string calldata tier
    ) external onlyAuthorized {
        require(investor != address(0), "Invalid investor");
        require(!blockedCountries[country], "Country blocked");

        if (_identities[investor].onchainId == address(0)) {
            _registeredInvestors.push(investor);
        }

        _identities[investor] = Identity({
            onchainId:  investor,
            country:    country,
            isVerified: true,
            verifiedAt: block.timestamp,
            tier:       tier
        });

        emit IdentityVerified(investor, country, tier);
    }

    /**
     * @notice Revoke an investor's verified status (sanctions, expired docs, etc.)
     */
    function revokeInvestor(address investor) external onlyOwner {
        require(_identities[investor].isVerified, "Not verified");
        _identities[investor].isVerified = false;
        emit IdentityRevoked(investor);
    }

    // ============ Smart Contract Registration ============

    /**
     * @notice Register an authorized smart contract address in the identity registry.
     *
     * Per the official T-REX whitepaper:
     *   "Liquidity Pool addresses need to be added to the Identity Registry Storage,
     *    giving the Token Issuer and their agent(s) the authority to approve or
     *    reject an exchange pair."
     *
     * This function implements that requirement. The token issuer (owner) registers
     * authorized smart contracts — AMMs, vaults, LP pools — so that ERC-3643 tokens
     * can flow into them. isVerified() returns true for registered contracts.
     *
     * @param contractAddress  The smart contract address to authorize
     * @param contractType     Human-readable type: "amm", "vault", "lp_token", etc.
     */
    function registerContract(
        address contractAddress,
        string calldata contractType
    ) external onlyOwner {
        require(contractAddress != address(0), "Invalid address");
        require(!_registeredContracts[contractAddress].isRegistered, "Already registered");

        _registeredContracts[contractAddress] = RegisteredContract({
            isRegistered:  true,
            contractType:  contractType,
            registeredAt:  block.timestamp
        });
        _contractList.push(contractAddress);

        emit ContractRegistered(contractAddress, contractType);
    }

    /**
     * @notice Unregister a previously authorized smart contract.
     * Used when a contract is deprecated or compromised.
     */
    function unregisterContract(address contractAddress) external onlyOwner {
        require(_registeredContracts[contractAddress].isRegistered, "Not registered");
        _registeredContracts[contractAddress].isRegistered = false;
        emit ContractUnregistered(contractAddress);
    }

    /**
     * @notice Check if a smart contract address is registered (authorized to hold tokens).
     */
    function isRegisteredContract(address contractAddress) external view returns (bool) {
        return _registeredContracts[contractAddress].isRegistered;
    }

    function getContractInfo(address contractAddress) external view returns (
        bool isRegistered,
        string memory contractType,
        uint256 registeredAt
    ) {
        RegisteredContract memory rc = _registeredContracts[contractAddress];
        return (rc.isRegistered, rc.contractType, rc.registeredAt);
    }

    // ============ Country Blocking ============

    function blockCountry(uint16 country) external onlyOwner {
        blockedCountries[country] = true;
        emit CountryBlocked(country);
    }

    function unblockCountry(uint16 country) external onlyOwner {
        blockedCountries[country] = false;
        emit CountryUnblocked(country);
    }

    // ============ IERC3643IdentityRegistry Implementation ============

    /**
     * @notice Returns true if the address is a verified investor OR a registered contract.
     *
     * This is the core check called by RWAToken._update() on every transfer.
     * Both human investors (KYC-verified) and authorized smart contracts (AMM, vault)
     * return true here, per the official T-REX pattern.
     */
    function isVerified(address _userAddress) external view override returns (bool) {
        // Check if it's a registered smart contract (AMM, vault, etc.)
        if (_registeredContracts[_userAddress].isRegistered) {
            return true;
        }
        // Check if it's a KYC-verified human investor
        Identity memory id = _identities[_userAddress];
        return id.isVerified && !blockedCountries[id.country];
    }

    function identity(address _userAddress) external view override returns (address) {
        return _identities[_userAddress].onchainId;
    }

    function investorCountry(address _userAddress) external view override returns (uint16) {
        return _identities[_userAddress].country;
    }

    function contains(address _userAddress) external view override returns (bool) {
        return _identities[_userAddress].onchainId != address(0) ||
               _registeredContracts[_userAddress].isRegistered;
    }

    // ============ View Functions ============

    function getIdentity(address investor) external view returns (
        bool isVerifiedStatus,
        uint16 country,
        string memory tier,
        uint256 verifiedAt
    ) {
        Identity memory id = _identities[investor];
        return (id.isVerified, id.country, id.tier, id.verifiedAt);
    }

    function getRegisteredInvestorCount() external view returns (uint256) {
        return _registeredInvestors.length;
    }

    function getRegisteredContractCount() external view returns (uint256) {
        return _contractList.length;
    }

    // Keep old name for backward compatibility with existing tests
    function getRegisteredCount() external view returns (uint256) {
        return _registeredInvestors.length;
    }
}
