import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
} from './domain/identity-verification-policy.js';
import { maskIdentityValue } from './domain/identity-redaction.js';
import { compareAddresses, isComparable, type PostalAddress } from './domain/address-match.js';
import {
  contentDigest,
  documentKey,
  encryptDocument,
  inspectDocument,
  type DocumentProblem,
} from './domain/identity-document.js';
import {
  KYC_ACTION_STAGES,
  completedLevel,
  currentStage,
  describeStages,
  tierForLevel,
  type KycFacts,
  type KycStage,
} from './domain/kyc-stage-policy.js';
import { KYC_STAGE_REQUIRED, NIN_DOCUMENT_TYPES, readKycFacts } from './kyc-facts.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from './providers/identity-provider.js';
import type { InquireAccountDto } from './dto/inquire-account.dto.js';
import type { LinkBankAccountDto } from './dto/link-bank-account.dto.js';
import type {
  UpdateBasicInfoDto,
  UpdatePersonalDetailsDto,
} from './dto/update-personal-details.dto.js';
import { IdentityKindInput, type VerifyIdentityDto } from './dto/verify-identity.dto.js';
import type { UploadIdentityDocumentDto } from './dto/upload-identity-document.dto.js';
import type { VerifyAddressDto } from './dto/verify-address.dto.js';

/** Version of the consent wording shown before an identity check. */
const IDENTITY_CONSENT_VERSION = '2026-08-19';

/** Risk flags that hold a NIN check for a reviewer instead of passing it. */
const REVIEW_FLAGS = ['NAME_MISMATCH', 'DOB_MISMATCH'];

const DOCUMENT_PROBLEMS: Record<DocumentProblem, string> = {
  EMPTY: 'Choose a photo of your NIN slip or card',
  TOO_LARGE: 'That file is too large. Retake the photo and try again.',
  UNSUPPORTED_TYPE: 'Upload a JPEG, PNG or PDF',
  TYPE_MISMATCH: 'That file is not the type it claims to be',
};

const ADDRESS_MISMATCH: Record<'STATE' | 'HOUSE_NUMBER' | 'STREET', string> = {
  STATE: 'The state does not match the address on your NIN record.',
  HOUSE_NUMBER: 'The house number does not match the address on your NIN record.',
  STREET: 'The street does not match the address on your NIN record.',
};

function stageRequired(stage: KycStage, message: string): ForbiddenException {
  return new ForbiddenException({
    code: KYC_STAGE_REQUIRED,
    message,
    details: { requiredStage: stage },
  });
}

/** The NIN record's address as stored on its check, if the provider gave one. */
function registeredAddressFrom(summary: unknown): PostalAddress | null {
  if (!summary || typeof summary !== 'object') return null;
  const address = (summary as { registeredAddress?: unknown }).registeredAddress;
  if (!address || typeof address !== 'object') return null;
  const { line, city, lga, state } = address as Record<string, unknown>;
  if (typeof line !== 'string') return null;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return { line, city: text(city), lga: text(lga), state: text(state) };
}

