import { JwtAccessPayload } from "./auth.types";

declare global {
  namespace Express {
    interface Request {
      user?: JwtAccessPayload;
    }
  }
}

export {};
