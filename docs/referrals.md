# Referrals and rewards

Registration creates only a referral relationship. Effective-dated campaign data defines qualifying product/event, settled transaction count, minimum amount, KYC tier, reward amount/currency, caps, expiry, and fraud restrictions. Qualification occurs only after settled eligible activity; failed/reversed activity cannot release a reward.

Self-referral, duplicate identity/device/phone/bank patterns, circular relationships, duplicate qualifying events, and repeated one-time rewards must be rejected. Released rewards require an idempotent double-entry ledger posting, audit/outbox records, and reversal when the qualifying transaction is later reversed.
