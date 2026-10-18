export interface GeminiSTTOptions {
  apiKey: string;
  model?: string;
}

export class GeminiSTTProvider {
  private apiKey: string;
  private model: string;

  constructor(options: GeminiSTTOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model || 'gemini-3.8-flash';
  }

  async transcribeAudio(wavBuffer: Buffer): Promise<string | null> {
    if (!this.apiKey) return null;

    const base64Audio = wavBuffer.toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Transcribe the spoken words verbatim. If the audio contains only silence, breathing, sighs, throat clearing, background clicks, or no clear human speech, return an empty string "". Do NOT describe noises or add commentary. Return ONLY the transcribed words with standard punctuation.'
            },
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: base64Audio
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 150
      }
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        console.error('[Gemini STT] API error:', res.status, await res.text());
        return null;
      }

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      if (!rawText || rawText.length === 0) return null;

      // Reject hallucinated sound descriptions, sighs, breaths, coughs, whispers
      const noisePattern = /(quiet\s+breath|breath|sigh|\*sigh\*|\[breath\]|\[sigh\]|\[silence\]|\[cough\]|throat\s*clear|gasp|whisper)/i;
      if (noisePattern.test(rawText) && rawText.length < 40) {
        return null;
      }

      // Reject non-alphanumeric noise strings or garbled unicode (require at least 2 alphanumeric characters)
      const alphanumericChars = rawText.match(/[a-zA-Z0-9]/g);
      if (!alphanumericChars || alphanumericChars.length < 2) {
        return null;
      }

      return rawText;
    } catch (err) {
      console.error('[Gemini STT] Network exception:', err);
      return null;
    }
  }
}
