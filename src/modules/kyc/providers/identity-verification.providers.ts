export interface VerificationResult {
  readonly provider: string;
  readonly providerReference: string;
  readonly passed: boolean;
  readonly resultCode: string;
  readonly maskedIdentifier?: string;
  readonly riskFlags: readonly string[];
}

export interface BvnVerificationProvider {
  verifyBvn(input: {
    bvn: string;
    legalName: string;
    dateOfBirth?: string;
  }): Promise<VerificationResult>;
}

export interface NinVerificationProvider {
  verifyNin(input: { ninOrVnin: string; legalName: string }): Promise<VerificationResult>;
}

export interface BankAccountInquiryProvider {
  inquire(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<VerificationResult & { accountName?: string }>;
}

export interface FaceMatchProvider {
  matchFace(input: {
    identityReference: string;
    encryptedMediaReference: string;
  }): Promise<VerificationResult>;
}

export interface LivenessProvider {
  checkLiveness(input: { encryptedMediaReference: string }): Promise<VerificationResult>;
}

export interface AddressVerificationProvider {
  verifyAddress(input: {
    address: Record<string, string>;
    evidenceReference?: string;
  }): Promise<VerificationResult>;
}