/**
 * Staged identity verification (ADR-004, ADR-015).
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

  /**
   * Where the person is in staged verification (ADR-015), plus the fields the
   * web client already reads. Also brings the stored tier in line with the
   * evidence, so reports and older checks that read the tier see the truth.
   */
  async status(userId: string) {
    const [facts, kyc, bankAccount] = await Promise.all([
      readKycFacts(this.prisma, userId),
      this.prisma.kycProfile.findUnique({
        where: { userId },
        include: { checks: { orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.linkedBankAccount.findFirst({
        where: { userId },
        orderBy: { verifiedAt: 'desc' },
      }),
    ]);
    const level = completedLevel(facts);
    const tier = tierForLevel(level);
    if (kyc && (kyc.tier !== tier || kyc.level !== level)) await this.sync(userId, facts);

    const identityCheck = kyc?.checks.find(
      (check) => (check.type === 'NIN' || check.type === 'VNIN') && check.status === 'PASSED',
    );

    return {
      level,
      currentStage: currentStage(facts),
      restricted: facts.restricted,
      stages: describeStages(facts),
      /** The stage each gated action needs, so the apps gate on the same table. */
      actions: KYC_ACTION_STAGES,
      tier,
      status: kyc?.status ?? 'NOT_STARTED',
      steps: {
        personalDetails: { complete: facts.basicInfoComplete },
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

  /** Stage 1: the basic details that complete sign-up. */
  async updateBasicInfo(userId: string, dto: UpdateBasicInfoDto) {
    if (!isOldEnough(dto.dateOfBirth, new Date())) {
      throw new BadRequestException('You must be at least 18 years old to use Ajo Cloud');
    }
    await this.prisma.userProfile.update({
      where: { userId },
      data: { dateOfBirth: dto.dateOfBirth, gender: dto.gender, occupation: dto.occupation },
    });
    await this.audit.record({
      action: 'kyc.basic-info.updated',
      subjectType: 'user',
      subjectId: userId,
      actorUserId: userId,
    });
    await this.sync(userId);
    return this.status(userId);
  }

  /**
   * Step g of the original flow: basic details and an address together. Kept
   * for clients that still send it; the address here is recorded but verifies
   * nothing, which is stage 3's job.
   */
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

    await this.sync(userId);
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

    const isNin = dto.kind !== IdentityKindInput.BVN;
    const facts = await readKycFacts(this.prisma, userId);
    if (isNin) {
      // The NIN is checked against the date of birth given at stage 1, so it
      // cannot come first.
      if (completedLevel(facts) < 1) {
        throw stageRequired(1, 'Finish stage 1 (Account) before verifying your NIN.');
      }
      // One identity per account. Letting a verified NIN be replaced would let
      // an account change whose identity it carries.
      if (facts.nin === 'passed') throw new ConflictException('Your NIN is already verified');
      if (facts.nin === 'pending') {
        throw new ConflictException('Your NIN is being reviewed. We will let you know.');
      }
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

    // A mismatch holds the check for a reviewer rather than passing it, so an
    // account cannot reach withdrawals on someone else's NIN.
    const requiresReview = outcome.passed && riskFlags.some((flag) => REVIEW_FLAGS.includes(flag));
    const checkStatus = !outcome.passed ? 'FAILED' : requiresReview ? 'PENDING' : 'PASSED';

    const maskedIdentifier = maskIdentityValue(identityNumber);
    await this.prisma.kycCheck.create({
      data: {
        kycProfileId: kycProfile.id,
        type: dto.kind,
        provider: outcome.provider,
        status: checkStatus,
        providerRef: outcome.providerReference,
        resultCode: outcome.resultCode,
        maskedIdentifier,
        riskFlags,
        checkedAt: new Date(),
        // The record's address is what stage 3 is compared against. An
        // address is ordinary profile data, unlike the number (ADR-004).
        ...(outcome.registeredAddress
          ? { resultSummary: { registeredAddress: { ...outcome.registeredAddress } } }
          : {}),
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

    if (requiresReview) {
      await this.prisma.kycProfile.update({
        where: { id: kycProfile.id },
        data: { status: 'REQUIRES_REVIEW', submittedAt: new Date() },
      });
    }

    if (!outcome.passed) {
      throw new BadRequestException('We could not verify that number. Check it and try again.');
    }

    await this.sync(userId);
    return { verified: true, maskedIdentifier, requiresReview };
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

    await this.sync(userId);
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

  /**
   * Stage 2: a photo of the NIN slip or card, held encrypted (ADR-015).
   *
   * Replaceable until stage 2 is complete, so a blurred first attempt can be
   * retaken; fixed afterwards, because it is the evidence the stage rests on.
   */
  async uploadIdentityDocument(userId: string, dto: UploadIdentityDocumentDto) {
    const facts = await readKycFacts(this.prisma, userId);
    if (facts.nin === 'none' || facts.nin === 'failed') {
      throw stageRequired(2, 'Verify your NIN before uploading the document.');
    }
    if (completedLevel(facts) >= 2) {
      throw new ConflictException('Your NIN document is already on file');
    }

    const inspected = inspectDocument(dto.data, dto.contentType);
    if (!inspected.ok) throw new BadRequestException(DOCUMENT_PROBLEMS[inspected.problem]);

    const key = documentKey(this.config.get('TOKEN_PEPPER', { infer: true }));
    const kycProfile = await this.ensureKycProfile(userId);
    const now = new Date();
    const document = await this.prisma.$transaction(async (tx) => {
      await tx.verificationDocument.updateMany({
        where: {
          kycProfileId: kycProfile.id,
          type: { in: [...NIN_DOCUMENT_TYPES] },
          supersededAt: null,
        },
        data: { supersededAt: now },
      });
      const created = await tx.verificationDocument.create({
        data: {
          kycProfileId: kycProfile.id,
          type: dto.type,
          storageKey: `db:${randomUUID()}`,
          contentHash: contentDigest(inspected.bytes),
          contentType: inspected.contentType,
          sizeBytes: inspected.bytes.length,
          ciphertext: new Uint8Array(encryptDocument(inspected.bytes, key)),
        },
        select: { id: true, type: true, createdAt: true },
      });
      // Puts the profile in front of a reviewer, who can reject a document that
      // is not a NIN or not this person's.
      await tx.kycProfile.update({ where: { id: kycProfile.id }, data: { submittedAt: now } });
      return created;
    });

    await this.audit.record({
      action: 'kyc.document.uploaded',
      subjectType: 'user',
      subjectId: userId,
      actorUserId: userId,
      // Never the content or its hash: type and size identify the upload.
      metadata: { type: dto.type, sizeBytes: inspected.bytes.length },
    });

    await this.sync(userId);
    return { documentId: document.id, type: document.type, uploadedAt: document.createdAt };
  }

  /**
   * Stage 3: the residential address, which must match the NIN record.
   *
   * When Monnify returned the record's address it is compared here and the
   * stage passes or fails at once. When it did not, the address waits for a
   * reviewer, who compares it with the uploaded NIN document.
   */
  async verifyAddress(userId: string, dto: VerifyAddressDto) {
    const facts = await readKycFacts(this.prisma, userId);
    if (completedLevel(facts) < 2) {
      throw stageRequired(2, 'Finish stage 2 (Identity) before verifying your address.');
    }
    if (facts.address === 'passed') throw new ConflictException('Your address is already verified');
    if (facts.address === 'pending') {
      throw new ConflictException('Your address is being reviewed. We will let you know.');
    }

    const kycProfile = await this.ensureKycProfile(userId);
    await this.assertAttemptsRemain(kycProfile.id, ['ADDRESS']);

    const ninCheck = await this.prisma.kycCheck.findFirst({
      where: { kycProfileId: kycProfile.id, type: { in: ['NIN', 'VNIN'] }, status: 'PASSED' },
      orderBy: { createdAt: 'desc' },
      select: { provider: true, resultSummary: true },
    });
    const registered = registeredAddressFrom(ninCheck?.resultSummary);
    const submitted: PostalAddress = {
      line: dto.addressLine,
      city: dto.city,
      lga: dto.lga ?? null,
      state: dto.state,
    };

    // Saved whatever the outcome: it is the person's address either way, and
    // the next attempt starts from it.
    await this.prisma.userProfile.update({
      where: { userId },
      data: { addressLine: dto.addressLine, city: dto.city, state: dto.state },
    });

    const comparison = isComparable(registered) ? compareAddresses(submitted, registered) : null;
    const status = comparison === null ? 'PENDING' : comparison.matches ? 'PASSED' : 'FAILED';
    const resultCode =
      comparison === null
        ? 'NO_ADDRESS_ON_RECORD'
        : comparison.matches
          ? 'MATCHED'
          : `MISMATCH_${comparison.reason}`;

    await this.prisma.kycCheck.create({
      data: {
        kycProfileId: kycProfile.id,
        type: 'ADDRESS',
        provider: ninCheck?.provider ?? 'manual',
        status,
        resultCode,
        resultSummary: { submitted: { ...submitted } },
        checkedAt: new Date(),
        ...(status === 'FAILED' ? { failureReason: resultCode } : {}),
      },
    });
    if (status === 'PENDING') {
      await this.prisma.kycProfile.update({
        where: { id: kycProfile.id },
        data: { status: 'REQUIRES_REVIEW', submittedAt: new Date() },
      });
    }

    await this.audit.record({
      action: `kyc.address.${status.toLowerCase()}`,
      subjectType: 'user',
      subjectId: userId,
      actorUserId: userId,
      metadata: { resultCode },
    });

    if (comparison && !comparison.matches) {
      throw new UnprocessableEntityException(ADDRESS_MISMATCH[comparison.reason]);
    }
    await this.sync(userId);
    return { status: status === 'PASSED' ? 'VERIFIED' : 'UNDER_REVIEW' };
  }

  /**
   * Writes the tier and level the evidence supports. Called after every change
   * to the evidence; access is still decided from the evidence itself, so this
   * only keeps reports and tier-reading code honest.
   */
  async sync(userId: string, known?: KycFacts): Promise<void> {
    const facts = known ?? (await readKycFacts(this.prisma, userId));
    const level = completedLevel(facts);
    const tier = tierForLevel(level);
    const existing = await this.prisma.kycProfile.findUnique({
      where: { userId },
      select: { id: true, tier: true, level: true, status: true },
    });
    if (!existing) {
      if (level === 0) return;
      await this.prisma.kycProfile.create({ data: { userId, tier, level } });
      return;
    }
    const verified = level === 3 && existing.status !== 'REQUIRES_REVIEW';
    if (
      existing.tier === tier &&
      existing.level === level &&
      (!verified || existing.status === 'VERIFIED')
    ) {
      return;
    }
    await this.prisma.kycProfile.update({
      where: { id: existing.id },
      data: {
        tier,
        level,
        ...(verified && existing.status !== 'VERIFIED'
          ? { status: 'VERIFIED', verifiedAt: new Date() }
          : {}),
      },
    });
    if (level > existing.level) {
      await this.audit.record({
        action: 'kyc.stage.completed',
        subjectType: 'user',
        subjectId: userId,
        metadata: { level: String(level), tier },
      });
    }
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
  private async assertAttemptsRemain(
    kycProfileId: string,
    types: ('BVN' | 'NIN' | 'VNIN' | 'ADDRESS')[] = ['BVN', 'NIN', 'VNIN'],
  ): Promise<void> {
    const since = new Date(Date.now() - IDENTITY_ATTEMPT_WINDOW_MS);
    const failures = await this.prisma.kycCheck.findMany({
      where: {
        kycProfileId,
        status: 'FAILED',
        type: { in: types },
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
