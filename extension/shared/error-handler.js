// Centralized error types and handling

export class AiBookmarksError extends Error {
  constructor(message, code, details = null) {
    super(message);
    this.name = 'AiBookmarksError';
    this.code = code;
    this.details = details;
  }
}

export const ERROR_CODES = {
  // API errors
  API_AUTH: 'API_AUTH',             // 401 - bad API key
  API_RATE_LIMIT: 'API_RATE_LIMIT', // 429 - rate limited
  API_SERVER: 'API_SERVER',         // 5xx - server error
  API_PARSE: 'API_PARSE',           // JSON parse failure
  API_NETWORK: 'API_NETWORK',       // Network / fetch failure
  API_NO_KEY: 'API_NO_KEY',         // No API key configured
  API_MODEL_UNAVAILABLE: 'API_MODEL_UNAVAILABLE', // 404 - model has no endpoints

  // Storage errors
  STORAGE_QUOTA: 'STORAGE_QUOTA',   // Storage quota exceeded
  STORAGE_READ: 'STORAGE_READ',
  STORAGE_WRITE: 'STORAGE_WRITE',

  // Content extraction
  EXTRACT_TIMEOUT: 'EXTRACT_TIMEOUT',
  EXTRACT_FAILED: 'EXTRACT_FAILED',

  // Sync errors
  SYNC_AUTH: 'SYNC_AUTH',
  SYNC_NETWORK: 'SYNC_NETWORK',
  SYNC_CONFLICT: 'SYNC_CONFLICT',

  // Bookmark errors
  BOOKMARK_NOT_FOUND: 'BOOKMARK_NOT_FOUND',
  BOOKMARK_MOVE_FAILED: 'BOOKMARK_MOVE_FAILED',
};

/**
 * Returns true if the error should trigger a retry.
 * Auth errors and parse errors should NOT be retried.
 */
export function isRetryable(error) {
  if (!(error instanceof AiBookmarksError)) return true;
  return ![
    ERROR_CODES.API_AUTH,
    ERROR_CODES.API_NO_KEY,
    ERROR_CODES.API_PARSE,
    ERROR_CODES.API_MODEL_UNAVAILABLE, // don't retry a dead model — switch models instead
  ].includes(error.code);
}

/**
 * Maps a Claude API HTTP status code to an error code.
 */
export function httpStatusToErrorCode(status) {
  if (status === 401) return ERROR_CODES.API_AUTH;
  if (status === 429) return ERROR_CODES.API_RATE_LIMIT;
  if (status >= 500) return ERROR_CODES.API_SERVER;
  return ERROR_CODES.API_SERVER;
}

/**
 * Logs an error to the console with structured context.
 * In production, this could be replaced with a remote logging service.
 */
export function logError(context, error) {
  const code = error instanceof AiBookmarksError ? error.code : 'UNKNOWN';
  console.error(`[AI Bookmarks] ${context}`, {
    code,
    message: error.message,
    details: error.details,
    stack: error.stack,
  });
}
