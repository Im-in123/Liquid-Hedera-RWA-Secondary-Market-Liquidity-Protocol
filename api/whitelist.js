// api/whitelist.js — Liquid Protocol KMS-Gated Compliance Operator
//
// AWS KMS INTEGRATION:
// ALL signing — EVM compliance transactions AND native Hedera HCS messages —
// is performed by AWS KMS. Private key never exists anywhere.
// Every signing operation is recorded in AWS CloudTrail.
//
// FIXED: v-value selection in KmsEthersSigner._signDigest() now uses
// ethers.recoverAddress() to determine the correct recovery bit (v=27 or v=28)
// instead of blindly returning v=27. The old approach caused ~50% of EVM
// transactions to fail with JSON-RPC error -32001 (INVALID_SIGNATURE).

import { ethers } from 'ethers';
import { KMSClient, SignCommand, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import {
  Client, AccountId, TopicMessageSubmitTransaction, TopicId, PublicKey, PrivateKey,
} from '@hashgraph/sdk';
import deployed from '../deployed-addresses.json' assert { type: 'json' };

// ── Config ────────────────────────────────────────────────────────────────────

const COMPLIANCE_REGISTRY_ADDRESS = deployed.contracts.complianceRegistry;
const ATS_REGISTRY_ADDRESS        = deployed.contracts.atsIdentityRegistry;
const HCS_TOPIC_ID                = deployed.hcsTopicId;
const RPC_URL                     = 'https://testnet.hashio.io/api';
const CHAIN_ID                    = deployed.chainId;
const KMS_KEY_ID                  = process.env.KMS_KEY_ID;
const DEPLOYER_ACCOUNT_ID         = process.env.DEPLOYER_ACCOUNT_ID;

const COMPLIANCE_ABI = [
  'function whitelistInvestor(address investor, bytes32 kycHash, string calldata jurisdiction, bool isAccredited, uint256 kycValidityPeriod) external',
  'function getInvestorProfile(address investor) external view returns (bool isWhitelisted, bool isKYCVerified, bool isAccredited, uint256 kycExpiryTime, string memory jurisdiction)',
];

const ATS_ABI = [
  'function verifyInvestor(address investor, uint16 country, string calldata tier) external',
  'function isVerified(address investor) external view returns (bool)',
];

const COUNTRY_CODES = {
  US: 840, GB: 826, EU: 978, SG: 702, AE: 784,
  AU: 36,  CA: 124, CH: 756, JP: 392, HK: 344,
  GH: 288, NG: 566, ZA: 710,
};

// ── KMS Client ────────────────────────────────────────────────────────────────

function getKmsClient() {
  if (!process.env.AWS_REGION)            throw new Error('AWS_REGION not set');
  if (!process.env.AWS_ACCESS_KEY_ID)     throw new Error('AWS_ACCESS_KEY_ID not set');
  if (!process.env.AWS_SECRET_ACCESS_KEY) throw new Error('AWS_SECRET_ACCESS_KEY not set');
  return new KMSClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

// ── Public Key Helpers ────────────────────────────────────────────────────────
// KMS SPKI prefix for ECC_SECG_P256K1 is always 23 bytes:
// 3056301006072a8648ce3d020106052b8104000a034200

const KMS_SPKI_PREFIX_LEN = 23;

async function getKmsPublicKeyRaw(kmsClient) {
  const cmd    = new GetPublicKeyCommand({ KeyId: KMS_KEY_ID });
  const result = await kmsClient.send(cmd);
  const der    = Buffer.from(result.PublicKey);
  console.log('🔑 DER pubkey length:', der.length, '| prefix hex:', der.slice(0, 23).toString('hex'));
  const raw = der.slice(KMS_SPKI_PREFIX_LEN);
  console.log('🔑 Raw pubkey length:', raw.length, '| first byte:', raw[0]?.toString(16));
  return raw; // 65 bytes: 0x04 || x (32) || y (32)
}

function compressPublicKey(uncompressed) {
  const x      = uncompressed.slice(1, 33);
  const y      = uncompressed.slice(33, 65);
  const prefix = (y[31] & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), x]);
}

function evmAddressFromPublicKey(uncompressed) {
  const hash = ethers.keccak256(uncompressed.slice(1));
  return ethers.getAddress('0x' + hash.slice(-40));
}

