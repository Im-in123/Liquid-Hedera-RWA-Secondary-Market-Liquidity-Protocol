// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title IERC3643IdentityRegistry
 * @notice Interface for ERC-3643 (T-REX) identity registry
 *
 * ERC-3643 is the standard used by Hedera's Asset Tokenization Studio (ATS)
 * for compliant security token issuance. Every ATS-issued token has an
 * associated IdentityRegistry that tracks verified investor identities.
 *
 * By implementing this interface, Liquid's ComplianceRegistry can read
 * KYC status directly from any ATS-issued token's identity registry,
 * enabling seamless single-KYC across the Hedera RWA ecosystem.
 *
 * Flow:
 *   Boutique firm tokenizes asset on ATS
 *   → investors complete KYC in ATS identity registry
 *   → they can immediately trade on Liquid without re-doing KYC
 *
 * Reference: https://eips.ethereum.org/EIPS/eip-3643
 */
interface IERC3643IdentityRegistry {
    /**
     * @notice Check if an investor address has a verified identity
     * @param _userAddress The investor's wallet address
     * @return true if the identity is verified and eligible to hold tokens
     */
    function isVerified(address _userAddress) external view returns (bool);

    /**
     * @notice Get the identity (ONCHAINID) for an investor
     * @param _userAddress The investor's wallet address
     * @return The ONCHAINID contract address for this investor
     */
    function identity(address _userAddress) external view returns (address);

    /**
     * @notice Get the country code for an investor (ISO 3166-1 numeric)
     * @param _userAddress The investor's wallet address
     * @return The numeric country code
     */
    function investorCountry(address _userAddress) external view returns (uint16);

    /**
     * @notice Check if investor is registered in this registry
     * @param _userAddress The investor's wallet address
     * @return true if registered (may or may not be verified)
     */
    function contains(address _userAddress) external view returns (bool);
}
