import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch(QueryFailedError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Handle duplicate key error
    if (exception.message.includes('duplicate key')) {
      const field = exception.message.match(/Key \((.*?)\)=/)?.[1];
      const value = exception.message.match(/=\((.*?)\)/)?.[1];

      return response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: 'Data already exists',
        field,
        value,
      });
    }

    // Handle validation error
    if (exception.message.includes('violates not-null constraint')) {
      const field = exception.message.match(/column "(.*?)"/)?.[1];

      return response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        errors: [
          {
            field,
            message: 'Field is required',
          },
        ],
      });
    }

    // Handle other errors
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
