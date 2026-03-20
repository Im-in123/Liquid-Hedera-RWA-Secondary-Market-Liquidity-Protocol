// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IERC3643IdentityRegistry.sol";
import "./interfaces/IERC3643Compliance.sol";

/**
 * @title RWAToken
 * @notice ERC-3643 compliant Real World Asset security token for Liquid Protocol.
 *
 * WHAT THIS IS:
 * A fully compliant ERC-3643 (T-REX) security token that represents a tokenized
 * real-world asset — property, equity fund, bond, etc.
 *
 * This is what Hedera's Asset Tokenization Studio issues for boutique firms.
 * By implementing ERC-3643, every transfer — whether through the AMM,
 * wallet-to-wallet, or any DeFi protocol — is compliance-checked at the
 * TOKEN level before it executes. Compliance cannot be bypassed.
 *
 * HOW IT WORKS:
 * Every transfer calls:
 *   1. _identityRegistry.isVerified(to) — is the recipient KYC-verified?
 *   2. _compliance.canTransfer(from, to, amount) — does the transfer pass all rules?
 * If either returns false, the transfer reverts.
 *
 * INTEGRATION:
 * - _identityRegistry → ATSIdentityRegistry (simulates Hedera ATS)
 * - _compliance → ComplianceRegistry (implements IERC3643Compliance)
 *
 * ERC-20 COMPATIBILITY:
 * Fully ERC-20 compatible. AdaptiveAMM, LiquidityVault, and any other
 * DeFi protocol can interact with this token using standard IERC20 calls.
 * The compliance layer is transparent to the caller.
 *
 * AGENT SYSTEM:
 * Agents (set by owner) can mint, burn, freeze, and forcedTransfer.
 * The deployer is automatically an agent.
 *
 * Reference: https://docs.erc3643.org/erc-3643
 */
