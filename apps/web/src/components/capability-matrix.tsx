import {
  BROKER_CAPABILITIES,
  BROKER_IDS,
  type ScenarioId,
} from '@messaging-lab/shared';

import { BROKER_LABELS } from '../format.js';

export function CapabilityMatrix() {
  return (
    <section className="section-block" aria-labelledby="capability-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Semantics before speed</p>
          <h2 id="capability-heading">Capability matrix</h2>
        </div>
        <p>
          Similar-looking patterns carry different durability and replay
          guarantees.
        </p>
      </div>
      <div className="table-scroll capability-table">
        <table>
          <thead>
            <tr>
              <th>Broker / pattern</th>
              <th>Persistence</th>
              <th>Acks</th>
              <th>Recovery</th>
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            {BROKER_IDS.flatMap((broker) =>
              (['fan-out', 'competing-consumers'] as const).map((scenario) => (
                <CapabilityRow
                  broker={broker}
                  scenario={scenario}
                  key={`${broker}-${scenario}`}
                />
              )),
            )}
          </tbody>
        </table>
      </div>
      <div className="education-grid">
        <article>
          <span>01</span>
          <h3>Fan-out is not identical</h3>
          <p>
            Redis publishes live only. Kafka uses independent consumer groups.
            RabbitMQ binds one queue per subscriber.
          </p>
        </article>
        <article>
          <span>02</span>
          <h3>Replay depends on retention</h3>
          <p>
            Streams and Kafka retain ordered records. RabbitMQ removes
            acknowledged messages, so arbitrary log replay is unavailable.
          </p>
        </article>
        <article>
          <span>03</span>
          <h3>Benchmarks are local evidence</h3>
          <p>
            Compare behavior on this machine—not universal broker rankings.
            Configuration and workload shape every result.
          </p>
        </article>
      </div>
    </section>
  );
}

function CapabilityRow({
  broker,
  scenario,
}: {
  readonly broker: keyof typeof BROKER_CAPABILITIES;
  readonly scenario: ScenarioId;
}) {
  const capability = BROKER_CAPABILITIES[broker][scenario];
  return (
    <tr>
      <th>
        <strong>{BROKER_LABELS[broker]}</strong>
        <span>{scenario === 'fan-out' ? 'Fan-out' : 'Competing'}</span>
      </th>
      <Capability value={capability.persistence} />
      <Capability value={capability.acknowledgements} />
      <Capability value={capability.consumerRecovery} />
      <Capability value={capability.replay} />
    </tr>
  );
}

function Capability({ value }: { readonly value: boolean }) {
  return (
    <td>
      <span
        className={value ? 'capability-yes' : 'capability-no'}
        aria-label={value ? 'Supported' : 'Unsupported'}
      >
        {value ? '✓' : '—'}
      </span>
    </td>
  );
}
