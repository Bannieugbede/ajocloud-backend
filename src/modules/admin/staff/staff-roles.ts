/**
 * Roles a staff invitation may grant. Every other role in the system is either
 * a customer-facing role (MEMBER, GROUP_ADMIN, FOOD_COORDINATOR) or the
 * unrestricted SUPER_ADMIN, which is deliberately not grantable over email:
 * the highest privilege in the platform should not be one leaked mailbox away.
 *
 * Kept apart from the service so the DTO can validate against it without the
 * two importing each other.
 */
export const INVITABLE_ROLES = [
  'PLATFORM_ADMIN',
  'COMPLIANCE_OFFICER',
  'FINANCE_OFFICER',
  'SUPPORT_OFFICER',
] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** "COMPLIANCE_OFFICER" → "Compliance Officer", for email and UI copy. */
export function humaniseRole(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
