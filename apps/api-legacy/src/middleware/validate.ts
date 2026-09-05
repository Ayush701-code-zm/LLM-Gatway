import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { firstZodErrorMessage } from '@smartroute/shared';
import { AppError } from './errorHandler';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      return next(
        new AppError(
          400,
          'VALIDATION_ERROR',
          firstZodErrorMessage(result.error),
          result.error.flatten().fieldErrors,
        ),
      );
    }

    req[target] = result.data;
    next();
  };
}
