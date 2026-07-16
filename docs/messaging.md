# Messaging

RabbitMQ carries durable integration/domain events through a durable topic exchange. Envelopes contain event ID/type/version/time/source/correlation/payload; publishing uses persistent messages and confirms. Future consumers must use explicit acknowledgement, dead-letter/retry topology, and commit an inbox record before acknowledgement.

BullMQ is reserved for low-risk application jobs such as notifications, reminders, and reports, using deterministic job IDs, bounded exponential retry, and operational review of failed jobs. Redis is never authoritative for financial state. Transactional outbox rows bridge committed database state to RabbitMQ.
