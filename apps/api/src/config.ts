import { z } from 'zod';

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    DATABASE_URL: z.string().min(1).default('./data/messaging-lab.sqlite'),
    REDIS_URL: z.url().default('redis://:messaging@localhost:6379'),
    KAFKA_BROKERS: z
      .string()
      .refine(
        hasValidKafkaBrokers,
        'Must contain comma-separated host:port pairs.',
      )
      .default('localhost:9092'),
    RABBITMQ_URL: z.url().default('amqp://messaging:messaging@localhost:5672'),
    RABBITMQ_MANAGEMENT_URL: z.url().default('http://localhost:15672'),
  })
  .strict();

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly kafkaBrokers: readonly string[];
  readonly rabbitMqUrl: string;
  readonly rabbitMqManagementUrl: string;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const parsed = environmentSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    API_HOST: environment.API_HOST,
    API_PORT: environment.API_PORT,
    DATABASE_URL: environment.DATABASE_URL,
    REDIS_URL: environment.REDIS_URL,
    KAFKA_BROKERS: environment.KAFKA_BROKERS,
    RABBITMQ_URL: environment.RABBITMQ_URL,
    RABBITMQ_MANAGEMENT_URL: environment.RABBITMQ_MANAGEMENT_URL,
  });
  const kafkaBrokers = parsed.KAFKA_BROKERS.split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    kafkaBrokers,
    rabbitMqUrl: parsed.RABBITMQ_URL,
    rabbitMqManagementUrl: parsed.RABBITMQ_MANAGEMENT_URL,
  };
}

function hasValidKafkaBrokers(value: string): boolean {
  const brokers = value
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  return (
    brokers.length > 0 &&
    brokers.every((broker) => {
      try {
        const url = new URL(`tcp://${broker}`);
        return Boolean(url.hostname && url.port);
      } catch {
        return false;
      }
    })
  );
}
