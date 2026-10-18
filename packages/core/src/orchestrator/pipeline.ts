import { TranscriptChunk } from '../types/events';
import { isQuestionIntent } from '../context/intent-detector';

export interface ActiveRequest {
  requestId: string;
  question: string;
  controller: AbortController;
  signal: AbortSignal;
  createdAt: number;
}

export class OrchestrationPipeline {
  private activeRequest: ActiveRequest | null = null;
  private lastQuestionText: string = '';
  private lastQuestionTime: number = 0;

  getActiveRequestId(): string | null {
    return this.activeRequest?.requestId ?? null;
  }

  beginRequest(question: string): ActiveRequest {
    if (this.activeRequest) {
      this.activeRequest.controller.abort('preempted_by_new_request');
    }

    const controller = new AbortController();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.activeRequest = {
      requestId,
      question,
      controller,
      signal: controller.signal,
      createdAt: Date.now()
    };
    return this.activeRequest;
  }

  cancelActive(reason: string = 'user_cancelled'): void {
    if (this.activeRequest) {
      this.activeRequest.controller.abort(reason);
      this.activeRequest = null;
    }
  }

  processTranscriptChunk(chunk: TranscriptChunk): { shouldTriggerAnswer: boolean; question?: string } {
    if (!chunk.isFinal || chunk.speaker !== 'REMOTE_SPEAKER') {
      return { shouldTriggerAnswer: false };
    }

    const trimmed = chunk.text.trim();
    const now = Date.now();
    // 3000ms debounce and exact string deduplication
    if (trimmed === this.lastQuestionText && now - this.lastQuestionTime < 3000) {
      return { shouldTriggerAnswer: false };
    }

    if (isQuestionIntent(trimmed)) {
      this.lastQuestionText = trimmed;
      this.lastQuestionTime = now;
      return { shouldTriggerAnswer: true, question: trimmed };
    }

    return { shouldTriggerAnswer: false };
  }
}