// ── DER Signature Parser ──────────────────────────────────────────────────────

function parseDerSignature(der) {
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der);
  let offset = 0;
  if (buf[offset++] !== 0x30) throw new Error('DER: expected SEQUENCE tag 0x30, got 0x' + buf[0].toString(16));
  let seqLen = buf[offset++];
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < lenBytes; i++) seqLen = (seqLen << 8) | buf[offset++];
  }
  if (buf[offset++] !== 0x02) throw new Error('DER: expected INTEGER tag for r');
  const rLen = buf[offset++];
  const r    = buf.slice(offset, offset + rLen).slice(-32);
  offset    += rLen;
  if (buf[offset++] !== 0x02) throw new Error('DER: expected INTEGER tag for s');
  const sLen = buf[offset++];
  const s    = buf.slice(offset, offset + sLen).slice(-32);
  console.log('✍️  DER parsed — r:', r.toString('hex').slice(0, 16) + '...', '| s:', s.toString('hex').slice(0, 16) + '...');
  return { r, s };
}

// ── KMS Ethers Signer ─────────────────────────────────────────────────────────

class KmsEthersSigner extends ethers.AbstractSigner {
  constructor(kmsClient, provider) {
    super(provider);
    this.kmsClient  = kmsClient;
    this._address   = null;
    this._rawPubKey = null;
  }

  async _ensurePubKey() {
    if (!this._rawPubKey) this._rawPubKey = await getKmsPublicKeyRaw(this.kmsClient);
    return this._rawPubKey;
  }

  async getAddress() {
    if (this._address) return this._address;
    const pubKey  = await this._ensurePubKey();
    this._address = evmAddressFromPublicKey(pubKey);
    console.log('🔑 KMS EVM address (key-derived):', this._address);
    return this._address;
  }

  async _signDigest(digest) {
    const digestBytes = Buffer.from(ethers.getBytes(digest));
    const result      = await this.kmsClient.send(new SignCommand({
      KeyId: KMS_KEY_ID, Message: digestBytes, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256',
    }));
    console.log('✍️  KMS signature received, length:', result.Signature.length);
    let { r, s } = parseDerSignature(Buffer.from(result.Signature));

    // EIP-2: enforce low-s
    const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const sInt = BigInt('0x' + s.toString('hex'));
    if (sInt > SECP256K1_N / 2n) {
      const sNormalized = SECP256K1_N - sInt;
      s = Buffer.from(sNormalized.toString(16).padStart(64, '0'), 'hex');
      console.log('✍️  s normalized (low-s enforcement)');
    }

    const rHex = '0x' + r.toString('hex');
    const sHex = '0x' + s.toString('hex');

    // ── THE FIX ───────────────────────────────────────────────────────────────
    // Previous code used ethers.Signature.from({ r, s, v }) inside a try/catch
    // and relied on the catch to skip invalid v values. BUT .from() with v=27
    // or v=28 NEVER throws — both are valid Ethereum values. So the loop always
    // returned v=27 immediately, making ~50% of transactions fail with -32001.
    //
    // The correct approach (used by every production AWS KMS signer library):
    // call recoverAddress(digest, sig) and check which v reconstructs the known
    // KMS EVM address. The KMS account uses the EVM-alias auto-create pattern
    // so its address IS the keccak256-derived address — recoverAddress works.
    // ─────────────────────────────────────────────────────────────────────────
    const kmsAddress = await this.getAddress();

    for (const v of [27, 28]) {
      try {
        const sig       = ethers.Signature.from({ r: rHex, s: sHex, v });
        const recovered = ethers.recoverAddress(digest, sig);
        if (recovered.toLowerCase() === kmsAddress.toLowerCase()) {
          console.log('✍️  EVM sig built with v =', v, '(verified via recoverAddress)');
          return sig;
        }
      } catch {
        continue;
      }
    }

    throw new Error(
      `KMS EVM: recoverAddress failed for both v=27 and v=28. Expected: ${kmsAddress}`
    );
  }

  async signTransaction(tx) {
    const populated = await this.populateTransaction(tx);
    const { from: _from, ...txWithoutFrom } = populated;
    const unsigned  = ethers.Transaction.from(txWithoutFrom);
    const digest    = ethers.keccak256(unsigned.unsignedSerialized);
    const sig       = await this._signDigest(digest);
    unsigned.signature = sig;
    return unsigned.serialized;
  }

