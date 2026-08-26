export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}
