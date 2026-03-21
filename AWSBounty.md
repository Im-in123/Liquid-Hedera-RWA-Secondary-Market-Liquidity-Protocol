[Hedera Hello Future Apex Hackathon 2026] Bounty Submission Form

Which bounty are you submitting for?*
AWS

Problem Statement Details*

Solution:
Liquid Protocol is a compliance-aware RWA secondary market — with trading, liquidity provision, and staking on Hedera. The compliance operator — responsible for KYC whitelisting, identity registry updates, and HCS audit logging — is backed entirely by AWS KMS.  

How it uses AWS KMS:
A Vercel serverless function (/api/whitelist.js) acts as the sole compliance operator. On every KYC request, it fetches the secp256k1 public key from KMS via GetPublicKeyCommand and derives the EVM operator address on the fly. EVM transactions are signed via SignCommand with ECDSA_SHA_256 — the DER-encoded signature is parsed, low-s is enforced (EIP-2), and the correct v value is recovered. Native Hedera HCS messages are signed via the same KMS key using the raw r || s format required by the Hedera SDK. The TreasuryManager contract records the KMS signature hash on-chain on every withdrawal execution, creating a verifiable on-chain link to CloudTrail. Every operation is automatically logged to AWS CloudTrail.

Why it matters:
RWA compliance operators are high-value targets — they control who can hold and transfer regulated assets. Storing that key in an .env file is a critical security failure. AWS KMS eliminates that risk entirely: the key never leaves KMS, access is controlled via IAM, and every signing operation has a CloudTrail audit record.

Setup instructions:
Live demo at [[VERCEL_URL](https://liquid-hedera-rwa-secondary-market.vercel.app/)]. Connect HashPack wallet → visit /compliance → submit KYC → KMS signs the whitelisting transactions for both identity registries simultaneously. All KMS-signed HCS events visible on /audit.

Solution Demo Link*
[[VERCEL_URL](https://liquid-hedera-rwa-secondary-market.vercel.app/)]

Github Repository Link (with commits made during the hackathon)*
[GITHUB_REPO_URL]

User Experience Feedback*
The AWS KMS setup was smooth and well-documented. 

Provide proof of an on-chain transaction by indicating one Hedera testnet on-chain account.*
0.0.8290378

What is your Discord handle?*
[DISCORD_HANDLE]

Please share the link to your LinkedIn profile.*
[LINKEDIN_URL]

If you participate in this bounty, the bounty partner may contact you for necessary communications. Please tick the box below to acknowledge.*
✅ Acknowledged

Save and Continue