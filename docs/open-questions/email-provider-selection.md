# Email provider selection

Status: **SELECTED FOR DEVELOPMENT / PRODUCTION APPROVAL PENDING**

The application keeps generic email and SMS provider boundaries with safe console/mock providers.
Brevo is now the selected development adapter through the official `@getbrevo/brevo` SDK. The
implementation sends inline versioned transactional content, persists returned message IDs, and
does not store provider payloads or transient verification codes.

Production enablement still requires commercial approval, data-processing and residency review,
verified sender-domain setup, SMS Sender ID approval in target countries, deliverability monitoring,
retention rules, webhook signature/authentication design, and credentials in the production secret
manager. Local `.env` credentials are never a production secret-management solution.

Template identifiers belong in environment/provider configuration. Notification jobs require deterministic deduplication, bounded retries, delivery-state tracking, and redacted logs. Another provider must be replaceable without changing notification domain rules.
