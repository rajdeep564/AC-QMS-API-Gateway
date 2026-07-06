import { NextFunction, Request, Response } from "express";

type AsyncRequestHandler<Req extends Request = Request> = (
  req: Req,
  res: Response,
  next: NextFunction,
) => Promise<void | Response>;

export function asyncHandler<Req extends Request = Request>(fn: AsyncRequestHandler<Req>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}
