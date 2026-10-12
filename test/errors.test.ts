import { describe, expect, it } from 'vitest';
import { describeGoogleError } from '../src/lib/errors.js';

describe('describeGoogleError', () => {
  it('reads status and message out of a Gaxios-shaped error', () => {
    const err = Object.assign(new Error('Request failed with status code 403'), {
      status: 403,
      response: { status: 403, data: { error: { message: 'The caller does not have permission' } } },
    });
    expect(describeGoogleError(err)).toEqual({
      status: 403,
      message: 'The caller does not have permission',
    });
  });

  it('falls back to the error message when Google sends no structured body', () => {
    expect(describeGoogleError(Object.assign(new Error('boom'), { status: 500 }))).toEqual({
      status: 500,
      message: 'boom',
    });
  });

  it('accepts a string code, as googleapis sometimes sets', () => {
    expect(describeGoogleError(Object.assign(new Error('nope'), { code: '404' }))?.status).toBe(404);
  });

  it('ignores anything that is not an HTTP failure', () => {
    expect(describeGoogleError(new Error('plain'))).toBeUndefined();
    expect(describeGoogleError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toBeUndefined();
    expect(describeGoogleError(Object.assign(new Error('x'), { status: 200 }))).toBeUndefined();
    expect(describeGoogleError(undefined)).toBeUndefined();
    expect(describeGoogleError('a string')).toBeUndefined();
  });
});
