import type { Request, Response, NextFunction } from 'express';

// Express 4 doesn't catch rejections from async handlers: a Prisma error thrown inside a
// route would leave the request hanging and, since Node 15, crash the whole process
// (on Vercel, the function). Wrapping every layer once at startup forwards those
// rejections to the error middleware below instead of touching each route.
// The routers are module-level singletons shared by every createApp() call, so wrapped
// handlers are tagged and never wrapped twice. Express 5 forwards async rejections itself
// (and drops the private `_router`), so this whole helper goes away on upgrade.
const WRAPPED = Symbol('forwardAsyncErrors');

export function forwardAsyncErrors(stack: any[]) {
  for (const layer of stack) {
    if (layer.route) {
      forwardAsyncErrors(layer.route.stack);
    } else if (Array.isArray(layer.handle?.stack)) {
      forwardAsyncErrors(layer.handle.stack); // a mounted Router
    } else if (typeof layer.handle === 'function' && layer.handle.length < 4 && !layer.handle[WRAPPED]) {
      const original = layer.handle;
      const wrapped = (req: Request, res: Response, next: NextFunction) => {
        try {
          Promise.resolve(original(req, res, next)).catch(next);
        } catch (error) {
          next(error);
        }
      };
      (wrapped as any)[WRAPPED] = true;
      layer.handle = wrapped;
    }
  }
}

export function errorHandler(error: any, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(error);
    return;
  }

  // Malformed JSON body etc. — body-parser sets a 4xx status on its errors.
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
    res.status(error.status).json({ error: 'Requisição inválida.' });
    return;
  }

  if (error?.name === 'PrismaClientValidationError') {
    res.status(400).json({ error: 'Dados inválidos.' });
    return;
  }
  switch (error?.code) {
    case 'P2025': // record to update/delete not found
      res.status(404).json({ error: 'Registro não encontrado.' });
      return;
    case 'P2002': // unique constraint
      res.status(409).json({ error: 'Já existe um registro com esses dados.' });
      return;
    case 'P2003': // foreign key constraint
      res.status(409).json({ error: 'Operação não permitida: o registro está vinculado a outros dados ou referencia um registro inexistente.' });
      return;
  }

  console.error('Unhandled route error:', error);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}
