import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from './logger';

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function globalErrorHandler(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join('.') || 'input'}: ${firstIssue.message}`
      : 'Validation failed';

    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  if ('statusCode' in error && error.statusCode === 429) {
    reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down and try again shortly.',
      },
    });
    return;
  }

  logger.error('Unhandled request error', {
    method: request.method,
    url: request.url,
    errorName: error.name,
    errorMessage: error.message,
  });

  reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred while processing the request.',
    },
  });
}
