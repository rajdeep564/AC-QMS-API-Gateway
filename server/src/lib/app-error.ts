import { ZodIssue } from "zod";
import { ErrorCode, getErrorDefinition } from "./error-codes";
import { HTTP, HttpStatus } from "./http-status";

export class AppError extends Error {
  constructor(
    public readonly statusCode: HttpStatus,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static fromCode(code: ErrorCode, overrideMessage?: string, details?: unknown): AppError {
    const def = getErrorDefinition(code);
    return new AppError(def.status, code, overrideMessage ?? def.message, details);
  }

  static notFound(entity = "Resource"): AppError {
    return AppError.fromCode("NOT_FOUND", `${entity} not found`);
  }

  static forbidden(message?: string): AppError {
    return AppError.fromCode("FORBIDDEN", message);
  }

  static conflict(message?: string): AppError {
    return AppError.fromCode("CONFLICT", message);
  }

  static validation(details: ZodIssue[] | unknown): AppError {
    return AppError.fromCode("VALIDATION_ERROR", undefined, details);
  }

  static illegalTransition(message?: string): AppError {
    return AppError.fromCode("ILLEGAL_TRANSITION", message);
  }

  static selfApproval(message?: string): AppError {
    return AppError.fromCode("SELF_APPROVAL", message);
  }

  static masterNotSigned(message?: string): AppError {
    return AppError.fromCode("MASTER_NOT_SIGNED", message);
  }

  static testNotInMaster(message?: string): AppError {
    return AppError.fromCode("TEST_NOT_IN_MASTER", message);
  }

  static templateNotSigned(message?: string): AppError {
    return AppError.fromCode("TEMPLATE_NOT_SIGNED", message);
  }

  static invalidAssignee(message?: string): AppError {
    return AppError.fromCode("INVALID_ASSIGNEE", message);
  }

  static alreadyStarted(message?: string): AppError {
    return AppError.fromCode("ALREADY_STARTED", message);
  }

  static notAssignee(message?: string): AppError {
    return AppError.fromCode("NOT_ASSIGNEE", message);
  }

  static optionalTestInvalid(message?: string): AppError {
    return AppError.fromCode("OPTIONAL_TEST_INVALID", message);
  }

  static formulaMissingVariable(missing: string[]): AppError {
    return AppError.fromCode(
      "FORMULA_MISSING_VARIABLE",
      `Missing formula variable(s): ${missing.join(", ")}`,
      { missing },
    );
  }

  static formulaInvalidResult(message?: string): AppError {
    return AppError.fromCode("FORMULA_INVALID_RESULT", message);
  }

  static sectionNotAssignee(message?: string): AppError {
    return AppError.fromCode("SECTION_NOT_ASSIGNEE", message);
  }

  static oosNotAcknowledged(message?: string): AppError {
    return AppError.fromCode("OOS_NOT_ACKNOWLEDGED", message);
  }

  static expiredNotAcknowledged(message?: string): AppError {
    return AppError.fromCode("EXPIRED_NOT_ACKNOWLEDGED", message);
  }

  static sectionIncomplete(message?: string): AppError {
    return AppError.fromCode("SECTION_INCOMPLETE", message);
  }

  static sameAsAnalyst(message?: string): AppError {
    return AppError.fromCode("SAME_AS_ANALYST", message);
  }

  static notAwaitingCheck(message?: string): AppError {
    return AppError.fromCode("NOT_AWAITING_CHECK", message);
  }

  static sectionLocked(message?: string): AppError {
    return AppError.fromCode("SECTION_LOCKED", message);
  }

  static awsSectionsIncomplete(message?: string): AppError {
    return AppError.fromCode("AWS_SECTIONS_INCOMPLETE", message);
  }

  static coaNotSignable(message?: string): AppError {
    return AppError.fromCode("COA_NOT_SIGNABLE", message);
  }

  static notImplemented(message?: string): AppError {
    return AppError.fromCode("FEATURE_NOT_IMPLEMENTED", message);
  }
}
