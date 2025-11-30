import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

function normalizeErrorDetail(detail: unknown): any {
  if (!detail) return null;
  if (detail instanceof Error) {
    return {
      message: detail.message,
      stack: detail.stack,
    };
  }
  if (typeof detail === 'object') {
    return detail;
  }
  return { value: detail };
}

function formatLogDetail(detail: unknown): string | null {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return '[Unserializable error detail]';
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorDetails: any = null;
    let providerResponse: unknown = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || (exceptionResponse as any).error || message;
        errorDetails = exceptionResponse;
      }
    } else if (exception instanceof Error) {
      message = exception.message;

      // 处理 Gemini API 的配额超限错误
      if (exception.message.includes('quota') || exception.message.includes('exceeded')) {
        status = HttpStatus.TOO_MANY_REQUESTS; // 429
        message = 'API配额已用尽，请稍后重试或升级计划';
      }

      // 记录错误状态码（如果存在）
      const errorWithStatus = exception as any;
      if (errorWithStatus.status) {
        status = errorWithStatus.status;
      }
      providerResponse = errorWithStatus.response ?? null;
    }

    if (!errorDetails && providerResponse) {
      errorDetails = normalizeErrorDetail(providerResponse);
    }

    // 构建错误响应
    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: message,
      ...(errorDetails && { details: errorDetails }),
    };

    // 记录错误日志（携带第三方响应，便于定位问题）
    const providerDetail = formatLogDetail(providerResponse);
    const logMessage = providerDetail
      ? `${request.method} ${request.url} - Status: ${status} - Message: ${message} - ProviderResponse: ${providerDetail}`
      : `${request.method} ${request.url} - Status: ${status} - Message: ${message}`;
    this.logger.error(logMessage, exception instanceof Error ? exception.stack : exception);

    // 返回错误给客户端
    response.status(status).json(errorResponse);
  }
}
