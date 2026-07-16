import { z } from 'zod';

const optionalUrl = z.union([z.url(), z.literal('')]).optional();

export const environmentSchema = z.object({
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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  DIRECT_DATABASE_URL: optionalUrl,
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
  PAYMENT_PROVIDER: z.enum(['mock', 'paystack', 'flutterwave']).default('mock'),
  KYC_PROVIDER: z.enum(['mock', 'dojah']).default('mock'),
  SMS_PROVIDER: z.string().default('mock'),
  PUSH_PROVIDER: z.string().default('mock'),
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  DOJA_APP_ID: z.string().optional(),
  DOJA_SECRET_KEY: z.string().optional(),
  SMTP_URL: optionalUrl,
  SMS_API_KEY: z.string().optional(),
  PUSH_API_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  ERROR_MONITORING_DSN: optionalUrl,
  SWAGGER_ENABLED: z.stringbool().default(true),
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
