export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message: string, code = 'BAD_REQUEST'): ApiError {
    return new ApiError(400, message, code);
  }

  static unauthorized(message = 'No autorizado', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, message, code);
  }

  static forbidden(message = 'No tienes permisos', code = 'FORBIDDEN'): ApiError {
    return new ApiError(403, message, code);
  }

  static notFound(message = 'Recurso no encontrado', code = 'NOT_FOUND'): ApiError {
    return new ApiError(404, message, code);
  }

  static conflict(message: string, code = 'CONFLICT'): ApiError {
    return new ApiError(409, message, code);
  }
}