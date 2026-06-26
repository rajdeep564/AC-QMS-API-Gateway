import { HTTP, HttpStatus } from "./http-status";

export const ERROR_CODES = {
  // Auth
  INVALID_CREDENTIALS: {
    status: HTTP.UNAUTHORIZED,
    message: "Invalid username or password",
  },
  UNAUTHORIZED: {
    status: HTTP.UNAUTHORIZED,
    message: "Authentication required",
  },
  TOKEN_INVALID: {
    status: HTTP.UNAUTHORIZED,
    message: "Invalid or expired token",
  },
  TOKEN_EXPIRED: {
    status: HTTP.UNAUTHORIZED,
    message: "Session has expired",
  },
  PASSWORD_MISMATCH: {
    status: HTTP.UNAUTHORIZED,
    message: "Invalid password",
  },
  ACCOUNT_LOCKED: {
    status: HTTP.LOCKED,
    message: "Account is temporarily locked",
  },
  ACCOUNT_INACTIVE: {
    status: HTTP.FORBIDDEN,
    message: "Account is inactive",
  },

  // General
  VALIDATION_ERROR: {
    status: HTTP.UNPROCESSABLE,
    message: "Validation failed",
  },
  NOT_FOUND: {
    status: HTTP.NOT_FOUND,
    message: "Resource not found",
  },
  FORBIDDEN: {
    status: HTTP.FORBIDDEN,
    message: "Insufficient permissions",
  },
  CONFLICT: {
    status: HTTP.CONFLICT,
    message: "Resource conflict",
  },
  ILLEGAL_TRANSITION: {
    status: HTTP.CONFLICT,
    message: "Illegal state transition",
  },
  SELF_APPROVAL: {
    status: HTTP.FORBIDDEN,
    message: "Self-approval is not permitted",
  },
  MASTER_NOT_SIGNED: {
    status: HTTP.CONFLICT,
    message: "Source master is not QA signed",
  },
  TEST_NOT_IN_MASTER: {
    status: HTTP.UNPROCESSABLE,
    message: "Test parameter does not belong to source master",
  },
  TEMPLATE_NOT_SIGNED: {
    status: HTTP.CONFLICT,
    message: "Spec template is not QA signed",
  },
  INVALID_ASSIGNEE: {
    status: HTTP.UNPROCESSABLE,
    message: "Assigned user is not a valid QC executive",
  },
  ALREADY_STARTED: {
    status: HTTP.CONFLICT,
    message: "Document has already been started",
  },
  NOT_ASSIGNEE: {
    status: HTTP.FORBIDDEN,
    message: "You are not the assigned QC executive for this batch",
  },
  OPTIONAL_TEST_INVALID: {
    status: HTTP.UNPROCESSABLE,
    message: "One or more optional test IDs are invalid for this template",
  },
  FORMULA_MISSING_VARIABLE: {
    status: HTTP.UNPROCESSABLE,
    message: "One or more formula variables are missing",
  },
  FORMULA_INVALID_RESULT: {
    status: HTTP.UNPROCESSABLE,
    message: "Formula produced an invalid result",
  },
  SECTION_NOT_ASSIGNEE: {
    status: HTTP.FORBIDDEN,
    message: "You are not the assigned QC executive for this batch section",
  },
  OOS_NOT_ACKNOWLEDGED: {
    status: HTTP.CONFLICT,
    message: "Out-of-specification result must be acknowledged before completing the section",
  },
  EXPIRED_NOT_ACKNOWLEDGED: {
    status: HTTP.CONFLICT,
    message: "Expired instrument or reagent must be acknowledged before completing the section",
  },
  SECTION_INCOMPLETE: {
    status: HTTP.UNPROCESSABLE,
    message: "Section is incomplete and cannot be submitted for checking",
  },
  SAME_AS_ANALYST: {
    status: HTTP.FORBIDDEN,
    message: "Checker cannot be the same person as the analyst",
  },
  NOT_AWAITING_CHECK: {
    status: HTTP.CONFLICT,
    message: "Section is not awaiting checker verification",
  },
  SECTION_LOCKED: {
    status: HTTP.CONFLICT,
    message: "Section is locked and cannot be edited",
  },
  AWS_SECTIONS_INCOMPLETE: {
    status: HTTP.CONFLICT,
    message: "All AWS sections must be completed before submitting the document",
  },
  COA_NOT_SIGNABLE: {
    status: HTTP.CONFLICT,
    message: "COA is not in a signable state",
  },
  FEATURE_NOT_IMPLEMENTED: {
    status: HTTP.NOT_IMPLEMENTED,
    message: "This feature is not yet available",
  },
  INTERNAL: {
    status: HTTP.INTERNAL,
    message: "An unexpected error occurred",
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function getErrorDefinition(code: ErrorCode): { status: HttpStatus; message: string } {
  return ERROR_CODES[code];
}
