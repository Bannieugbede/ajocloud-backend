import { z } from 'zod';

/** Treats a blank value as unset: deployment UIs commonly pass empty strings. */
const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const optionalUrl = z.union([z.url(), z.literal('')]).optional();
const optionalEmail = z.union([z.email(), z.literal('')]).optional();

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().min(1).default('Ajo Cloud API'),
    APP_VERSION: z.string().min(1).default('0.1.0'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    API_PREFIX: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .default('api'),
    CORS_ORIGINS: z.string().min(1),
    // Allow http(s)://localhost:<any port> so local web/dev clients need no
    // redeploy to change port. Ignored when NODE_ENV=production.
    CORS_ALLOW_LOOPBACK: blankAsUndefined(z.stringbool()).pipe(z.boolean().default(false)),
    // Browser sessions are carried in httpOnly cookies. When the web app is on a
    // different site than the API, cookies must be SameSite=None; Secure.
    SESSION_COOKIE_SAMESITE_NONE: blankAsUndefined(z.stringbool()).pipe(z.boolean().default(false)),
    // Optional parent domain so one cookie covers app+api subdomains.
    SESSION_COOKIE_DOMAIN: blankAsUndefined(z.string().min(1)),
    // Optional: only used to sign cookie values; tokens are already verified
    // server-side (JWT signature / hashed refresh token) without it.
    COOKIE_SECRET: blankAsUndefined(z.string().min(32)),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    RABBITMQ_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z
      .string()
      .regex(/^\d+[smhd]$/)
      .default('15m'),
    TOKEN_PEPPER: z.string().min(32),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
    PAYMENT_PROVIDER: z.enum(['mock', 'monnify']).default('mock'),
    BILL_PAYMENT_PROVIDER: z.enum(['mock', 'monnify']).default('mock'),
    KYC_PROVIDER: z.enum(['mock', 'monnify']).default('mock'),
    // Accept Monnify webhooks. Requires MONNIFY_WEBHOOK_SECRET: the signature
    // check is the only thing standing between a public URL and a money
    // instruction, so there is deliberately no way to run these routes without
    // it. See ADR-006.
    MONNIFY_WEBHOOKS_ENABLED: z.stringbool().default(false),
    // Let a sandbox-limited verification failure fall back to the mock provider
    // so mobile testing is not blocked by test keys. Rejected outright in
    // production by the refinement below.
    KYC_SANDBOX_FALLBACK: z.stringbool().default(false),
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    // Google sign-in. Unset disables the provider; the routes then return 404.
    GOOGLE_CLIENT_ID: blankAsUndefined(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: blankAsUndefined(z.string().min(1)),
    // Absolute callback URL registered in the Google console, e.g.
    // https://api.mirumversal.com/api/v1/auth/google/callback
    GOOGLE_CALLBACK_URL: blankAsUndefined(z.url()),
    // Where the browser lands after a successful web sign-in.
    GOOGLE_WEB_SUCCESS_URL: blankAsUndefined(z.url()),
    // Mobile deep link, e.g. ajocloud://auth/google. Only these two targets are
    // ever redirected to, so the callback cannot be pointed at an open redirect.
    GOOGLE_MOBILE_SUCCESS_URL: blankAsUndefined(z.string().min(1)),
    DEFAULT_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('NGN'),
    APPLICATION_TIMEZONE: z.string().min(1).default('Africa/Lagos'),
    // Expo's push service accepts unauthenticated sends for tokens it issued, so
    // no access token is required for the default setup.
    PUSH_PROVIDER: z.enum(['mock', 'expo']).default('mock'),
    AWS_REGION: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    MONNIFY_BASE_URL: optionalUrl,
    MONNIFY_API_KEY: z.string().optional(),
    MONNIFY_SECRET_KEY: z.string().optional(),
    MONNIFY_CONTRACT_CODE: z.string().optional(),
    MONNIFY_WEBHOOK_SECRET: z.string().optional(),
    RESEND_BASE_URL: optionalUrl,
    RESEND_API_KEY: z.string().optional(),
    RESEND_SENDER_EMAIL: optionalEmail,
    RESEND_SENDER_NAME: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    ERROR_MONITORING_DSN: optionalUrl,
    SWAGGER_ENABLED: z.stringbool().default(true),
  })
  .superRefine((environment, context) => {
    const googleKeys = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_CALLBACK_URL',
      'GOOGLE_WEB_SUCCESS_URL',
    ] as const;
    if (googleKeys.some((key) => environment[key])) {
      for (const key of googleKeys) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when Google sign-in is configured`,
          });
        }
      }
    }
    if (environment.EMAIL_PROVIDER === 'resend') {
      for (const key of ['RESEND_API_KEY', 'RESEND_SENDER_EMAIL'] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for Resend`,
          });
        }
      }
    }
    if (environment.BILL_PAYMENT_PROVIDER === 'monnify') {
      for (const key of [
        'MONNIFY_BASE_URL',
        'MONNIFY_API_KEY',
        'MONNIFY_SECRET_KEY',
        'MONNIFY_CONTRACT_CODE',
        'MONNIFY_WEBHOOK_SECRET',
      ] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for Monnify`,
          });
        }
      }
    }
    if (environment.MONNIFY_WEBHOOKS_ENABLED && !environment.MONNIFY_WEBHOOK_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['MONNIFY_WEBHOOK_SECRET'],
        message:
          'MONNIFY_WEBHOOK_SECRET is required when MONNIFY_WEBHOOKS_ENABLED is true; webhooks are never accepted unverified',
      });
    }
    // A sandbox fallback marks identities verified without a real check. It is
    // a test affordance, and must not be reachable in production at all.
    if (environment.KYC_SANDBOX_FALLBACK && environment.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['KYC_SANDBOX_FALLBACK'],
        message: 'KYC_SANDBOX_FALLBACK must not be enabled in production',
      });
    }
    if (environment.KYC_PROVIDER === 'monnify') {
      // Verification authenticates with the API key/secret pair only. The
      // contract code scopes payment collection and payouts, not identity
      // lookups, so requiring it here would block a verification-only setup.
      for (const key of ['MONNIFY_BASE_URL', 'MONNIFY_API_KEY', 'MONNIFY_SECRET_KEY'] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for Monnify KYC`,
          });
        }
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration: ${messages.join('; ')}`);
  }
  return result.data;
}
