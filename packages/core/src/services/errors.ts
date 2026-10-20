const UNKNOWN_ERROR = 'Unknown error';

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === '' ? UNKNOWN_ERROR : message;
}
