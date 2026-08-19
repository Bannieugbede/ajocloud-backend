import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  IDENTITY_ATTEMPT_WINDOW_MS,
  accountNumberDigest,
  hasExhaustedAttempts,
  isOldEnough,
  isValidAccountNumber,
  isValidIdentityNumber,
  namesMatch,
  normalizeIdentityNumber,
  personalDetailsComplete,
  qualifiesForTier2,
} from './domain/identity-verification-policy.js';
import { maskIdentityValue } from './domain/identity-redaction.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from './providers/identity-provider.js';
import type { InquireAccountDto } from './dto/inquire-account.dto.js';
import type { LinkBankAccountDto } from './dto/link-bank-account.dto.js';
import type { UpdatePersonalDetailsDto } from './dto/update-personal-details.dto.js';
import type { VerifyIdentityDto } from './dto/verify-identity.dto.js';

/** Version of the consent wording shown before an identity check. */
const IDENTITY_CONSENT_VERSION = '2026-08-19';

/**
 * Tier 2 identity verification (ADR-004).
 *
 * The single rule that governs this file: a raw identity number or account
 * number never leaves a method it was passed into. It is validated, forwarded
 * to the provider, and dropped. What persists is the masked value plus the
 * result.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
  ) {}

  /** Step f: what the user still owes, so the introduction screen is honest. */
  async status(userId: string) {
    const [profile, kyc, bankAccount] = await Promise.all([
      this.prisma.userProfile.findUnique({ where: { userId } }),
      this.prisma.kycProfile.findUnique({
        where: { userId },
        include: { checks: { orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.linkedBankAccount.findFirst({
        where: { userId },
        orderBy: { verifiedAt: 'desc' },
      }),
    ]);

    const detailsComplete = profile ? personalDetailsComplete(profile) : false;
    const identityCheck = kyc?.checks.find(
      (check) =>
        (check.type === 'BVN' || check.type === 'NIN' || check.type === 'VNIN') &&
        check.status === 'PASSED',
    );

    return {
      tier: kyc?.tier ?? 'TIER_1',
      status: kyc?.status ?? 'NOT_STARTED',
      steps: {
        personalDetails: { complete: detailsComplete },
        identity: {
          complete: Boolean(identityCheck),
          // Only ever the masked value; the raw number is not stored.
          maskedIdentifier: identityCheck?.maskedIdentifier ?? null,
          kind: identityCheck?.type ?? null,
        },
        bankAccount: {
          complete: Boolean(bankAccount),
          ...(bankAccount
            ? {
                bankName: bankAccount.bankName,
                accountMasked: bankAccount.accountMasked,
                accountName: bankAccount.accountName,
              }
            : {}),
        },
      },
    };
  }

  /** Step g: personal details. */
  async updatePersonalDetails(userId: string, dto: UpdatePersonalDetailsDto) {
    if (!isOldEnough(dto.dateOfBirth, new Date())) {
      throw new BadRequestException('You must be at least 18 years old to use Ajo Cloud');
    }

    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        addressLine: dto.addressLine,
        city: dto.city,
        state: dto.state,
        occupation: dto.occupation,
      },
    });

    await this.audit.record({
      action: 'kyc.personal-details.updated',
      subjectType: 'user',
      subjectId: userId,
      actorUserId: userId,
    });

    await this.promoteIfEligible(userId);
    return this.status(userId);
  }

  /**
   * Step h: BVN or NIN verification.
   *
   * `dto.identityNumber` is read here, passed to the provider, and never
   * written anywhere. Every persisted field below is derived from the result or
   * from the mask.
   */
  async verifyIdentity(userId: string, dto: VerifyIdentityDto) {
    const identityNumber = normalizeIdentityNumber(dto.identityNumber);
    if (!isValidIdentityNumber(dto.kind, identityNumber)) {
      throw new BadRequestException(`Enter a valid ${dto.kind}`);
    }

    const kycProfile = await this.ensureKycProfile(userId);
    await this.assertAttemptsRemain(kycProfile.id);

    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Complete your personal details first');
    const legalName = `${profile.firstName} ${profile.lastName}`;

    // Consent is recorded before the provider is called, so there is no window
    // in which the number was sent without a stored record of permission.
    await this.prisma.userConsent.upsert({
      where: {
        userId_type_version: {
          userId,
          type: 'IDENTITY_VERIFICATION',
          version: IDENTITY_CONSENT_VERSION,
        },
      },
      update: {},
      create: { userId, type: 'IDENTITY_VERIFICATION', version: IDENTITY_CONSENT_VERSION },
    });

    const outcome = await this.provider.verifyIdentity({
      kind: dto.kind,
      identityNumber,
      legalName,
      ...(profile.dateOfBirth
        ? { dateOfBirth: profile.dateOfBirth.toISOString().slice(0, 10) }
        : {}),
    });

    // Name matching is advisory: a mismatch flags for review, never rejects.
    const riskFlags = [...outcome.riskFlags];
    if (outcome.passed && outcome.verifiedName && !namesMatch(outcome.verifiedName, legalName)) {
      riskFlags.push('NAME_MISMATCH');
    }

    const maskedIdentifier = maskIdentityValue(identityNumber);
    await this.prisma.kycCheck.create({
      data: {
        kycProfileId: kycProfile.id,
        type: dto.kind,
        provider: outcome.provider,
        status: outcome.passed ? 'PASSED' : 'FAILED',
        providerRef: outcome.providerReference,
        resultCode: outcome.resultCode,
        maskedIdentifier,
        riskFlags,
        checkedAt: new Date(),
        ...(outcome.passed ? {} : { failureReason: outcome.resultCode }),
      },
    });

    await this.audit.record({
      action: outcome.passed ? 'kyc.identity.verified' : 'kyc.identity.failed',
      subjectType: 'user',
      subjectId: userId,
      actorUserId: userId,
      // Masked value only. The raw number is never in an audit payload.
      metadata: { kind: dto.kind, maskedIdentifier, provider: outcome.provider },
    });

    if (riskFlags.includes('NAME_MISMATCH')) {
      await this.prisma.kycProfile.update({
        where: { id: kycProfile.id },
        data: { status: 'REQUIRES_REVIEW', submittedAt: new Date() },
      });
    }

    if (!outcome.passed) {
      throw new BadRequestException('We could not verify that number. Check it and try again.');
    }

    await this.promoteIfEligible(userId);
    return {
      verified: true,
      maskedIdentifier,
      requiresReview: riskFlags.includes('NAME_MISMATCH'),
    };
  }

  /** Step i, part one: the bank list backing the dropdown. */
  async listBanks() {
    const banks = await this.provider.listBanks();
    return { banks };
  }

  /**
   * Step i, part two: resolve the account name so the user confirms what the
   * bank returned rather than what they typed. Nothing is stored here.
   */
  async inquireAccount(dto: InquireAccountDto) {
    if (!isValidAccountNumber(dto.accountNumber)) {
      throw new BadRequestException('Enter the 10-digit account number');
    }
    const outcome = await this.provider.inquireAccount({
      bankCode: dto.bankCode,
      accountNumber: dto.accountNumber,
    });
    if (!outcome.passed || !outcome.accountName) {
      throw new BadRequestException('We could not find that account. Check the details.');
    }
    return { accountName: outcome.accountName, bankCode: dto.bankCode };
  }

  /** Step i, part three: link the account after the name has been shown. */
  async linkBankAccount(userId: string, dto: LinkBankAccountDto) {
    if (!isValidAccountNumber(dto.accountNumber)) {
      throw new BadRequestException('Enter the 10-digit account number');
    }

    const [outcome, banks] = await Promise.all([
      this.provider.inquireAccount({
        bankCode: dto.bankCode,
        accountNumber: dto.accountNumber,
      }),
      this.provider.listBanks(),
    ]);
    if (!outcome.passed || !outcome.accountName) {
      throw new BadRequestException('We could not find that account. Check the details.');
    }

    const bankName = banks.find((bank) => bank.code === dto.bankCode)?.name;
    if (!bankName) throw new BadRequestException('Select a bank from the list');

    const pepper = this.config.get('TOKEN_PEPPER', { infer: true });
    const digest = accountNumberDigest(dto.accountNumber, pepper);
    const accountMasked = maskIdentityValue(dto.accountNumber);

    const kycProfile = await this.ensureKycProfile(userId);
    await this.prisma.linkedBankAccount.upsert({
      where: { userId_accountDigest: { userId, accountDigest: digest } },
      update: {
        bankCode: dto.bankCode,
        bankName,
        accountName: outcome.accountName,
        provider: outcome.provider,
        providerRef: outcome.providerReference,
        verifiedAt: new Date(),
      },
      create: {
        userId,
        bankCode: dto.bankCode,
        bankName,
        accountMasked,
        accountDigest: digest,
        accountName: outcome.accountName,
        provider: outcome.provider,
        providerRef: outcome.providerReference,
      },
    });

    await this.prisma.kycCheck.create({
      data: {
        kycProfileId: kycProfile.id,
        type: 'BANK_ACCOUNT',
        provider: outcome.provider,
        status: 'PASSED',
        providerRef: outcome.providerReference,
        resultCode: outcome.resultCode,
        maskedIdentifier: accountMasked,
        checkedAt: new Date(),
      },
    });

    await this.audit.record({
      action: 'kyc.bank-account.linked',
      subjectType: 'user',
      subjectId: userId,
      actorUserId: userId,
      metadata: { bankCode: dto.bankCode, accountMasked },
    });

    await this.promoteIfEligible(userId);
    return { accountMasked, accountName: outcome.accountName, bankName };
  }

  async listBankAccounts(userId: string) {
    const accounts = await this.prisma.linkedBankAccount.findMany({
      where: { userId },
      orderBy: { verifiedAt: 'desc' },
      // The digest is an internal lookup key and is never returned.
      select: {
        id: true,
        bankCode: true,
        bankName: true,
        accountMasked: true,
        accountName: true,
        verifiedAt: true,
      },
    });
    return { accounts };
  }

  /** Grants Tier 2 once details, identity, and bank account are all present. */
  private async promoteIfEligible(userId: string): Promise<void> {
    const [profile, kyc, bankAccount] = await Promise.all([
      this.prisma.userProfile.findUnique({ where: { userId } }),
      this.prisma.kycProfile.findUnique({ where: { userId }, include: { checks: true } }),
      this.prisma.linkedBankAccount.findFirst({ where: { userId } }),
    ]);
    if (!profile || !kyc) return;
    // A profile held for review is not promoted until a reviewer clears it.
    if (kyc.status === 'REQUIRES_REVIEW') return;

    const identityCheckPassed = kyc.checks.some(
      (check) =>
        (check.type === 'BVN' || check.type === 'NIN' || check.type === 'VNIN') &&
        check.status === 'PASSED',
    );

    if (
      !qualifiesForTier2({
        personalDetailsComplete: personalDetailsComplete(profile),
        identityCheckPassed,
        bankAccountVerified: Boolean(bankAccount),
      })
    ) {
      return;
    }

    if (kyc.tier === 'TIER_2' || kyc.tier === 'TIER_3') return;
    await this.prisma.kycProfile.update({
      where: { id: kyc.id },
      data: { tier: 'TIER_2', level: 2, status: 'VERIFIED', verifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'kyc.tier.promoted',
      subjectType: 'user',
      subjectId: userId,
      metadata: { tier: 'TIER_2' },
    });
  }

  private async ensureKycProfile(userId: string) {
    return this.prisma.kycProfile.upsert({
      where: { userId },
      update: {},
      create: { userId, status: 'PENDING', tier: 'TIER_1', level: 1, submittedAt: new Date() },
    });
  }

  /**
   * Bounds how many identifiers one account may test against the provider,
   * which is what stops the endpoint being used to enumerate BVNs.
   */
  private async assertAttemptsRemain(kycProfileId: string): Promise<void> {
    const since = new Date(Date.now() - IDENTITY_ATTEMPT_WINDOW_MS);
    const failures = await this.prisma.kycCheck.findMany({
      where: {
        kycProfileId,
        status: 'FAILED',
        type: { in: ['BVN', 'NIN', 'VNIN'] },
        createdAt: { gte: since },
      },
      select: { createdAt: true },
    });

    if (
      hasExhaustedAttempts(
        failures.map((failure) => failure.createdAt),
        new Date(),
      )
    ) {
      await this.prisma.kycProfile.update({
        where: { id: kycProfileId },
        data: { status: 'REQUIRES_REVIEW' },
      });
      throw new HttpException(
        'Too many verification attempts. Contact support to continue.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
