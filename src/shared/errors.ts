export class ThreadsError extends Error {}

export function safeMessage(error: unknown): string {
  return error instanceof ThreadsError
    ? error.message
    : 'The operation failed. Check your connection and retry. Completed transfers are retained.';
}
