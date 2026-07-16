# Architecture

The system is a domain-oriented modular monolith with API, worker, and scheduler entry points. HTTP controllers validate/serialize; application services orchestrate; pure domain functions enforce financial rules; Prisma services own persistence; infrastructure adapters isolate Redis, RabbitMQ, providers, and storage.

Extraction boundaries follow modules and durable events, not database-per-feature ceremony. Transactions never span network calls. Financial state changes write durable database state and eventually an outbox event in one boundary; consumers deduplicate with inbox records before acknowledging.

Current modules implement auth, users, permissions, Ajo groups, wallets, ledger, audit, idempotency, and health. Other product areas have coherent schemas but remain explicitly unimplemented in the roadmap.
