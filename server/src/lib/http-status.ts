export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LOCKED: 423,
  UNPROCESSABLE: 422,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
} as const;

export type HttpStatus = (typeof HTTP)[keyof typeof HTTP];
