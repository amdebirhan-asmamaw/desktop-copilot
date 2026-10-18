import { TranscriptEvent } from '../types';

export interface DeepgramSessionConfig {
  apiKey: string;
  speaker: 'USER' | 'REMOTE_SPEAKER';
  model?: string;
  sampleRate?: number;
  onInterim: (text: string, speaker: 'USER' | 'REMOTE_SPEAKER') => void;
  onFinalUtterance: (event: TranscriptEvent) => void;
  onError?: (err: Error) => void;
  onStatusChange?: (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED') => void;
}

export class DeepgramStreamingSession {
  private ws: any = null;
  private currentUtteranceSegments: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private isExplicitlyClosed = false;
  private keepAliveInterval: any = null;

  constructor(private config: DeepgramSessionConfig) {}

  connect(): void {
    if (this.isExplicitlyClosed || !this.config.apiKey) return;
    this.config.onStatusChange?.('CONNECTING');

    const params = new URLSearchParams({
      model: this.config.model || 'nova-2',
      encoding: 'linear16',
      sample_rate: String(this.config.sampleRate || 16000),
      channels: '1',
      punctuate: 'true',
      interim_results: 'true',
      smart_format: 'true',
      endpointing: '300',
      utterance_end_ms: '1000'
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    try {
      const WebSocketClass = typeof globalThis.WebSocket !== 'undefined' ? globalThis.WebSocket : null;
      if (!WebSocketClass) {
        throw new Error('WebSocket is not supported in this runtime');
      }

      // In browser/Electron standard WebSocket, auth token is sent via Sec-WebSocket-Protocol
      this.ws = new WebSocketClass(url, ['token', this.config.apiKey]);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.config.onStatusChange?.('CONNECTED');
        this.startKeepAlive();
      };

      this.ws.onmessage = (event: any) => {
        const dataStr = typeof event.data === 'string' ? event.data : event.data?.toString();
        if (dataStr) {
          this.handleServerMessage(dataStr);
        }
      };

      this.ws.onclose = () => {
        this.stopKeepAlive();
        this.config.onStatusChange?.('DISCONNECTED');
        if (!this.isExplicitlyClosed) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (err: any) => {
        const error = err instanceof Error ? err : new Error(String(err?.message || 'Deepgram WebSocket error'));
        this.config.onError?.(error);
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.config.onError?.(error);
      this.config.onStatusChange?.('FAILED');
    }
  }

  sendAudio(pcmChunk: ArrayBuffer | ArrayBufferView): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(pcmChunk);
    }
  }

  handleServerMessage(jsonStr: string): void {
    try {
      const msg = JSON.parse(jsonStr);

      if (msg.type === 'UtteranceEnd') {
        this.flushUtterance();
        return;
      }

      const alt = msg.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (!text) return;

      if (!msg.is_final) {
        // Interim guess -> send to HUD ticker only
        this.config.onInterim(text, this.config.speaker);
      } else {
        // Segment locked -> accumulate
        this.currentUtteranceSegments.push(text);
        if (msg.speech_final) {
          this.flushUtterance();
        }
      }
    } catch (err) {
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  flushUtterance(): void {
    if (this.currentUtteranceSegments.length === 0) return;
    const fullText = this.currentUtteranceSegments.join(' ').trim();
    this.currentUtteranceSegments = [];
    if (fullText.length > 0) {
      this.config.onFinalUtterance({
        text: fullText,
        speaker: this.config.speaker,
        isFinal: true,
        timestamp: Date.now()
      });
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.config.onStatusChange?.('FAILED');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts) * 500;
    setTimeout(() => this.connect(), delay);
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1 /* OPEN */) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 8000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  close(): void {
    this.isExplicitlyClosed = true;
    this.stopKeepAlive();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}
