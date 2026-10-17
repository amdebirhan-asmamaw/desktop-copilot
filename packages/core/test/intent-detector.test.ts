import { describe, it, expect } from 'vitest';
import { isQuestionIntent } from '../src/context/intent-detector';

describe('Question Intent Detector', () => {
  it('identifies questions addressed to the user', () => {
    expect(isQuestionIntent('Can you describe your experience with Kubernetes?')).toBe(true);
    expect(isQuestionIntent('How would you scale this database write throughput?')).toBe(true);
    expect(isQuestionIntent('What is your expected salary?')).toBe(true);
    expect(isQuestionIntent('Yeah that makes total sense.')).toBe(false);
  });
});
