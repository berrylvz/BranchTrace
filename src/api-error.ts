import type { ApiError } from './types'

export function createApiError(code: string, message: string, details?: Record<string, unknown>): Error & ApiError {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}

export function normalizeError(error: unknown): Error & ApiError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const apiError = error as ApiError
    return error instanceof Error
      ? Object.assign(error, { code: String(apiError.code), ...(apiError.details ? { details: apiError.details } : {}) })
      : createApiError(String(apiError.code), String(apiError.message), apiError.details)
  }
  return createApiError('DB_ERROR', error instanceof Error ? error.message : String(error))
}