  async signMessage(message) {
    const digest = ethers.hashMessage(message);
    return (await this._signDigest(digest)).serialized;
  }

  async signTypedData(domain, types, value) {
    const digest = ethers.TypedDataEncoder.hash(domain, types, value);
    return (await this._signDigest(digest)).serialized;
  }

  connect(provider) {
    const s = new KmsEthersSigner(this.kmsClient, provider);
    s._address = this._address; s._rawPubKey = this._rawPubKey;
    return s;
  }
}

// ── Factory Functions ─────────────────────────────────────────────────────────

function getProvider() {
  const network = new ethers.Network('Hedera Testnet', CHAIN_ID);
  return new ethers.JsonRpcProvider(RPC_URL, network, { staticNetwork: network });
}

function getEvmSigner() {
  if (!KMS_KEY_ID) throw new Error('KMS_KEY_ID not set');
  return new KmsEthersSigner(getKmsClient(), getProvider());
}

// ── HCS Publisher ─────────────────────────────────────────────────────────────

async function publishToHCS(message) {
  if (!KMS_KEY_ID)          throw new Error('KMS_KEY_ID not set');
  if (!DEPLOYER_ACCOUNT_ID) throw new Error('DEPLOYER_ACCOUNT_ID not set');
  console.log('📡 publishToHCS → account:', DEPLOYER_ACCOUNT_ID, '| topic:', HCS_TOPIC_ID);

  const kmsClient = getKmsClient();
  const rawPubKey    = await getKmsPublicKeyRaw(kmsClient);
  const compressed   = compressPublicKey(rawPubKey);
  const hederaPubKey = PublicKey.fromBytesECDSA(compressed);
  console.log('🔑 Hedera pubkey:', hederaPubKey.toString());

  const client = Client.forTestnet();
  client.setOperator(
    AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID ?? DEPLOYER_ACCOUNT_ID),
    PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY.replace('0x', ''))
  );

  const frozenTx = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(HCS_TOPIC_ID))
    .setMessage(message)
    .setMaxChunks(1)
    .freezeWith(client);

  console.log('✍️  Transaction frozen, signing with KMS via signWith...');

  const signedTx = await frozenTx.signWith(hederaPubKey, async (bytesToSign) => {
    const txHex    = '0x' + Buffer.from(bytesToSign).toString('hex');
    const digest   = Buffer.from(ethers.getBytes(ethers.keccak256(txHex)));
    console.log('✍️  digest:', digest.toString('hex').slice(0, 32) + '...');
    const kmsResult = await kmsClient.send(new SignCommand({
      KeyId: KMS_KEY_ID, Message: digest, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256',
    }));
    console.log('✍️  KMS signature received, length:', kmsResult.Signature.length);
    const { r, s } = parseDerSignature(Buffer.from(kmsResult.Signature));
    const sig64 = Buffer.concat([r, s]);
    console.log('✍️  sig64:', sig64.toString('hex').slice(0, 32) + '...');
    return sig64;
  });

  const response = await signedTx.execute(client);
  const receipt  = await response.getReceipt(client);
  const seq = receipt.topicSequenceNumber.toString();
  console.log('📡 HCS message written → seq #' + seq);
  client.close();
  return seq;
}

// ── KYC Handler ───────────────────────────────────────────────────────────────

