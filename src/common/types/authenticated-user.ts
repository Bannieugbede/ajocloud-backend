export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
  readonly permissions: readonly string[];
}
