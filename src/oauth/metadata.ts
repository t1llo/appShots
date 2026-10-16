// How an MCP client finds out that this server signs it in with OAuth, and where: the documents under /.well-known,
// the header on a refused request, and which addresses a token may be meant for. The server is its own
// authorization server, so the issuer is the server's own origin: PUBLIC_URL behind a reverse proxy.

/** The one scope there is. It covers what an API token covers. */
export const SCOPE = "mcp";

/** The origin a server address stands for, in the form the documents and tokens use: lower case, no slash at the end. */
export const originOf = (base: string) => URL.parse(base)?.origin ?? base;

export const mcpResource = (origin: string) => `${origin}/mcp`;

export const PROTECTED_RESOURCE = "/.well-known/oauth-protected-resource";
export const AUTHORIZATION_SERVER = "/.well-known/oauth-authorization-server";

/** Whether a path is the MCP endpoint, which has a metadata document of its own. */
const isMcp = (path: string) => path === "/mcp" || path.startsWith("/mcp/");

/**
 * The resource metadata of RFC 9728. The document at the root speaks for the whole server, the one with /mcp on the
 * end for the MCP endpoint: each names the resource whose address its own was made from, as the RFC asks.
 */
export function protectedResource(origin: string, forMcp: boolean) {
  return {
    resource: forMcp ? mcpResource(origin) : origin,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "appShots",
    resource_documentation: `${origin}/docs/connect`,
  };
}

/** The authorization server metadata of RFC 8414. */
export function authorizationServer(origin: string) {
  const methods = ["none", "client_secret_post", "client_secret_basic"];
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: methods,
    revocation_endpoint_auth_methods_supported: methods,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/docs/connect`,
  };
}

/**
 * The WWW-Authenticate header of a refused request: where the resource metadata is, which scope to ask for, and
 * whether the token that came with it was no good.
 */
export function challenge(origin: string, path: string, tokenSent: boolean): string {
  const metadata = `${origin}${PROTECTED_RESOURCE}${isMcp(path) ? "/mcp" : ""}`;
  return `Bearer ${tokenSent ? 'error="invalid_token", ' : ""}resource_metadata="${metadata}", scope="${SCOPE}"`;
}

/**
 * The resource a client asks for, as RFC 8707 has it, in the one form a token keeps: the server's origin or its MCP
 * endpoint. Null for anything else, another server's address above all. Scheme and host may come in any case.
 */
export function canonicalResource(value: string, origin: string): string | null {
  const url = URL.parse(value);
  if (!url || url.origin !== origin || url.search || url.hash || value.includes("#") || url.username || url.password) return null;
  if (url.pathname === "/") return origin;
  if (url.pathname === "/mcp" || url.pathname === "/mcp/") return mcpResource(origin);
  return null;
}

/** Whether a token meant for `resource` may be used for `path` on this server. One for the MCP endpoint reaches that only. */
export function covers(resource: string, origin: string, path: string): boolean {
  if (resource === origin) return true;
  return resource === mcpResource(origin) && isMcp(path);
}