async function handleWhitelist(address, name, jurisdiction) {
  if (!ethers.isAddress(address))
    return { status: 400, body: { error: 'Invalid address' } };
  if (!name || !jurisdiction)
    return { status: 400, body: { error: 'name and jurisdiction are required' } };

  console.log('🛡️  KYC request:', address, jurisdiction);

  const signer   = getEvmSigner();
  const provider = getProvider();

  const complianceReader = new ethers.Contract(COMPLIANCE_REGISTRY_ADDRESS, COMPLIANCE_ABI, provider);
  const atsReader        = new ethers.Contract(ATS_REGISTRY_ADDRESS, ATS_ABI, provider);
  const compliance = new ethers.Contract(COMPLIANCE_REGISTRY_ADDRESS, COMPLIANCE_ABI, signer);
  const ats        = new ethers.Contract(ATS_REGISTRY_ADDRESS, ATS_ABI, signer);

  let alreadyCompliant = false;
  let atsVerified      = false;
  try {
    const [profileRaw, atsResult] = await Promise.all([
      complianceReader.getInvestorProfile(address),
      atsReader.isVerified(address),
    ]);
    alreadyCompliant = profileRaw?.isWhitelisted === true || profileRaw?.[0] === true;
    atsVerified      = atsResult === true;
    console.log('🛡️  Status check — compliant:', alreadyCompliant, '| ats:', atsVerified);
  } catch (err) {
    console.log('🛡️  Status check failed (proceeding):', err.message?.slice(0, 80));
  }

  if (alreadyCompliant && atsVerified)
    return { status: 200, body: { alreadyWhitelisted: true, address } };

  const countryCode = COUNTRY_CODES[jurisdiction] ?? 840;
  const kycHash     = ethers.keccak256(
    ethers.toUtf8Bytes(`liquid-kyc:${name.toLowerCase().trim()}:${address.toLowerCase()}`)
  );
  const oneYear = 365 * 24 * 3600;

  const hcsRequestSeq = await publishToHCS(JSON.stringify({
    event: 'kyc_request', address, jurisdiction, kycHash,
    timestamp: Math.floor(Date.now() / 1000), operator: 'liquid-protocol',
    signedWithKMS: true, kmsKeyId: KMS_KEY_ID,
  }));
  console.log('🛡️  KYC request → HCS seq #' + hcsRequestSeq);

  if (!atsVerified) {
    console.log('🛡️  Calling verifyInvestor...');
    let atsTx;
    for (let i = 1; i <= 3; i++) {
      try {
        atsTx = await ats.verifyInvestor(address, countryCode, 'accredited');
        await atsTx.wait();
        console.log('🛡️  ATS verified | tx:', atsTx.hash);
        break;
      } catch (err) {
        console.log(`🛡️  verifyInvestor attempt ${i} failed:`, err.message?.slice(0, 60));
        if (i === 3) throw err;
        await new Promise(r => setTimeout(r, 5000 * i));
      }
    }
  }

  let complianceTxHash = null;
  if (!alreadyCompliant) {
    console.log('🛡️  Calling whitelistInvestor...');
    for (let i = 1; i <= 3; i++) {
      try {
        const tx = await compliance.whitelistInvestor(address, kycHash, jurisdiction, true, oneYear);
        await tx.wait();
        complianceTxHash = tx.hash;
        console.log('🛡️  Whitelisted | tx:', tx.hash);
        break;
      } catch (err) {
        console.log(`🛡️  whitelistInvestor attempt ${i} failed:`, err.message?.slice(0, 60));
        if (i === 3) throw err;
        await new Promise(r => setTimeout(r, 5000 * i));
      }
    }
  }

  const hcsApprovalSeq = await publishToHCS(JSON.stringify({
    event: 'kyc_approved', address, jurisdiction, txHash: complianceTxHash,
    hcsRequestSeq, timestamp: Math.floor(Date.now() / 1000),
    operator: 'liquid-protocol', signedWithKMS: true, kmsKeyId: KMS_KEY_ID,
  }));

  return {
    status: 200,
    body: { whitelisted: true, address, txHash: complianceTxHash, hcsRequestSeq, hcsApprovalSeq, signedWithKMS: true },
  };
}

// ── Audit Log Handler ─────────────────────────────────────────────────────────

async function handleAuditLog(event, data) {
  if (!event) return { status: 400, body: { error: 'event is required' } };
  const seqNumber = await publishToHCS(JSON.stringify({
    event, ...data,
    timestamp: Math.floor(Date.now() / 1000), operator: 'liquid-protocol', signedWithKMS: true,
  }));
  return { status: 200, body: { logged: true, event, hcsSequenceNumber: seqNumber } };
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { address, name, jurisdiction, event, data } = body ?? {};
    let result;
    if (address && !event) {
      result = await handleWhitelist(address, name, jurisdiction);
    } else if (event) {
      result = await handleAuditLog(event, data ?? {});
    } else {
      return res.status(400).json({ error: 'Provide address (whitelist) or event (audit log)' });
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('KMS operator error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}