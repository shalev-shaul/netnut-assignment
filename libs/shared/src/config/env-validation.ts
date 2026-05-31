import { z } from 'zod';

export const portSchema = z.coerce.number().int().min(1).max(65535);

export const databaseEnvSchema = {
  DB_HOST: z.string().min(1),
  DB_PORT: portSchema,
  DB_USER: z.string().min(1),
  DB_PASS: z.string().min(1),
  DB_NAME: z.string().min(1),
};

export const redisEnvSchema = {
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: portSchema,
};

export function createEnvValidator<T extends z.ZodRawShape>(shape: T) {
  const schema = z.object(shape).passthrough();
  return (config: Record<string, unknown>) => {
    const result = schema.safeParse(config);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    return result.data;
  };
}
