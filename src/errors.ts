export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly cause?: Error,
  ) {
    super(message);

    Object.setPrototypeOf(this, ApiError.prototype);

    this.name = "ApiError";
  }
}

export class NotFoundError extends ApiError {
  static readonly status = 404;

  constructor(message: string, code?: string, cause?: Error) {
    super(message, NotFoundError.status, code, cause);

    Object.setPrototypeOf(this, NotFoundError.prototype);

    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  static readonly status = 409;

  constructor(message: string, code?: string, cause?: Error) {
    super(message, ConflictError.status, code, cause);

    Object.setPrototypeOf(this, NotFoundError.prototype);

    this.name = "ConflictError";
  }
}

export class ClientError extends ApiError {
  static readonly status = 400;

  constructor(message: string, code?: string, cause?: Error) {
    super(message, ClientError.status, code, cause);

    Object.setPrototypeOf(this, ClientError.prototype);

    this.name = "ClientError";
  }
}

export class OrgHeaderRequiredError extends ClientError {
  static readonly status = 400;
  static readonly code = "specify-org";

  constructor(message: string, cause?: Error) {
    super(message, OrgHeaderRequiredError.code, cause);

    Object.setPrototypeOf(this, OrgHeaderRequiredError.prototype);

    this.name = "OrgHeaderRequiredError";
  }
}

export class UnauthorizedError extends ApiError {
  static readonly status = 403;

  constructor(
    message: string,
    code?:
      | "missing-scope"
      | "rejected-by-machine-authorizer"
      | "missing-user"
      | "missing-org"
      // deno-lint-ignore no-explicit-any
      | (string & { _unknown?: any }),
    cause?: Error,
  ) {
    super(message, UnauthorizedError.status, code, cause);

    Object.setPrototypeOf(this, UnauthorizedError.prototype);

    this.name = "UnauthorizedError";
  }
}

export class MissingScopeError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "missing-scope";

  constructor(message: string, cause?: Error) {
    super(message, "missing-scope", cause);

    Object.setPrototypeOf(this, MissingScopeError.prototype);

    this.name = "MissingScopeError";
  }
}

export class RejectedByMachineAuthorizerError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "rejected-by-machine-authorizer";

  constructor(message: string, cause?: Error) {
    super(message, "rejected-by-machine-authorizer", cause);

    Object.setPrototypeOf(this, RejectedByMachineAuthorizerError.prototype);

    this.name = "RejectedByMachineAuthorizerError";
  }
}

export class MissingUserError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "missing-user";

  constructor(message: string, cause?: Error) {
    super(message, "missing-user", cause);

    Object.setPrototypeOf(this, MissingUserError.prototype);

    this.name = "MissingUserError";
  }
}

export class MissingOrgError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "missing-org";

  constructor(message: string) {
    super(message, "missing-org");

    Object.setPrototypeOf(this, MissingOrgError.prototype);

    this.name = "MissingOrgError";
  }
}

export class NoMigrationPathError extends ClientError {
  static readonly status = 400;
  static readonly code = "no-migration-path";

  constructor(message: string, cause?: Error) {
    super(message, NoMigrationPathError.code, cause);

    Object.setPrototypeOf(this, NoMigrationPathError.prototype);

    this.name = "NoMigrationPathError";
  }
}
