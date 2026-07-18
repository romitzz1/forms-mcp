// ABOUTME: Unit tests for the platform-tolerant error-detail extractor
// ABOUTME: Verifies message/code are recovered even when `instanceof Error` is false

import { getErrorInfo } from '../../utils/errorInfo';

describe('getErrorInfo', () => {
  it('extracts message and code from a real Error with a code', () => {
    const err = Object.assign(new Error('unable to open database file'), { code: 'SQLITE_CANTOPEN' });
    expect(getErrorInfo(err)).toEqual({ message: 'unable to open database file', code: 'SQLITE_CANTOPEN' });
  });

  it('extracts message from a plain Error (no code)', () => {
    expect(getErrorInfo(new Error('boom'))).toEqual({ message: 'boom' });
  });

  // The reason this helper exists: on some platforms/native builds a thrown
  // better-sqlite3 error does not satisfy `instanceof Error`, yet still carries
  // string `message`/`code` own-properties. The extractor must recover them.
  it('recovers message and code from a non-Error object (instanceof Error === false)', () => {
    const notAnError = { message: 'UNIQUE constraint failed: forms.id', code: 'SQLITE_CONSTRAINT_PRIMARYKEY' };
    expect(notAnError instanceof Error).toBe(false);
    expect(getErrorInfo(notAnError)).toEqual({
      message: 'UNIQUE constraint failed: forms.id',
      code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
    });
  });

  it('omits code when it is not a string', () => {
    expect(getErrorInfo({ message: 'x', code: 19 })).toEqual({ message: 'x' });
  });

  it('falls back to "Unknown error" when there is no usable message', () => {
    expect(getErrorInfo(null)).toEqual({ message: 'Unknown error' });
    expect(getErrorInfo(undefined)).toEqual({ message: 'Unknown error' });
    expect(getErrorInfo(42)).toEqual({ message: 'Unknown error' });
    expect(getErrorInfo({ code: 'SQLITE_X' })).toEqual({ message: 'Unknown error', code: 'SQLITE_X' });
  });

  it('uses a plain string thrown value as the message', () => {
    expect(getErrorInfo('raw string error')).toEqual({ message: 'raw string error' });
  });
});
