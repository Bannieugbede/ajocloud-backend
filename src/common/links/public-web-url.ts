/**
 * The public website's origin, for links sent to people: ajocloud.com, not the
 * API and not the admin console.
 *
 * Read from ADMIN_WEB_URL, which is the site root despite its name (see
 * env.schema.ts). A trailing "/admin" is stripped rather than trusted, because
 * the name has already led to it being set that way, and a shared link under
 * /admin lands a stranger on a sign-in wall.
 */
export function publicWebUrl(adminWebUrl: string): string {
  return adminWebUrl.replace(/\/+$/, '').replace(/\/admin$/, '');
}
