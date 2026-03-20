// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IERC3643Compliance
 * @notice ERC-3643 (T-REX) compliance contract interface
 *
 * Every ERC-3643 token holds a reference to a compliance contract that
 * implements this interface. The token calls canTransfer() before every
 * transfer, and calls transferred/created/destroyed to keep state in sync.
 *
 * Reference: https://docs.erc3643.org/erc-3643/smart-contracts-library/compliance-management/compliance-interface
 */
interface IERC3643Compliance {

    event TokenBound(address indexed _token);
    event TokenUnbound(address indexed _token);

    /**
     * @notice Bind a token to this compliance contract.
     * Called by the token contract during initialisation.
     */
    function bindToken(address _token) external;

    /**
     * @notice Unbind a token from this compliance contract.
     */
    function unbindToken(address _token) external;

    /**
     * @notice Hook called after every token transfer.
     * Can update internal counters/state used by canTransfer.
     */
    function transferred(address _from, address _to, uint256 _amount) external;

    /**
     * @notice Hook called after tokens are minted.
     */
    function created(address _to, uint256 _amount) external;

    /**
     * @notice Hook called after tokens are burned.
     */
    function destroyed(address _from, uint256 _amount) external;

    /**
     * @notice Check if a transfer is compliant. READ-ONLY — no state changes.
     * @return true if transfer is allowed
     */
    function canTransfer(address _from, address _to, uint256 _amount) external view returns (bool);

    /**
     * @notice Check if an address is a registered token agent.
     */
    function isTokenAgent(address _agentAddress) external view returns (bool);

    /**
     * @notice Check if a token is bound to this compliance contract.
     */
    function isTokenBound(address _token) external view returns (bool);
}
