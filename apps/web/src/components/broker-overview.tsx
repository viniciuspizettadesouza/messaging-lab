import type { BrokerInfo } from '@messaging-lab/shared';

import { BROKER_LABELS } from '../format.js';

export function BrokerOverview({
  brokers,
}: {
  readonly brokers: BrokerInfo[];
}) {
  return (
    <section className="section-block" aria-labelledby="broker-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Local infrastructure</p>
          <h2 id="broker-heading">Broker health</h2>
        </div>
        <p>
          Protocol-level checks from the API, refreshed when the dashboard
          loads.
        </p>
      </div>
      <div className="broker-grid">
        {brokers.map((broker) => (
          <article className="broker-card" key={broker.id}>
            <div className="broker-title">
              <span
                className={`broker-mark broker-${broker.id}`}
                aria-hidden="true"
              >
                {BROKER_LABELS[broker.id].slice(0, 1)}
              </span>
              <div>
                <h3>{BROKER_LABELS[broker.id]}</h3>
                <span className={`health health-${broker.health.status}`}>
                  <span aria-hidden="true" />
                  {broker.health.status}
                </span>
              </div>
            </div>
            <dl className="compact-stats">
              <div>
                <dt>Latency</dt>
                <dd>
                  {broker.health.latencyMs === null
                    ? '—'
                    : `${broker.health.latencyMs.toFixed(1)} ms`}
                </dd>
              </div>
              <div>
                <dt>Patterns</dt>
                <dd>
                  {
                    Object.values(broker.capabilities).filter(
                      ({ supported }) => supported,
                    ).length
                  }
                  /2
                </dd>
              </div>
            </dl>
            {broker.health.error ? (
              <p className="inline-error">{broker.health.error}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
