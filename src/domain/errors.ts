/** Something asked for is not there: a project, a screenshot, a revision. */
export class NotFoundError extends Error {}

/** A request that cannot be carried out as sent. The message says why, in words the caller can act on. */
export class InputError extends Error {}

/**
 * An upload refused for its size: a picture with more pixels than any screen has, or one the account has no room
 * left for. Answered 413, like a body over its limit.
 */
export class TooLargeError extends InputError {}

/**
 * Work the server cannot take on right now, such as a render asked for while it shuts down. Answered 503: the same
 * request works again in a minute, from the server that takes over.
 */
export class UnavailableError extends InputError {}

/**
 * A project whose project.json cannot be read at all. It is listed and can be deleted or restored from its history,
 * but not opened or changed.
 */
export class DamagedError extends InputError {
  /** What is wrong with the file, such as "is not valid JSON". Logged and listed, not shown with every request. */
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * A change made against a revision that is no longer the current one: somebody else saved in between. `status` lets
 * the error handler answer 409 where the route does not answer it itself.
 */
export class ConflictError extends Error {
  readonly status = 409;
  /** The revision the project is at now. */
  readonly revision: number;

  constructor(message: string, revision: number) {
    super(message);
    this.revision = revision;
  }
}
