import { describe, it, expect } from 'vitest';
import { TranscriptReconciler } from '../src/audio/transcript-reconciler';

describe('TranscriptReconciler', () => {
  it('correctly passes remote speech and clean user speech without false echo tagging', () => {
    const reconciler = new TranscriptReconciler();

    // 1. Remote speaker speech
    const remote = reconciler.processTranscript(
      'REMOTE_SPEAKER',
      'Explain how Kafka partition reassignment works.',
      1000,
      3000
    );
    expect(remote.speaker).toBe('REMOTE_SPEAKER');
    expect(remote.isProbableEcho).toBe(false);

    // 2. User answering independently
    const user = reconciler.processTranscript(
      'USER',
      'Kafka uses the controller broker to coordinate partition moves.',
      4000,
      7000
    );
    expect(user.speaker).toBe('USER');
    expect(user.isProbableEcho).toBe(false);
  });

  it('detects acoustic room echo when mic transcribes remote speaker question within time window', () => {
    const reconciler = new TranscriptReconciler();

    // Remote asks question in Google Meet
    reconciler.processTranscript(
      'REMOTE_SPEAKER',
      "What is the difference between Postgres and MongoDB?",
      10000,
      13000
    );

    // Mic picks up room acoustic reflection of laptop speakers 400ms later
    const echo = reconciler.processTranscript(
      'USER',
      "What's the difference between Postgres and MongoDB?",
      10400,
      13400
    );

    expect(echo.speaker).toBe('USER');
    expect(echo.isProbableEcho).toBe(true);
  });

  it('preserves user barge-in speech with different text during remote playback', () => {
    const reconciler = new TranscriptReconciler();

    reconciler.processTranscript(
      'REMOTE_SPEAKER',
      'Let us review the Q3 system metrics and latency percentiles.',
      20000,
      24000
    );

    // User interrupts with a completely different sentence
    const bargeIn = reconciler.processTranscript(
      'USER',
      'Wait, can I ask a quick clarification on the database connection pool?',
      21000,
      25000
    );

    expect(bargeIn.speaker).toBe('USER');
    expect(bargeIn.isProbableEcho).toBe(false);
  });

  it('does not treat user repetition as echo once the time window has expired', () => {
    const reconciler = new TranscriptReconciler();

    reconciler.processTranscript(
      'REMOTE_SPEAKER',
      'What is your experience with Kubernetes?',
      10000,
      12000
    );

    // User repeats question 15 seconds later
    const laterUserSpeech = reconciler.processTranscript(
      'USER',
      'What is your experience with Kubernetes?',
      27000,
      29000
    );

    expect(laterUserSpeech.isProbableEcho).toBe(false);
  });
});
