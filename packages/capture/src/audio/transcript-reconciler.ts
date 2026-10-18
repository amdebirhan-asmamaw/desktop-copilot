export interface ReconciledTranscript {
  speaker: 'USER' | 'REMOTE_SPEAKER';
  text: string;
  isProbableEcho: boolean;
  audioStartMs: number;
  audioEndMs: number;
}

export class TranscriptReconciler {
  private recentRemoteEntries: Array<{ text: string; audioStartMs: number; audioEndMs: number }> = [];
  private readonly maxOverlapWindowMs = 3500; // 3.5 seconds

  processTranscript(
    speaker: 'USER' | 'REMOTE_SPEAKER',
    text: string,
    audioStartMs: number,
    audioEndMs: number
  ): ReconciledTranscript {
    const cleanText = text.trim();

    // 1. Prune remote entries older than observation window relative to speech start
    this.recentRemoteEntries = this.recentRemoteEntries.filter(
      (entry) => audioStartMs - entry.audioStartMs < this.maxOverlapWindowMs
    );

    if (speaker === 'REMOTE_SPEAKER') {
      this.recentRemoteEntries.push({
        text: this.normalizeText(cleanText),
        audioStartMs,
        audioEndMs
      });
      return { speaker, text: cleanText, isProbableEcho: false, audioStartMs, audioEndMs };
    }

    // 2. speaker === 'USER': Check if this overlaps in time AND text similarity
    const normalizedUser = this.normalizeText(cleanText);
    const isProbableEcho = this.recentRemoteEntries.some((remote) => {
      // Must overlap in time (within 3.5s of remote speech)
      const timeDiff = Math.abs(audioStartMs - remote.audioStartMs);
      if (timeDiff > this.maxOverlapWindowMs) return false;

      // Must have high text similarity (token overlap >= 0.70)
      const similarity = this.calculateSimilarity(normalizedUser, remote.text);
      return similarity >= 0.70;
    });

    return {
      speaker,
      text: cleanText,
      isProbableEcho,
      audioStartMs,
      audioEndMs
    };
  }

  normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;
    const words1 = str1.split(' ').filter(Boolean);
    const words2 = new Set(str2.split(' ').filter(Boolean));
    if (words1.length === 0 || words2.size === 0) return 0.0;
    const matches = words1.filter((w) => words2.has(w)).length;
    return (2.0 * matches) / (words1.length + words2.size);
  }
}
