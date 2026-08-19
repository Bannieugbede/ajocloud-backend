import { z } from 'zod';

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
    CORS_ALLOW_LOOPBACK: z.stringbool().default(false),
    // Browser sessions are carried in httpOnly cookies. When the web app is on a
    // different site than the API, cookies must be SameSite=None; Secure.
    SESSION_COOKIE_SAMESITE_NONE: z.stringbool().default(false),
    // Optional parent domain so one cookie covers app+api subdomains.
    SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),
    // Optional: only used to sign cookie values; tokens are already verified
    // server-side (JWT signature / hashed refresh token) without it.
    COOKIE_SECRET: z.string().min(32).optional(),
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
    PAYMENT_PROVIDER: z.enum(['mock', 'paystack', 'flutterwave', 'monnify']).default('mock'),
    BILL_PAYMENT_PROVIDER: z.enum(['mock', 'monnify']).default('mock'),
    KYC_PROVIDER: z.enum(['mock', 'monnify', 'dojah']).default('mock'),
    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    DEFAULT_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('NGN'),
    APPLICATION_TIMEZONE: z.string().min(1).default('Africa/Lagos'),
    SMS_PROVIDER: z.enum(['mock']).default('mock'),
    // Expo's push service accepts unauthenticated sends for tokens it issued, so
    // no access token is required for the default setup.
    PUSH_PROVIDER: z.enum(['mock', 'expo']).default('mock'),
    AWS_REGION: z.string().optional(),
    AWS_S3_BUCKET: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
    FLUTTERWAVE_SECRET_KEY: z.string().optional(),
    MONNIFY_BASE_URL: optionalUrl,
    MONNIFY_API_KEY: z.string().optional(),
    MONNIFY_SECRET_KEY: z.string().optional(),
    MONNIFY_CONTRACT_CODE: z.string().optional(),
    MONNIFY_WEBHOOK_SECRET: z.string().optional(),
    DOJAH_BASE_URL: optionalUrl,
    DOJAH_APP_ID: z.string().optional(),
    DOJAH_SECRET_KEY: z.string().optional(),
    RESEND_BASE_URL: optionalUrl,
    RESEND_API_KEY: z.string().optional(),
    RESEND_SENDER_EMAIL: optionalEmail,
    RESEND_SENDER_NAME: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    ERROR_MONITORING_DSN: optionalUrl,
    SWAGGER_ENABLED: z.stringbool().default(true),
  })
  .superRefine((environment, context) => {
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
    if (environment.KYC_PROVIDER === 'monnify') {
      for (const key of [
        'MONNIFY_BASE_URL',
        'MONNIFY_API_KEY',
        'MONNIFY_SECRET_KEY',
        'MONNIFY_CONTRACT_CODE',
      ] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for Monnify KYC`,
          });
        }
      }
    }
    if (environment.KYC_PROVIDER === 'dojah') {
      for (const key of ['DOJAH_BASE_URL', 'DOJAH_APP_ID', 'DOJAH_SECRET_KEY'] as const) {
        if (!environment[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for Dojah`,
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
