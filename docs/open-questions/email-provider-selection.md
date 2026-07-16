# Email provider selection

Status: **UNDER CONSIDERATION**

The application uses a generic email-provider boundary and a safe development console provider. Brevo is a candidate transactional-email adapter, not an approved dependency. Selection requires current API/webhook documentation, commercial approval, data-processing and residency review, sender-domain setup, deliverability requirements, retention rules, and credentials in the production secret manager.

Template identifiers belong in environment/provider configuration. Notification jobs require deterministic deduplication, bounded retries, delivery-state tracking, and redacted logs. Another provider must be replaceable without changing notification domain rules.
