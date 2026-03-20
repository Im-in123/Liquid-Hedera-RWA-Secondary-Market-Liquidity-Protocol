// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TreasuryManager
 * @notice Secure treasury management with multi-sig and AWS KMS integration
 * @dev This contract manages protocol treasury funds with enterprise-grade security
 * 
 * AWS BOUNTY INTEGRATION:
 * - Multi-signature withdrawal requirements
 * - AWS KMS key management (off-chain signing)
 * - Audit trail on Hedera Consensus Service
 * - Time-locked withdrawals for security
 * 
 * Security Features:
 * - Role-based access control
 * - Multi-sig approval for large withdrawals
 * - Time delays for security
 * - Emergency pause mechanism
 * - Complete audit trail
 */
contract TreasuryManager is AccessControl, ReentrancyGuard {
    
    // ============ Roles ============
    
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    bytes32 public constant APPROVER_ROLE = keccak256("APPROVER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // ============ State Variables ============
    
    struct WithdrawalRequest {
        address token;               // Token to withdraw (address(0) for native)
        address recipient;           // Recipient address
        uint256 amount;              // Amount to withdraw
        uint256 requestTime;         // When request was created
        uint256 executeAfter;        // Earliest execution time (timelock)
        uint256 approvalCount;       // Number of approvals
        bool executed;               // Whether executed
        bool cancelled;              // Whether cancelled
        mapping(address => bool) approvals; // Approver => approved
        string reason;               // Reason for withdrawal
        bytes32 kmsSignature;        // AWS KMS signature hash (for audit)
    }
    
    // Withdrawal request ID => Request
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    
    // Current withdrawal request ID
    uint256 public nextRequestId;
    
    // Minimum approvals required for withdrawal
    uint256 public requiredApprovals;
    
    // Timelock duration (in seconds)
    uint256 public timelockDuration;
    
    // Maximum single withdrawal amount (per token)
    mapping(address => uint256) public withdrawalLimits;
    
    // Emergency pause state
    bool public paused;
    
    // Total deposited per token (for accounting)
    mapping(address => uint256) public totalDeposited;
    
    // Total withdrawn per token (for accounting)
    mapping(address => uint256) public totalWithdrawn;
    
    // ============ Events ============
    
    event Deposited(
        address indexed token,
        address indexed from,
        uint256 amount,
        uint256 timestamp
    );
    
    event WithdrawalRequested(
        uint256 indexed requestId,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        string reason
    );
    
    event WithdrawalApproved(
        uint256 indexed requestId,
        address indexed approver,
        uint256 approvalCount
    );
    
    event WithdrawalExecuted(
        uint256 indexed requestId,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        bytes32 kmsSignature
    );
    
    event WithdrawalCancelled(
        uint256 indexed requestId,
        address indexed cancelledBy
    );
    
    event RequiredApprovalsUpdated(uint256 oldValue, uint256 newValue);
    event TimelockDurationUpdated(uint256 oldValue, uint256 newValue);
    event WithdrawalLimitUpdated(address indexed token, uint256 newLimit);
    event EmergencyPauseToggled(bool isPaused);
    event KMSSignatureRecorded(uint256 indexed requestId, bytes32 signatureHash);
    
    // ============ Modifiers ============
    
    modifier notPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    modifier onlyEmergency() {
        require(hasRole(EMERGENCY_ROLE, msg.sender), "Not emergency role");
        _;
    }
    
    // ============ Constructor ============
    
    constructor(
        uint256 _requiredApprovals,
        uint256 _timelockDuration
    ) {
        require(_requiredApprovals > 0, "Invalid approval count");
        require(_timelockDuration > 0, "Invalid timelock");
        
        requiredApprovals = _requiredApprovals;
        timelockDuration = _timelockDuration;
        
        // Grant roles to deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(TREASURER_ROLE, msg.sender);
        _grantRole(APPROVER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
    }
    
    // ============ Deposit Functions ============
    
    /**
     * @notice Deposit tokens into treasury
     * @param token Token address (address(0) for native HBAR)
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) external payable nonReentrant notPaused {
        require(amount > 0, "Cannot deposit 0");
        
        if (token == address(0)) {
            // Native token (HBAR)
            require(msg.value == amount, "Incorrect value sent");
        } else {
            // ERC20 token
            require(msg.value == 0, "Do not send native with token");
            IERC20(token).transferFrom(msg.sender, address(this), amount);
        }
        
        totalDeposited[token] += amount;
        
        emit Deposited(token, msg.sender, amount, block.timestamp);
    }
    
    // ============ Withdrawal Functions ============
    
    /**
     * @notice Request a withdrawal from treasury (requires multi-sig approval)
     * @param token Token address to withdraw
     * @param recipient Recipient address
     * @param amount Amount to withdraw
     * @param reason Reason for withdrawal (for audit trail)
     */
    function requestWithdrawal(
        address token,
        address recipient,
        uint256 amount,
        string calldata reason
    ) external onlyRole(TREASURER_ROLE) notPaused returns (uint256 requestId) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Cannot withdraw 0");
        require(bytes(reason).length > 0, "Reason required");
        
        // Check withdrawal limit
        if (withdrawalLimits[token] > 0) {
            require(amount <= withdrawalLimits[token], "Exceeds withdrawal limit");
        }
        
        // Check sufficient balance
        uint256 balance = token == address(0) 
            ? address(this).balance 
            : IERC20(token).balanceOf(address(this));
        require(balance >= amount, "Insufficient treasury balance");
        
        requestId = nextRequestId++;
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        
        request.token = token;
        request.recipient = recipient;
        request.amount = amount;
        request.requestTime = block.timestamp;
        request.executeAfter = block.timestamp + timelockDuration;
        request.reason = reason;
        
        emit WithdrawalRequested(requestId, token, recipient, amount, reason);
    }
    
    /**
     * @notice Approve a withdrawal request
     * @param requestId Withdrawal request ID
     */
    function approveWithdrawal(uint256 requestId) external onlyRole(APPROVER_ROLE) notPaused {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        
        require(!request.executed, "Already executed");
        require(!request.cancelled, "Request cancelled");
        require(!request.approvals[msg.sender], "Already approved");
        require(request.requestTime > 0, "Request does not exist");
        
        request.approvals[msg.sender] = true;
        request.approvalCount++;
        
        emit WithdrawalApproved(requestId, msg.sender, request.approvalCount);
    }
    
    /**
     * @notice Execute withdrawal after timelock and sufficient approvals
     * @param requestId Withdrawal request ID
     * @param kmsSignature AWS KMS signature hash (for audit trail)
     * 
     * NOTE: In production, this would verify the KMS signature off-chain
     * and only execute if signature is valid. For hackathon demo, we
     * record the signature hash for audit purposes.
     */
    function executeWithdrawal(
        uint256 requestId,
        bytes32 kmsSignature
    ) external onlyRole(TREASURER_ROLE) nonReentrant notPaused {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        
        require(!request.executed, "Already executed");
        require(!request.cancelled, "Request cancelled");
        require(request.approvalCount >= requiredApprovals, "Insufficient approvals");
        require(block.timestamp >= request.executeAfter, "Timelock not expired");
        require(kmsSignature != bytes32(0), "Invalid KMS signature");
        
        request.executed = true;
        request.kmsSignature = kmsSignature;
        
        totalWithdrawn[request.token] += request.amount;
        
        // Execute transfer
        if (request.token == address(0)) {
            // Native token
            (bool success, ) = request.recipient.call{value: request.amount}("");
            require(success, "Transfer failed");
        } else {
            // ERC20 token
            IERC20(request.token).transfer(request.recipient, request.amount);
        }
        
        emit WithdrawalExecuted(requestId, request.token, request.recipient, request.amount, kmsSignature);
        emit KMSSignatureRecorded(requestId, kmsSignature);
    }
    
    /**
     * @notice Cancel a withdrawal request
     * @param requestId Withdrawal request ID
     */
    function cancelWithdrawal(uint256 requestId) external {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        
        require(!request.executed, "Already executed");
        require(!request.cancelled, "Already cancelled");
        require(
            hasRole(TREASURER_ROLE, msg.sender) || hasRole(EMERGENCY_ROLE, msg.sender),
            "Not authorized"
        );
        
        request.cancelled = true;
        
        emit WithdrawalCancelled(requestId, msg.sender);
    }
    
    // ============ Admin Functions ============
    
    function setRequiredApprovals(uint256 newRequired) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRequired > 0, "Must require at least 1 approval");
        
        uint256 oldValue = requiredApprovals;
        requiredApprovals = newRequired;
        
        emit RequiredApprovalsUpdated(oldValue, newRequired);
    }
    
    function setTimelockDuration(uint256 newDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDuration > 0, "Invalid duration");
        
        uint256 oldValue = timelockDuration;
        timelockDuration = newDuration;
        
        emit TimelockDurationUpdated(oldValue, newDuration);
    }
    
    function setWithdrawalLimit(
        address token,
        uint256 limit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        withdrawalLimits[token] = limit;
        emit WithdrawalLimitUpdated(token, limit);
    }
    
    function togglePause() external onlyEmergency {
        paused = !paused;
        emit EmergencyPauseToggled(paused);
    }
    
    // ============ View Functions ============
    
    function getWithdrawalRequest(uint256 requestId) external view returns (
        address token,
        address recipient,
        uint256 amount,
        uint256 requestTime,
        uint256 executeAfter,
        uint256 approvalCount,
        bool executed,
        bool cancelled,
        string memory reason
    ) {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        return (
            request.token,
            request.recipient,
            request.amount,
            request.requestTime,
            request.executeAfter,
            request.approvalCount,
            request.executed,
            request.cancelled,
            request.reason
        );
    }
    
    function hasApproved(uint256 requestId, address approver) external view returns (bool) {
        return withdrawalRequests[requestId].approvals[approver];
    }
    
    function getTreasuryBalance(address token) external view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }
    
    function getAccountingInfo(address token) external view returns (
        uint256 deposited,
        uint256 withdrawn,
        uint256 currentBalance
    ) {
        currentBalance = token == address(0) 
            ? address(this).balance 
            : IERC20(token).balanceOf(address(this));
        
        return (
            totalDeposited[token],
            totalWithdrawn[token],
            currentBalance
        );
    }
    
    // ============ Receive Function ============
    
    receive() external payable {
        totalDeposited[address(0)] += msg.value;
        emit Deposited(address(0), msg.sender, msg.value, block.timestamp);
    }
}
