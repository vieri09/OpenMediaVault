/** Application error with an attached HTTP status code. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST') => new HttpError(400, code, msg);
export const notFound = (msg: string, code = 'NOT_FOUND') => new HttpError(404, code, msg);
export const forbidden = (msg: string, code = 'FORBIDDEN') => new HttpError(403, code, msg);
export const conflict = (msg: string, code = 'CONFLICT') => new HttpError(409, code, msg);
