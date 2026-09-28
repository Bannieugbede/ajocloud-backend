import { IsBase64, IsIn, IsString, MaxLength } from 'class-validator';
import { NIN_DOCUMENT_TYPES, type NinDocumentType } from '../kyc-facts.js';

/**
 * Stage 2's NIN document, sent as base64 in JSON: the app has no multipart
 * stack and the file is small once the phone has compressed it. The bytes are
 * checked against the declared type in the service.
 */
export class UploadIdentityDocumentDto {
  @IsIn(NIN_DOCUMENT_TYPES)
  type!: NinDocumentType;

  @IsIn(['image/jpeg', 'image/png', 'application/pdf'])
  contentType!: string;

  @IsString()
  // Base64 of the 1.5 MiB document limit, inside the 2.5 MiB body limit.
  @MaxLength(2_200_000)
  @IsBase64()
  data!: string;
}