contract RWAToken is ERC20, Ownable, ReentrancyGuard {

    // ============ State Variables ============

    /// @notice ERC-3643 identity registry — verifies investor identities
    IERC3643IdentityRegistry private _identityRegistry;

    /// @notice ERC-3643 compliance contract — enforces transfer rules
    IERC3643Compliance private _compliance;

    /// @notice ONCHAINID of this token (token-level identity)
    address private _onchainID;

    /// @notice Token agents — can mint, burn, freeze, forcedTransfer
    mapping(address => bool) private _agents;

    /// @notice Frozen addresses — cannot send or receive
    mapping(address => bool) private _frozen;

    /// @notice Partially frozen token amounts per address
    mapping(address => uint256) private _frozenTokens;

    /// @notice Whether the token is paused (all transfers blocked)
    bool private _paused;

    /// @notice Demo mode — enables faucetMint for testnet demos
    bool public demoModeEnabled;

    /// @notice Max faucet mint per address (1000 tokens, 18 decimals)
    uint256 public constant FAUCET_AMOUNT = 1000 * 10 ** 18;

    /// @notice Track who has already used the faucet
    mapping(address => bool) private _faucetClaimed;

    /// @notice Token version (ERC-3643 requirement)
    string private constant TOKEN_VERSION = "1.0.0";

    /// @notice Real-world asset metadata
    string public assetDescription;
    uint256 public appraisalValue;   // in USDC, 18 decimals
    uint256 public lastAppraisalTime;

    // ============ Events ============

    // ERC-3643 required events
    event UpdatedTokenInformation(
        string indexed newName,
        string indexed newSymbol,
        uint8 newDecimals,
        string newVersion,
        address indexed newOnchainID
    );
    event IdentityRegistryAdded(address indexed identityRegistry);
    event ComplianceAdded(address indexed compliance);
    event RecoverySuccess(address indexed lostWallet, address indexed newWallet, address indexed investorOnchainID);
    event AddressFrozen(address indexed userAddress, bool indexed isFrozen, address indexed owner);
    event TokensFrozen(address indexed userAddress, uint256 amount);
    event TokensUnfrozen(address indexed userAddress, uint256 amount);
    event Paused(address userAddress);
    event Unpaused(address userAddress);
    event AgentAdded(address indexed agent);
    event AgentRemoved(address indexed agent);
    event AppraisalUpdated(uint256 oldValue, uint256 newValue);

    // ============ Modifiers ============

    modifier onlyAgent() {
        require(_agents[msg.sender] || msg.sender == owner(), "Not an agent");
        _;
    }

    modifier whenNotPaused() {
        require(!_paused, "Token is paused");
        _;
    }

    modifier notFrozen(address addr) {
        require(!_frozen[addr], "Address is frozen");
        _;
    }

    // ============ Constructor ============

    /**
     * @param name_              Token name (e.g. "RWA Property Token")
     * @param symbol_            Token symbol (e.g. "RWAPROP")
     * @param description_       Asset description (e.g. "Commercial Property — Austin TX")
     * @param appraisalValue_    Initial real-world valuation in USDC (18 decimals)
     * @param identityRegistry_  ATSIdentityRegistry address
     * @param compliance_        ComplianceRegistry address
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory description_,
        uint256 appraisalValue_,
        address identityRegistry_,
        address compliance_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(identityRegistry_ != address(0), "Invalid identity registry");
        require(compliance_ != address(0), "Invalid compliance");

        assetDescription  = description_;
        appraisalValue    = appraisalValue_;
        lastAppraisalTime = block.timestamp;

        _identityRegistry = IERC3643IdentityRegistry(identityRegistry_);
        _compliance       = IERC3643Compliance(compliance_);
        _onchainID        = address(this); // simplified: token address = onchain ID

        // Register deployer as agent
        _agents[msg.sender] = true;

        // Bind token to compliance contract
        _compliance.bindToken(address(this));

        emit IdentityRegistryAdded(identityRegistry_);
        emit ComplianceAdded(compliance_);
        emit AgentAdded(msg.sender);
        emit UpdatedTokenInformation(name_, symbol_, 18, TOKEN_VERSION, _onchainID);
    }

    // ============ ERC-20 Override — Compliance Enforcement ============

    /**
     * @notice Override ERC-20 transfer to enforce ERC-3643 compliance.
     *
     * Before any transfer executes:
     *   1. Token must not be paused
     *   2. Neither address may be frozen
     *   3. Recipient must be identity-verified (via ATSIdentityRegistry)
     *   4. Transfer must pass compliance rules (via ComplianceRegistry.canTransfer)
     *
     * This means compliance is enforced at the TOKEN level — not just at the AMM.
     * A non-compliant transfer from ANY source will revert here.
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override whenNotPaused {
        // Allow minting (from == address(0)) and burning (to == address(0))
        // without identity checks — agents handle this directly
        if (from != address(0) && to != address(0)) {
            // Neither address may be frozen
            require(!_frozen[from], "Sender address frozen");
            require(!_frozen[to],   "Recipient address frozen");

            // Sender must not have this amount frozen
            require(
                balanceOf(from) - _frozenTokens[from] >= amount,
                "Insufficient unfrozen balance"
            );

            // Recipient must be verified in the identity registry
            require(
                _identityRegistry.isVerified(to),
                "Recipient identity not verified"
            );

            // Compliance check — calls ComplianceRegistry.canTransfer()
            require(
                _compliance.canTransfer(from, to, amount),
                "Transfer not compliant"
            );
        }

        super._update(from, to, amount);

        // Notify compliance contract after transfer
        if (from == address(0)) {
            _compliance.created(to, amount);
        } else if (to == address(0)) {
            _compliance.destroyed(from, amount);
        } else {
            _compliance.transferred(from, to, amount);
        }
    }

    // ============ Agent Functions ============

    /**
     * @notice Mint tokens to a verified address.
     * Only agents can mint. Recipient must be identity-verified.
     */
    function mint(address to, uint256 amount) external onlyAgent {
        require(_identityRegistry.isVerified(to), "Recipient not verified");
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address.
     */
    function burn(address from, uint256 amount) external onlyAgent {
        _burn(from, amount);
    }

    /**
     * @notice Enable or disable demo mode (faucetMint).
     * Only the owner can toggle this.
     */
    function setDemoMode(bool enabled) external onlyOwner {
        demoModeEnabled = enabled;
    }

    /**
     * @notice Faucet mint for testnet demos.
     * Any ATS-verified address can claim FAUCET_AMOUNT once while demo mode is on.
     * Mirrors ATSIdentityRegistry.selfRegister() pattern.
     */
    function faucetMint() external {
        require(demoModeEnabled, "Demo mode not enabled");
        require(!_faucetClaimed[msg.sender], "Already claimed from faucet");
        require(_identityRegistry.isVerified(msg.sender), "Must be identity verified first");
        _faucetClaimed[msg.sender] = true;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Force a transfer between two addresses (regulatory override).
     *
     * Per the official ERC-3643 EIP specification:
     *   "the mint function and the forcedTransfer function only require the
     *    receiver to [be verified in the identity registry]"
     *
     * forcedTransfer bypasses the compliance contract check (canTransfer) but
     * still requires the recipient to be registered in the identity registry.
     * This is the correct official behaviour — not a shortcut.
     *
     * Use cases: court orders, sanctions enforcement, estate recovery, regulatory action.
     * Only agents can call this function.
     */
    function forcedTransfer(
        address from,
        address to,
        uint256 amount
    ) external onlyAgent nonReentrant returns (bool) {
        require(_identityRegistry.isVerified(to), "ERC-3643: Recipient not verified");
        require(balanceOf(from) >= amount, "ERC-3643: Insufficient balance");

        uint256 freeBalance = balanceOf(from) - _frozenTokens[from];
        if (amount > freeBalance) {
            uint256 toUnfreeze = amount - freeBalance;
            _frozenTokens[from] -= toUnfreeze;
            emit TokensUnfrozen(from, toUnfreeze);
        }

        // Bypass compliance check — call ERC-20 _update directly
        // This is the official ERC-3643 pattern for forcedTransfer
        super._update(from, to, amount);
        _compliance.transferred(from, to, amount);

        emit RecoverySuccess(from, to, _onchainID);
        return true;
    }

    /**
     * @notice Recover tokens from a lost wallet to a new wallet.
     *
     * Per official ERC-3643: recovery requires receiver to be identity-verified.
     * Compliance rules are bypassed — this is a regulatory/agent action.
     */
    function recoveryAddress(
        address lostWallet,
        address newWallet,
        address investorOnchainID
    ) external onlyAgent returns (bool) {
        require(_identityRegistry.isVerified(newWallet), "ERC-3643: New wallet not verified");
        uint256 bal = balanceOf(lostWallet);
        super._update(lostWallet, newWallet, bal);
        _compliance.transferred(lostWallet, newWallet, bal);
        emit RecoverySuccess(lostWallet, newWallet, investorOnchainID);
        return true;
    }

    // ============ Pause / Freeze ============

    function pause() external onlyAgent {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAgent {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function setAddressFrozen(address userAddress, bool freeze) external onlyAgent {
        _frozen[userAddress] = freeze;
        emit AddressFrozen(userAddress, freeze, msg.sender);
    }

    function freezePartialTokens(address userAddress, uint256 amount) external onlyAgent {
        require(balanceOf(userAddress) >= _frozenTokens[userAddress] + amount, "Exceeds balance");
        _frozenTokens[userAddress] += amount;
        emit TokensFrozen(userAddress, amount);
    }

    function unfreezePartialTokens(address userAddress, uint256 amount) external onlyAgent {
        require(_frozenTokens[userAddress] >= amount, "Insufficient frozen");
        _frozenTokens[userAddress] -= amount;
        emit TokensUnfrozen(userAddress, amount);
    }

    // ============ Admin ============

    function setIdentityRegistry(address _newIdentityRegistry) external onlyOwner {
        require(_newIdentityRegistry != address(0), "Invalid registry");
        _identityRegistry = IERC3643IdentityRegistry(_newIdentityRegistry);
        emit IdentityRegistryAdded(_newIdentityRegistry);
    }

    function setCompliance(address _newCompliance) external onlyOwner {
        require(_newCompliance != address(0), "Invalid compliance");
        _compliance.unbindToken(address(this));
        _compliance = IERC3643Compliance(_newCompliance);
        _compliance.bindToken(address(this));
        emit ComplianceAdded(_newCompliance);
    }

    function setOnchainID(address _newOnchainID) external onlyOwner {
        _onchainID = _newOnchainID;
        emit UpdatedTokenInformation(name(), symbol(), 18, TOKEN_VERSION, _newOnchainID);
    }

    function addAgent(address agent) external onlyOwner {
        require(agent != address(0), "Invalid agent");
        _agents[agent] = true;
        emit AgentAdded(agent);
    }

    function removeAgent(address agent) external onlyOwner {
        _agents[agent] = false;
        emit AgentRemoved(agent);
    }

    /**
     * @notice Update real-world appraisal value.
     * In production this would be called by a trusted oracle or the issuer.
     */
    function updateAppraisal(uint256 newAppraisal) external onlyOwner {
        require(newAppraisal > 0, "Invalid appraisal");
        uint256 old = appraisalValue;
        appraisalValue    = newAppraisal;
        lastAppraisalTime = block.timestamp;
        emit AppraisalUpdated(old, newAppraisal);
    }

    // ============ Batch Functions ============

    function batchMint(address[] calldata toList, uint256[] calldata amounts) external onlyAgent {
        require(toList.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < toList.length; i++) {
            require(_identityRegistry.isVerified(toList[i]), "Recipient not verified");
            _mint(toList[i], amounts[i]);
        }
    }

    function batchBurn(address[] calldata addresses, uint256[] calldata amounts) external onlyAgent {
        require(addresses.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < addresses.length; i++) {
            _burn(addresses[i], amounts[i]);
        }
    }

    function batchTransfer(address[] calldata toList, uint256[] calldata amounts) external {
        require(toList.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < toList.length; i++) {
            transfer(toList[i], amounts[i]);
        }
    }

    function batchSetAddressFrozen(address[] calldata addresses, bool[] calldata freeze) external onlyAgent {
        require(addresses.length == freeze.length, "Length mismatch");
        for (uint256 i = 0; i < addresses.length; i++) {
            _frozen[addresses[i]] = freeze[i];
            emit AddressFrozen(addresses[i], freeze[i], msg.sender);
        }
    }

    // ============ View Functions ============

    function identityRegistry() external view returns (address) {
        return address(_identityRegistry);
    }

    function compliance() external view returns (address) {
        return address(_compliance);
    }

    function onchainID() external view returns (address) {
        return _onchainID;
    }

    function version() external pure returns (string memory) {
        return TOKEN_VERSION;
    }

    function isAgent(address agent) external view returns (bool) {
        return _agents[agent] || agent == owner();
    }

    function isFrozen(address userAddress) external view returns (bool) {
        return _frozen[userAddress];
    }

    function getFrozenTokens(address userAddress) external view returns (uint256) {
        return _frozenTokens[userAddress];
    }

    function paused() external view returns (bool) {
        return _paused;
    }
}
