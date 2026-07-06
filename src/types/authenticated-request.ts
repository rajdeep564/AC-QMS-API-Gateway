import { Request } from "express";
import { JwtAccessPayload } from "./auth.types";

export type AuthenticatedRequest = Request & { user: JwtAccessPayload };
