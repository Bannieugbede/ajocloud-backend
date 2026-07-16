# Bill Payment

Bill Payment supports provider-catalog categories/billers/products, time-limited customer validation, idempotent wallet-funded payments, immutable attempts/events, reconciliation, reversal records, receipts, and notification/outbox events.

The application depends on `BillPaymentProvider`. The development mock adapter is deterministic and is never a claim of real payment. The Monnify class intentionally throws until current official bill-payment documentation and commercial requirements are reviewed; no endpoint, payload, status, signature, or retry rule has been guessed.

## Funds lifecycle

1. Validate the customer through the selected provider and persist only a digest/masked reference.
2. Resolve an effective versioned fee and calculate in integer minor units.
3. In a serializable transaction, verify wallet ownership/balance, create the payment and attempt, move available wallet liability to reserved liability, and write audit/outbox records.
4. Call the provider after commit.
5. Confirmed success debits reserve and credits provider payable plus any fee revenue. Confirmed failure returns reserve to available funds. Pending, timeout, exception, or unknown result retains reserve and enters reconciliation.
6. Reversals/refunds use new ledger postings and never edit the original.

`POST /api/v1/bill-payments` requires `Idempotency-Key`. The webhook endpoint is intentionally absent until signature and raw-body requirements are verified. Production also requires configured wallet available/reserved accounts, provider payable, fee revenue, and an effective `BILL_PAYMENT` fee definition.
