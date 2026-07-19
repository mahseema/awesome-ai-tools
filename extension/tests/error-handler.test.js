import './setup/chrome-mock.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiBookmarksError,
  ERROR_CODES,
  isRetryable,
  httpStatusToErrorCode,
} from '../shared/error-handler.js';

describe('AiBookmarksError', () => {
  test('carries code and details', () => {
    const err = new AiBookmarksError('boom', ERROR_CODES.API_SERVER, { status: 502 });
    assert.equal(err.message, 'boom');
    assert.equal(err.code, ERROR_CODES.API_SERVER);
    assert.equal(err.details.status, 502);
    assert.ok(err instanceof Error);
  });
});

describe('isRetryable', () => {
  test('auth, no-key, and parse errors are terminal', () => {
    for (const code of [ERROR_CODES.API_AUTH, ERROR_CODES.API_NO_KEY, ERROR_CODES.API_PARSE]) {
      assert.equal(isRetryable(new AiBookmarksError('x', code)), false, code);
    }
  });

  test('rate-limit, server, and network errors are retryable', () => {
    for (const code of [ERROR_CODES.API_RATE_LIMIT, ERROR_CODES.API_SERVER, ERROR_CODES.API_NETWORK]) {
      assert.equal(isRetryable(new AiBookmarksError('x', code)), true, code);
    }
  });

  test('plain Errors default to retryable', () => {
    assert.equal(isRetryable(new Error('generic')), true);
  });
});

describe('httpStatusToErrorCode', () => {
  test('maps statuses to error codes', () => {
    assert.equal(httpStatusToErrorCode(401), ERROR_CODES.API_AUTH);
    assert.equal(httpStatusToErrorCode(429), ERROR_CODES.API_RATE_LIMIT);
    assert.equal(httpStatusToErrorCode(500), ERROR_CODES.API_SERVER);
    assert.equal(httpStatusToErrorCode(503), ERROR_CODES.API_SERVER);
  });
});
