-- Bill payments are paid through the shared payment intent (ADR-014). The
-- intent's target is the customer validation the payment quotes.
ALTER TYPE "PaymentTargetType" ADD VALUE 'BILL_PAYMENT';
