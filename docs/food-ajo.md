# Food Ajo

Food Ajo is a controlled contribution, procurement, and food-distribution product. Ordinary membership never grants coordinator capability. A coordinator application progresses through draft, submission, automated review, manual compliance review, information request, approval/rejection, suspension/revocation, and expiry.

Approval requires verified Tier 3 identity, recorded risk and bank-verification references, coordinator terms, a human reviewer, expiry/review date, and audit/outbox history. Approved programme creation must also enforce package price lock, capacity, reconciled contributions, approved vendors, purchase orders, invoices/receipts, distribution evidence, one-time expiring OTP/QR confirmation, receipt confirmation, and disputes.

The application/review API, approved-coordinator programme creation/read API, member enrolment, and
the coordinator lifecycle, procurement, and distribution tooling are implemented.

## Member API

- `POST /api/v1/food-ajo/programmes` — create a draft programme with packages/items; authenticated;
  active coordinator approval required.
- `GET /api/v1/food-ajo/programmes?cursor=&limit=` — cursor-paginated discoverable, subscribed, or
  coordinated programmes.
- `GET /api/v1/food-ajo/programmes/:programmeId` — guarded programme detail.
- `GET /api/v1/food-ajo/programmes/subscriptions/mine` — the caller's own enrolments.
- `POST /api/v1/food-ajo/programmes/:programmeId/subscribe` — enrol in a package. Capacity counts
  portions rather than members, so a member raising their quantity cannot oversubscribe the
  programme. Only an `OPEN` programme accepts enrolment.
- `POST /api/v1/food-ajo/programmes/:programmeId/unsubscribe` — withdraw an unfulfilled enrolment.
- `POST /api/v1/food-ajo/distributions/:distributionId/collection-code` — the member's own one-time
  collection code, returned once. See "Collection evidence" below for why the member issues it.

## Coordinator API

Every coordinator route is scoped to the coordinator of that specific programme, checked against the
programme record rather than against a role: coordinating one programme must not confer control of
another. A caller who does not coordinate the programme is told it was not found, so the routes
cannot be used to discover that a programme exists.

- `PATCH /api/v1/food-ajo/programmes/:programmeId/status` — lifecycle transition.
- `PATCH /api/v1/food-ajo/programmes/:programmeId/packages/:packageId` — edit a package while the
  programme is still a draft and its price is unlocked.
- `GET /api/v1/food-ajo/programmes/:programmeId/procurement-plan` — portions taken per package, the
  aggregate shopping list, and the amount members owe.
- `GET|POST /api/v1/food-ajo/programmes/:programmeId/purchase-orders` — list and raise orders.
- `PATCH /api/v1/food-ajo/programmes/:programmeId/purchase-orders/:orderId/status` — order lifecycle.
- `POST /api/v1/food-ajo/programmes/:programmeId/purchase-orders/:orderId/receipts` — record a
  delivery receipt by storage key and content hash.
- `GET|POST /api/v1/food-ajo/programmes/:programmeId/distributions` — list and plan distributions.
- `PATCH /api/v1/food-ajo/programmes/:programmeId/distributions/:distributionId/status` —
  distribution lifecycle.
- `POST /api/v1/food-ajo/programmes/:programmeId/distributions/:distributionId/confirm` — confirm a
  member's collection against the code they present.
- `GET|POST /api/v1/food-ajo/vendors` — list verified vendors, or propose one.

## Lifecycle and price lock

`DRAFT → OPEN → ACTIVE → COMPLETED`, with `SUSPENDED` reachable from `OPEN` and `ACTIVE`, and
`CANCELLED` from any non-terminal state. `COMPLETED` and `CANCELLED` are terminal: reopening a
completed programme would let a coordinator collect against a cycle already distributed and
reconciled. A suspended programme resumes to `OPEN` or `ACTIVE` and can never jump to `COMPLETED`.

**Opening a programme locks its package prices.** A member enrols against a displayed price, so it
must stop being editable before anyone can see it; `priceLockedAt` is stamped on every unlocked
package at that moment, and a locked package is refused for edit thereafter. This is why the lock is
taken at opening rather than at creation: a draft is still being worked on and has no members to
protect.

`ACTIVE` closes enrolment. That is deliberate — procurement has begun, so a late joiner would not be
in what was bought.

## Procurement

Procurement is refused until the programme is `ACTIVE`, so orders are placed against a subscriber
list that can no longer change. The procurement plan sizes the order by **portions actually
enrolled, never by capacity**: ordering to capacity would spend contributions that were never
collected on food nobody claimed. Order totals are computed server-side from the line items, with
decimal quantities scaled through integers so a quantity such as `2.5` cannot introduce float drift.

Orders may only be placed with a vendor the platform has verified. A coordinator can propose a
vendor, but it is created unverified: verification is a platform decision, so a coordinator cannot
approve their own supplier and then order from it.

`DRAFT → SUBMITTED → CONFIRMED → FULFILLED`. A confirmed order cannot be cancelled — the vendor has
committed, so unwinding it is a commercial conversation rather than a status flip. **An order cannot
be marked fulfilled until a delivery receipt has been recorded**, so the claim that goods arrived
always has evidence behind it. Receipts and invoices are stored by object-storage key and content
hash only; the document never passes through the API, and the hash is what makes the evidence
tamper-evident.

## Distribution and collection evidence

A distribution can only be planned once at least one purchase order is `FULFILLED`, and its item
list is built server-side from the live subscriptions rather than accepted from the client, so a
coordinator cannot quietly leave out a member who paid. `PLANNED → READY → DISTRIBUTING →
COMPLETED`; a distribution cannot be cancelled once it has begun, and cannot be completed while any
member's item is unconfirmed.

**Collection codes are issued to the member, not to the coordinator.** A coordinator able to both
mint and redeem a code could record food as collected that nobody ever received, which is precisely
what this evidence exists to rule out. The code is six characters from an alphabet that excludes
ambiguous glyphs (it is read aloud in a queue and typed by hand), returned exactly once, and stored
only as a SHA-256 digest so a leaked database yields no usable collection codes. It expires after 30
minutes and is burnt on use, so a screenshot of an old code cannot be replayed. Re-issuing replaces
the previous code, so a member who lost theirs is not locked out. A wrong code and an expired code
are reported identically, so the endpoint cannot be used to probe for live codes.

A programme cannot be completed while any member is still owed food: closing with outstanding items
would erase the record that somebody never received what they paid for.

## Not yet implemented

Contributions are not yet collected against a programme: the payment intent target
`FOOD_SUBSCRIPTION` exists, but no route settles a subscription, so `expectedMinor` in the
procurement plan is what members owe rather than what has been received. Coordinator
suspension/revocation, automated KYC/risk/bank checks, and missing-item or non-delivery disputes
also remain outstanding.
