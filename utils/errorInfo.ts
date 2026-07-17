// ABOUTME: Platform-tolerant extraction of message/code from thrown values
// ABOUTME: Recovers details even when a native error fails `instanceof Error`

export interface IErrorInfo {
  message: string;
  code?: string;
}

/**
 * Extract a human-readable message and (optional) error code from an unknown
 * thrown value.
 *
 * This deliberately does NOT gate on `instanceof Error`: on some platforms and
 * native-module builds a thrown better-sqlite3 error does not satisfy
 * `instanceof Error` (a realm/prototype-identity quirk), yet still carries
 * string `message`/`code` own-properties. Reading those properties directly
 * keeps error classification working across platforms rather than collapsing
 * everything to "Unknown error".
 */
export function getErrorInfo(error: unknown): IErrorInfo {
  if (typeof error === 'string') {
    return { message: error };
  }

  let message = 'Unknown error';
  let code: string | undefined;

  if (typeof error === 'object' && error !== null) {
    const record = error as { message?: unknown; code?: unknown };
    if (typeof record.message === 'string' && record.message.length > 0) {
      message = record.message;
    }
    if (typeof record.code === 'string') {
      code = record.code;
    }
  }

  return code === undefined ? { message } : { message, code };
}
