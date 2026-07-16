# Architecture

The system is a domain-oriented modular monolith with API, worker, and scheduler entry points. HTTP controllers validate/serialize; application services orchestrate; pure domain functions enforce financial rules; Prisma services own persistence; infrastructure adapters isolate Redis, RabbitMQ, providers, and storage.

Extraction boundaries follow modules and durable events, not database-per-feature ceremony. Transactions never span network calls. Financial state changes write durable database state and eventually an outbox event in one boundary; consumers deduplicate with inbox records before acknowledging.

Current modules implement auth, users, permissions, fixed whole-slot Ajo groups, wallets, ledger, audit, idempotency, health, and public brand configuration. Product boundaries also define flexible whole-unit Ajo, Food Coordinator review, Akawo, Bill Payment, progressive KYC, referrals, notifications, and replaceable external providers. An endpoint is exposed only when its validation, authorization, persistence, and tests exist; schema/provider boundaries may deliberately precede executable workflows.

Bill Payment application code depends on `BillPaymentProvider`, never Monnify payloads. KYC capabilities are split by verification type so biometric checks are not mandatory for every user. Email delivery depends on a generic provider and uses BullMQ for retries. No real provider adapter is enabled until current official specifications and commercial terms are reviewed.
