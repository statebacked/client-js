export class NotFoundError extends Error {
  static readonly status = 404;

  constructor(message, code: string, public readonly cause?: Error) {
    super(message);

    Object.setPrototypeOf(this, NotFoundError.prototype);

    this.name = "NotFoundError";
  }
}

export class OrgHeaderRequiredError extends Error {
  static readonly status = 400;
  static readonly code = "specify-org";

  constructor(message, public readonly cause?: Error) {
    super(message);

    Object.setPrototypeOf(this, OrgHeaderRequiredError.prototype);

    this.name = "OrgHeaderRequiredError";
  }
}

export class UnauthorizedError extends Error {
  static readonly status = 403;

  constructor(
    message,
    public readonly code:
      | "missing-scope"
      | "rejected-by-machine-authorizer"
      | "missing-user"
      | "missing-org",
    public readonly cause?: Error
  ) {
    super(message);

    Object.setPrototypeOf(this, UnauthorizedError.prototype);

    this.name = "UnauthorizedError";
  }
}

export class MissingScopeError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "missing-scope";

  constructor(message, cause?: Error) {
    super(message, "missing-scope", cause);

    Object.setPrototypeOf(this, MissingScopeError.prototype);

    this.name = "MissingScopeError";
  }
}

export class RejectedByMachineAuthorizerError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "rejected-by-machine-authorizer";

  constructor(message, cause?: Error) {
    super(message, "rejected-by-machine-authorizer", cause);

    Object.setPrototypeOf(this, RejectedByMachineAuthorizerError.prototype);

    this.name = "RejectedByMachineAuthorizerError";
  }
}

export class MissingUserError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "missing-user";

  constructor(message, cause?: Error) {
    super(message, "missing-user", cause);

    Object.setPrototypeOf(this, MissingUserError.prototype);

    this.name = "MissingUserError";
  }
}

export class MissingOrgError extends UnauthorizedError {
  static readonly status = 403;
  static readonly code = "missing-org";

  constructor(message) {
    super(message, "missing-org");

    Object.setPrototypeOf(this, MissingOrgError.prototype);

    this.name = "MissingOrgError";
  }
}
