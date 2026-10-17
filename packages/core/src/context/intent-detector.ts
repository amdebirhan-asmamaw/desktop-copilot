const QUESTION_PATTERNS = [
  /^(how|what|why|when|where|who|can you|could you|would you|have you|tell me about)/i,
  /\?$/
];

export function isQuestionIntent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;
  return QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed));
}
