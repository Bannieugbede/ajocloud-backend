# Bill Payment

Bill Payment supports provider-catalog categories/billers/products, time-limited customer validation, idempotent wallet-funded payments, immutable attempts/events, reconciliation, reversal records, receipts, and notification/outbox events.

## Catalogue

Four categories, in this order:

| Category    | Billers                                                                     | Reference                  | Pricing                             |
| ----------- | --------------------------------------------------------------------------- | -------------------------- | ----------------------------------- |
| Airtime     | MTN, Airtel, Glo, 9mobile                                                   | Phone number               | Top-up, ₦50 – ₦50,000               |
| Internet    | MTN, Airtel, Glo, 9mobile data; Smile; Spectranet                           | Phone number or account/ID | Fixed-price plans with validity     |
| Electricity | AEDC, BEDC, EKEDC, EEDC, IBEDC, IKEDC, JED, KAEDCO, KEDCO, PHED, YEDC, APLE | Meter number               | Prepaid/Postpaid, ₦1,000 – ₦500,000 |
| Cable TV    | DStv, GOtv, StarTimes                                                       | Smartcard / IUC number     | Fixed-price bouquets                |

The catalogue is defined once in `src/modules/bill-payments/domain/nigeria-bill-catalog.ts`. The development provider serves it, and the seed writes it through the same `syncBillCatalog` the service refreshes with, so the two cannot drift. Codes are stable: stored payments point at the rows they name, so a code is never reused. A sync retires anything the provider no longer lists (`INACTIVE`, never deleted) and refreshes as soon as the provider's `catalogRevision` differs from the stored copy, without waiting for the six-hour expiry. That is how the former Water category and the development-only `DEV_AIRTIME` category are removed from existing databases.

**Package prices are indicative.** Operators reprice often. A live provider replaces this catalogue with its own; these figures must not be treated as current pricing.

Each biller carries a `referenceKind` (`phone`, `meter`, `smartcard`, `account`) and a `referenceLabel`, returned by `GET /bill-payments/billers`. Validation normalises the reference for its kind (phone numbers become `0XXXXXXXXXX` whether typed with spaces, `+234` or `234`) and rejects a malformed one with a specific 422 before asking the provider. Payment normalises the same way, so the reference the member typed at each step need not match character for character.

The development provider refuses a reference ending in `0000`, or the literal `invalid`, for exercising the unhappy path.

## Providers

The application depends on `BillPaymentProvider`. The development mock adapter is deterministic and is never a claim of real payment. The Monnify class intentionally throws until current official bill-payment documentation and commercial requirements are reviewed; no endpoint, payload, status, signature, or retry rule has been guessed.

## Funds lifecycle

1. Validate the customer through the selected provider and persist only a digest/masked reference.
2. Resolve an effective versioned fee and calculate in integer minor units.
3. In a serializable transaction, verify wallet ownership/balance, create the payment and attempt, move available wallet liability to reserved liability, and write audit/outbox records.
4. Call the provider after commit.
5. Confirmed success debits reserve and credits provider payable plus any fee revenue. Confirmed failure returns reserve to available funds. Pending, timeout, exception, or unknown result retains reserve and enters reconciliation.
6. Reversals/refunds use new ledger postings and never edit the original.

`POST /api/v1/bill-payments` requires `Idempotency-Key`. The webhook endpoint is intentionally absent until signature and raw-body requirements are verified. Production also requires configured wallet available/reserved accounts, provider payable, fee revenue, and an effective `BILL_PAYMENT` fee definition.
