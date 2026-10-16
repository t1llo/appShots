/** An answer in OAuth's own terms: an error code from its registry, and a sentence for whoever builds the app. */
export class OAuthError extends Error {
  error: string;
  status: number;
  constructor(error: string, description: string, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

/**
 * Something wrong with an authorization request before its redirect URI is known to be the app's own. The person in
 * the browser is told on a page: sending them on to an address nobody vouched for is what an attacker would want.
 */
export class PageError extends Error {}
