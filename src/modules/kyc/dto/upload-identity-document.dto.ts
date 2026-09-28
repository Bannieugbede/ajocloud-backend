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
  // Just under the 1 MiB body limit, so an oversized file gets this message
  // rather than a bare 413.
  @MaxLength(1_000_000)
  @IsBase64()
  data!: string;
}
