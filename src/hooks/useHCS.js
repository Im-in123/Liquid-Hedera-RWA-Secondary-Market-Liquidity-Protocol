// src/hooks/useHCS.js
//
// HCS (Hedera Consensus Service) integration
//
// publishEvent — posts to /api/whitelist which submits the HCS message
//   server-side using the deployer key. The user signs zero HCS transactions.
//   This guarantees a complete audit trail — users cannot reject or skip it.
//
// fetchAuditLog — reads all messages from the mirror node REST API.
//   Shows platform-wide activity, not filtered by connected wallet.

import { useCallback } from 'react';
import { HCS_TOPIC_ID } from '../config/contracts';

const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com/api/v1';
const API_BASE    = '/api/whitelist';

export function useHCS() {

  /**
   * Publish an audit event to HCS via the serverless operator.
   * Fire-and-forget — never blocks the user action that triggered it.
   */
  const publishEvent = useCallback(async (eventType, data = {}) => {
    if (!HCS_TOPIC_ID) return;
    try {
      await fetch(API_BASE, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ event: eventType, data }),
      });
      console.log(`📡 HCS event submitted server-side: ${eventType}`);
    } catch (err) {
      // Non-fatal — audit log failure should never block a trade
      console.warn('HCS publish failed (non-fatal):', err.message);
    }
  }, []);

  /**
   * Fetch all audit log messages from the mirror node.
   * Returns platform-wide events — not filtered by connected wallet.
   */
  const fetchAuditLog = useCallback(async (limit = 25) => {
    if (!HCS_TOPIC_ID) return [];
    try {
      const res = await fetch(
        `${MIRROR_BASE}/topics/${HCS_TOPIC_ID}/messages?limit=${limit}&order=desc`
      );
      if (!res.ok) return [];

      const json     = await res.json();
      const messages = (json.messages || []).map(msg => {
        try {
          const decoded = atob(msg.message);
          return {
            ...JSON.parse(decoded),
            consensusTimestamp: msg.consensus_timestamp,
            sequenceNumber:     msg.sequence_number,
          };
        } catch {
          return null;
        }
      }).filter(Boolean);

      return messages;
    } catch (err) {
      console.warn('HCS fetch failed:', err.message);
      return [];
    }
  }, []);

  return { publishEvent, fetchAuditLog, topicId: HCS_TOPIC_ID };
}

export default useHCS;
