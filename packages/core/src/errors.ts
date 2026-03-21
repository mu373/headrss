export type DomainErrorCode =
  | "NOT_FOUND"
  | "OWNERSHIP_MISMATCH"
  | "ALREADY_EXISTS"
  | "INVALID_INPUT"
  | "UNSUPPORTED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
