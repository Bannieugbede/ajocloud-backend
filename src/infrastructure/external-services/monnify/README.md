# Monnify integration boundary

The Bill Payment provider interface, persistence model, mock adapter, state machine, reservation semantics, timeout handling, and reconciliation states are implemented without inventing Monnify traffic.

The real adapter is blocked until the repository owner supplies current official documentation and confirms the commercial agreement. Review authentication/token lifetime, exact catalog/validation/payment/inquiry endpoints, request and response schemas, idempotency behaviour, timeout semantics, retry guidance, webhook signature algorithm and raw-body requirements, event identifiers, status mapping, rate limits, and redaction requirements before implementation.
