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
              text: 'Transcribe the spoken audio verbatim. Return ONLY the transcribed sentence with appropriate punctuation. Do not add any preamble, quotes, commentary, or markdown.'
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
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      return text;
    } catch (err) {
      console.error('[Gemini STT] Network exception:', err);
      return null;
    }
  }
}
