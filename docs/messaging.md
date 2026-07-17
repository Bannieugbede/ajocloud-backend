# Messaging

RabbitMQ carries durable integration/domain events through a durable topic exchange. Envelopes contain event ID/type/version/time/source/correlation/payload; publishing uses persistent messages and confirms. Future consumers must use explicit acknowledgement, dead-letter/retry topology, and commit an inbox record before acknowledgement.

BullMQ is reserved for low-risk application jobs such as notifications, reminders, and reports, using deterministic job IDs, bounded exponential retry, and operational review of failed jobs. Redis is never authoritative for financial state. Transactional outbox rows bridge committed database state to RabbitMQ.

Notification events cover account/security, Ajo, Food Ajo, Akawo, Bill Payment, and referral milestones. Template versions, user/channel preferences, quiet hours, deterministic dedupe keys, attempts, provider references, and terminal delivery states are persisted. Financial state never depends on successful notification delivery.

Transactional email and SMS currently use Brevo's API through the official Node SDK. The generic
provider interfaces remain replaceable, and console/mock providers remain available for tests and
offline development. See [notifications](notifications.md) for template and delivery details.
