// Shared outbound authentication configuration for file downloads and callbacks.

export interface GatewayHeader {
  name: string;
  value?: string;
  value_secret_ref?: string;
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'header' | 'query' | 'csp_oauth2' | 'oauth2_client_credentials';
  token?: string;
  token_secret_ref?: string;
  header_name?: string;
  header_value?: string;
  header_value_secret_ref?: string;
  query_key?: string;
  query_value?: string;
  query_value_secret_ref?: string;
  token_url?: string;
  client_id?: string;
  client_secret?: string;
  client_secret_ref?: string;
  token_body_format?: 'json' | 'form';
  token_auth_style?: 'body' | 'basic';
  scope?: string;
  audience?: string;
  token_response_path?: string;
  csp_chunk_size?: number;
  /**
   * APIC gateway client identifier carried over from develop (140be39).
   * It is normalized to the X-IBM-Client-Id gateway header at runtime.
   */
  ibm_client_id?: string;
  /** Headers required by an API gateway on token, download, and callback requests. */
  gateway_headers?: GatewayHeader[];
}

/** Backward-compatible name used by existing file URL download callers. */
export type FileUrlAuthConfig = AuthConfig;
