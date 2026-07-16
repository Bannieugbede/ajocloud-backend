# Food Ajo

Food Ajo is a controlled contribution, procurement, and food-distribution product. Ordinary membership never grants coordinator capability. A coordinator application progresses through draft, submission, automated review, manual compliance review, information request, approval/rejection, suspension/revocation, and expiry.

Approval requires verified Tier 3 identity, recorded risk and bank-verification references, coordinator terms, a human reviewer, expiry/review date, and audit/outbox history. Approved programme creation must also enforce package price lock, capacity, reconciled contributions, approved vendors, purchase orders, invoices/receipts, distribution evidence, one-time expiring OTP/QR confirmation, receipt confirmation, and disputes.

The application/review API and approved-coordinator programme creation/read API are implemented.
Programme creation requires a current approved application, validates dates/capacity/package items,
and atomically persists the draft programme, packages, audit record, and outbox event. Authenticated
members can list open/active programmes, their subscriptions, and programmes they coordinate.

API:

- `POST /api/v1/food-ajo/programmes` — create a draft programme with packages/items; authenticated;
  active coordinator approval required.
- `GET /api/v1/food-ajo/programmes?cursor=&limit=` — cursor-paginated discoverable, subscribed, or
  coordinated programmes.
- `GET /api/v1/food-ajo/programmes/:programmeId` — guarded programme detail.

Activation/price locking, subscriptions/contributions, procurement, and distribution remain separate
roadmap work. Draft creation never implies that a package is open for enrolment.
