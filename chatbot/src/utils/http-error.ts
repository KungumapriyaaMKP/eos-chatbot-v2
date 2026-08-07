export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static unauthorized(message: string, errorCode = 'UNAUTHORIZED'): AppError {
    return new AppError(401, errorCode, message);
  }

  static forbidden(message: string, errorCode = 'FORBIDDEN'): AppError {
    return new AppError(403, errorCode, message);
  }

  static notFound(message: string, errorCode = 'NOT_FOUND'): AppError {
    return new AppError(404, errorCode, message);
  }

  static badRequest(message: string, errorCode = 'VALIDATION_ERROR'): AppError {
    return new AppError(400, errorCode, message);
  }

  static internal(message = 'Something went wrong. Please try again.'): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}
