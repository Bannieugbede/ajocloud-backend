import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { MONNIFY_SIGNATURE_HEADER } from './domain/monnify-signature.js';
import type { MonnifyEventEnvelope, MonnifyEventKind } from './domain/monnify-events.js';
import { MonnifySignatureGuard } from './guards/monnify-signature.guard.js';
import { MonnifyWebhooksService, type WebhookAcknowledgement } from './monnify-webhooks.service.js';

/**
 * Monnify webhook callbacks (ADR-006).
 *
 * One route per dashboard callback URL, so each can be registered, disabled, or
 * traced independently. Every route shares `MonnifySignatureGuard`, which
 * rejects anything whose HMAC-SHA512 over the raw body does not verify.
 *
 * Excluded from Swagger: these are provider-to-server callbacks, not part of
 * the client API, and publishing their shape invites probing.
 *
 * The throttle here is far above the global 120/min. Settlement and
 * disbursement batches legitimately burst, and throttling a provider only makes
 * it retry — turning a burst into a longer burst plus duplicates.
 */
@ApiExcludeController()
@UseGuards(MonnifySignatureGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller({ path: 'webhooks/monnify', version: '1' })
export class MonnifyWebhooksController {
  constructor(private readonly webhooks: MonnifyWebhooksService) {}

  /** Collection succeeded: a customer's payment completed. */
  @Post('transaction-completion')
  @HttpCode(HttpStatus.OK)
  transactionCompletion(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('TRANSACTION_COMPLETION', request, payload);
  }

  /** A refund finished processing. */
  @Post('refund-completion')
  @HttpCode(HttpStatus.OK)
  refundCompletion(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('REFUND_COMPLETION', request, payload);
  }

  /** A payout to a bank account succeeded, failed, or was reversed. */
  @Post('disbursement')
  @HttpCode(HttpStatus.OK)
  disbursement(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('DISBURSEMENT', request, payload);
  }

  /** Monnify settled collected funds to the merchant account. */
  @Post('settlement')
  @HttpCode(HttpStatus.OK)
  settlement(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('SETTLEMENT', request, payload);
  }

  /** Movement on the Monnify wallet. */
  @Post('wallet-activity')
  @HttpCode(HttpStatus.OK)
  walletActivity(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('WALLET_ACTIVITY', request, payload);
  }

  /** Disbursement wallet balance fell below the configured threshold. */
  @Post('low-balance')
  @HttpCode(HttpStatus.OK)
  lowBalance(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('LOW_BALANCE', request, payload);
  }

  /** A bill payment reached a terminal state. */
  @Post('bills-payment')
  @HttpCode(HttpStatus.OK)
  billsPayment(
    @Req() request: FastifyRequest,
    @Body() payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    return this.handle('BILLS_PAYMENT', request, payload);
  }

  private handle(
    kind: MonnifyEventKind,
    request: FastifyRequest,
    payload: MonnifyEventEnvelope,
  ): Promise<WebhookAcknowledgement> {
    const header = request.headers[MONNIFY_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    // The guard has already proven `rawBody` exists and matches the signature.
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    return this.webhooks.record(kind, payload, rawBody, signature);
  }
}
