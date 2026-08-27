import type {
  BrokerId,
  ComparisonTrackId,
  RunStatus,
  ScenarioId,
  SuiteStatus,
} from '@messaging-lab/shared';

export const BROKER_LABELS: Record<BrokerId, string> = {
  redis: 'Redis',
  kafka: 'Kafka',
  rabbitmq: 'RabbitMQ',
};

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  'fan-out': 'Live fan-out',
  'competing-consumers': 'Competing consumers',
};

export const COMPARISON_TRACK_LABELS: Record<ComparisonTrackId, string> = {
  primary: 'Primary Kafka–RabbitMQ track',
  'adjacent-streaming': 'Adjacent Redis Streams track',
  'ephemeral-baseline': 'Ephemeral Redis Pub/Sub baseline',
};

export const STATUS_LABELS: Record<RunStatus | SuiteStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  'timed-out': 'Timed out',
  cancelled: 'Cancelled',
  stopped: 'Stopped',
};

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits }).format(value);
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
