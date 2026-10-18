import { describe, it, expect, vi } from 'vitest';
import { OrchestrationPipeline } from '../src/orchestrator/pipeline';

describe('OrchestrationPipeline', () => {
  it('preempts earlier in-flight requests when a new question arrives', async () => {
    const pipeline = new OrchestrationPipeline();
    const abortSpy = vi.fn();

    const req1 = pipeline.beginRequest('How does Raft handle leader election?');
    req1.signal.addEventListener('abort', abortSpy);

    expect(pipeline.getActiveRequestId()).toBe(req1.requestId);

    const req2 = pipeline.beginRequest('Explain Paxos instead.');
    expect(abortSpy).toHaveBeenCalled();
    expect(pipeline.getActiveRequestId()).toBe(req2.requestId);
  });

  it('rejects partial transcript triggers and only accepts final transcripts', () => {
    const pipeline = new OrchestrationPipeline();
    const resultPartial = pipeline.processTranscriptChunk({
      text: 'What is the',
      isFinal: false,
      speaker: 'REMOTE_SPEAKER',
      timestamp: Date.now()
    });
    expect(resultPartial.shouldTriggerAnswer).toBe(false);

    const resultFinal = pipeline.processTranscriptChunk({
      text: 'What is the CAP theorem?',
      isFinal: true,
      speaker: 'REMOTE_SPEAKER',
      timestamp: Date.now()
    });
    expect(resultFinal.shouldTriggerAnswer).toBe(true);
    expect(resultFinal.question).toBe('What is the CAP theorem?');
  });

  it('ignores candidate microphone speech from triggering questions', () => {
    const pipeline = new OrchestrationPipeline();
    const resultUser = pipeline.processTranscriptChunk({
      text: 'What is our plan for this quarter?',
      isFinal: true,
      speaker: 'USER',
      timestamp: Date.now()
    });
    expect(resultUser.shouldTriggerAnswer).toBe(false);
  });

  it('deduplicates identical questions within debounce window', () => {
    const pipeline = new OrchestrationPipeline();
    const first = pipeline.processTranscriptChunk({
      text: 'How does Kafka guarantee message ordering?',
      isFinal: true,
      speaker: 'REMOTE_SPEAKER',
      timestamp: Date.now()
    });
    expect(first.shouldTriggerAnswer).toBe(true);

    const duplicate = pipeline.processTranscriptChunk({
      text: 'How does Kafka guarantee message ordering?',
      isFinal: true,
      speaker: 'REMOTE_SPEAKER',
      timestamp: Date.now() + 500
    });
    expect(duplicate.shouldTriggerAnswer).toBe(false);
  });

  it('cancels active request when cancelActive is invoked', () => {
    const pipeline = new OrchestrationPipeline();
    const abortSpy = vi.fn();
    const req = pipeline.beginRequest('Explain database sharding');
    req.signal.addEventListener('abort', abortSpy);

    pipeline.cancelActive('user_dismissed');
    expect(abortSpy).toHaveBeenCalled();
    expect(pipeline.getActiveRequestId()).toBeNull();
  });
});
