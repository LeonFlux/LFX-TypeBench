import { type Capability, type Decision, type Model, optionsOf, type Transport } from '../../src/index.ts';
import { uniformDistribution } from '../fixtures/results.ts';
import { fakeTransport } from './fake-transport.ts';

type FakeModelOptions = { capabilities?: Capability[]; transport?: Transport };

export function fakeModel(options: FakeModelOptions = {}): Model {
  const transport = options.transport ?? fakeTransport();
  const model: Model = {
    id: 'fake-model',
    version: '2026-10-01',
    capabilities: options.capabilities ?? [],
    transport,
    async decide(decision: Decision) {
      const reply = await transport.send({ model: model.id, messages: [{ role: 'user', content: 'decide' }] });
      const answers = decision.questions.map((question) => {
        const questionOptions = optionsOf(question);
        return {
          questionId: question.id,
          choice: questionOptions[0],
          distribution: uniformDistribution(questionOptions),
        };
      });
      return {
        status: 'ok',
        model: { id: model.id, version: model.version },
        transport: { id: transport.id },
        answers,
        latencyMs: reply.latencyMs,
        costUsd: reply.costUsd,
      };
    },
  };
  return model;
}
