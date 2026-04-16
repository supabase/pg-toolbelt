-- Risk: data-loss (2)
SET check_function_bodies = false;

ALTER TABLE auth.users
  DROP COLUMN confirmed_at;

ALTER TABLE auth.users
  DROP COLUMN email_change_token;

ALTER TABLE auth.users
  DROP CONSTRAINT users_email_key;

DROP INDEX auth.refresh_tokens_token_idx;

DROP INDEX auth.users_instance_id_email_idx;

CREATE SCHEMA _realtime AUTHORIZATION postgres;

CREATE TABLE _realtime.extensions (
  id                 uuid                           NOT NULL,
  type               text,
  settings           jsonb,
  tenant_external_id text,
  inserted_at        timestamp(0) without time zone NOT NULL,
  updated_at         timestamp(0) without time zone NOT NULL
);

ALTER TABLE _realtime.extensions
  ADD CONSTRAINT extensions_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX extensions_tenant_external_id_type_index
  ON _realtime.extensions (tenant_external_id, type);

CREATE INDEX extensions_tenant_external_id_index ON _realtime.extensions (tenant_external_id);

CREATE TABLE _realtime.schema_migrations (
  version     bigint                         NOT NULL,
  inserted_at timestamp(0) without time zone
);

ALTER TABLE _realtime.schema_migrations
  ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

CREATE TABLE _realtime.tenants (
  id                                    uuid                           NOT NULL,
  name                                  text,
  external_id                           text,
  jwt_secret                            text,
  max_concurrent_users                  integer                        DEFAULT 200 NOT NULL,
  inserted_at                           timestamp(0) without time zone NOT NULL,
  updated_at                            timestamp(0) without time zone NOT NULL,
  max_events_per_second                 integer                        DEFAULT 100 NOT NULL,
  postgres_cdc_default                  text                           DEFAULT
    'postgres_cdc_rls'::text,
  max_bytes_per_second                  integer                        DEFAULT 100000 NOT NULL,
  max_channels_per_client               integer                        DEFAULT 100 NOT NULL,
  max_joins_per_second                  integer                        DEFAULT 500 NOT NULL,
  suspend                               boolean                        DEFAULT false,
  jwt_jwks                              jsonb,
  notify_private_alpha                  boolean                        DEFAULT false,
  private_only                          boolean                        DEFAULT false NOT NULL,
  migrations_ran                        integer                        DEFAULT 0,
  broadcast_adapter                     character varying(255)         DEFAULT 'gen_rpc'::character
    varying,
  max_presence_events_per_second        integer                        DEFAULT 1000,
  max_payload_size_in_kb                integer                        DEFAULT 3000,
  max_client_presence_events_per_window integer,
  client_presence_window_ms             integer,
  presence_enabled                      boolean                        DEFAULT false NOT NULL
);

ALTER TABLE _realtime.tenants
  ADD CONSTRAINT jwt_secret_or_jwt_jwks_required CHECK (jwt_secret IS NOT NULL OR jwt_jwks IS
    NOT NULL);

ALTER TABLE _realtime.tenants
  ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX tenants_external_id_index ON _realtime.tenants (external_id);

ALTER TABLE _realtime.extensions
  ADD CONSTRAINT extensions_tenant_external_id_fkey FOREIGN KEY (tenant_external_id)
    REFERENCES _realtime.tenants(external_id) ON DELETE CASCADE;

CREATE ROLE supabase_functions_admin WITH CREATEROLE NOINHERIT LOGIN;

GRANT supabase_functions_admin TO postgres;

ALTER ROLE supabase_functions_admin SET search_path TO supabase_functions;

CREATE ROLE supabase_realtime_admin WITH NOINHERIT;

GRANT supabase_realtime_admin TO postgres;

CREATE TYPE auth.aal_level AS ENUM (
  'aal1',
  'aal2',
  'aal3'
);

ALTER TYPE auth.aal_level OWNER TO supabase_auth_admin;

CREATE TYPE auth.code_challenge_method AS ENUM (
  's256',
  'plain'
);

ALTER TYPE auth.code_challenge_method OWNER TO supabase_auth_admin;

CREATE TYPE auth.factor_status AS ENUM (
  'unverified',
  'verified'
);

ALTER TYPE auth.factor_status OWNER TO supabase_auth_admin;

CREATE TYPE auth.factor_type AS ENUM (
  'totp',
  'webauthn',
  'phone'
);

ALTER TYPE auth.factor_type OWNER TO supabase_auth_admin;

CREATE TYPE auth.oauth_authorization_status AS ENUM (
  'pending',
  'approved',
  'denied',
  'expired'
);

ALTER TYPE auth.oauth_authorization_status OWNER TO supabase_auth_admin;

CREATE TYPE auth.oauth_client_type AS ENUM (
  'public',
  'confidential'
);

ALTER TYPE auth.oauth_client_type OWNER TO supabase_auth_admin;

CREATE TYPE auth.oauth_registration_type AS ENUM (
  'dynamic',
  'manual'
);

ALTER TYPE auth.oauth_registration_type OWNER TO supabase_auth_admin;

CREATE TYPE auth.oauth_response_type AS ENUM (
  'code'
);

ALTER TYPE auth.oauth_response_type OWNER TO supabase_auth_admin;

CREATE TYPE auth.one_time_token_type AS ENUM (
  'confirmation_token',
  'reauthentication_token',
  'recovery_token',
  'email_change_token_new',
  'email_change_token_current',
  'phone_change_token'
);

ALTER TYPE auth.one_time_token_type OWNER TO supabase_auth_admin;

CREATE OR REPLACE FUNCTION auth.email()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$;

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';

CREATE FUNCTION auth.jwt()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  AS $function$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;

ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

GRANT ALL ON FUNCTION auth.jwt() TO postgres;

GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;

CREATE OR REPLACE FUNCTION auth.role()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';

CREATE OR REPLACE FUNCTION auth.uid()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';

ALTER TABLE auth.audit_log_entries
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.audit_log_entries
  ADD COLUMN ip_address character varying(64) DEFAULT ''::character varying NOT NULL;

GRANT SELECT ON auth.audit_log_entries TO postgres WITH GRANT OPTION;

CREATE TABLE auth.custom_oauth_providers (
  id                    uuid                     DEFAULT gen_random_uuid() NOT NULL,
  provider_type         text                     NOT NULL,
  identifier            text                     NOT NULL,
  name                  text                     NOT NULL,
  client_id             text                     NOT NULL,
  client_secret         text                     NOT NULL,
  acceptable_client_ids text[]                   DEFAULT '{}'::text[] NOT NULL,
  scopes                text[]                   DEFAULT '{}'::text[] NOT NULL,
  pkce_enabled          boolean                  DEFAULT true NOT NULL,
  attribute_mapping     jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  authorization_params  jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  enabled               boolean                  DEFAULT true NOT NULL,
  email_optional        boolean                  DEFAULT false NOT NULL,
  issuer                text,
  discovery_url         text,
  skip_nonce_check      boolean                  DEFAULT false NOT NULL,
  cached_discovery      jsonb,
  discovery_cached_at   timestamp with time zone,
  authorization_url     text,
  token_url             text,
  userinfo_url          text,
  jwks_uri              text,
  created_at            timestamp with time zone DEFAULT now() NOT NULL,
  updated_at            timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE auth.custom_oauth_providers
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_authorization_url_https
    CHECK (authorization_url IS NULL OR authorization_url ~~ 'https://%'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_authorization_url_length
    CHECK (authorization_url IS NULL OR char_length(authorization_url) <= 2048);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_client_id_length
    CHECK (char_length(client_id) >= 1 AND char_length(client_id) <= 512);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_discovery_url_length
    CHECK (discovery_url IS NULL OR char_length(discovery_url) <= 2048);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_identifier_format
    CHECK (identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_issuer_length
    CHECK (issuer IS NULL OR char_length(issuer) >= 1 AND char_length(issuer) <= 2048);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_jwks_uri_https
    CHECK (jwks_uri IS NULL OR jwks_uri ~~ 'https://%'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_jwks_uri_length
    CHECK (jwks_uri IS NULL OR char_length(jwks_uri) <= 2048);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_name_length
    CHECK (char_length(name) >= 1 AND char_length(name) <= 100);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints
    CHECK (provider_type <> 'oauth2'::text OR authorization_url IS NOT NULL AND token_url IS
    NOT NULL AND userinfo_url IS NOT NULL);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_oidc_discovery_url_https
    CHECK
    (provider_type <> 'oidc'::text OR discovery_url IS NULL OR discovery_url ~~ 'https://%'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_oidc_issuer_https
    CHECK (provider_type <> 'oidc'::text OR issuer IS NULL OR issuer ~~ 'https://%'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_oidc_requires_issuer
    CHECK (provider_type <> 'oidc'::text OR issuer IS NOT NULL);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_provider_type_check
    CHECK (provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]));

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_token_url_https
    CHECK (token_url IS NULL OR token_url ~~ 'https://%'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_token_url_length
    CHECK (token_url IS NULL OR char_length(token_url) <= 2048);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_userinfo_url_https
    CHECK (userinfo_url IS NULL OR userinfo_url ~~ 'https://%'::text);

ALTER TABLE auth.custom_oauth_providers
  ADD CONSTRAINT custom_oauth_providers_userinfo_url_length
    CHECK (userinfo_url IS NULL OR char_length(userinfo_url) <= 2048);

GRANT ALL ON auth.custom_oauth_providers TO postgres;

GRANT ALL ON auth.custom_oauth_providers TO dashboard_user;

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers (created_at);

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers (enabled);

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers (identifier);

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers (provider_type);

CREATE TABLE auth.flow_state (
  id                     uuid                       NOT NULL,
  user_id                uuid,
  auth_code              text,
  code_challenge_method  auth.code_challenge_method,
  code_challenge         text,
  provider_type          text                       NOT NULL,
  provider_access_token  text,
  provider_refresh_token text,
  created_at             timestamp with time zone,
  updated_at             timestamp with time zone,
  authentication_method  text                       NOT NULL,
  auth_code_issued_at    timestamp with time zone,
  invite_token           text,
  referrer               text,
  oauth_client_state_id  uuid,
  linking_target_id      uuid,
  email_optional         boolean                    DEFAULT false NOT NULL
);

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';

ALTER TABLE auth.flow_state
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.flow_state
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.flow_state
  ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.flow_state TO postgres;

GRANT SELECT ON auth.flow_state TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.flow_state TO dashboard_user;

CREATE INDEX idx_user_id_auth_method ON auth.flow_state (user_id, authentication_method);

CREATE INDEX flow_state_created_at_idx ON auth.flow_state (created_at DESC);

CREATE INDEX idx_auth_code ON auth.flow_state (auth_code);

CREATE TABLE auth.identities (
  provider_id     text                     NOT NULL,
  user_id         uuid                     NOT NULL,
  identity_data   jsonb                    NOT NULL,
  provider        text                     NOT NULL,
  last_sign_in_at timestamp with time zone,
  created_at      timestamp with time zone,
  updated_at      timestamp with time zone,
  email           text                     GENERATED ALWAYS AS
    (lower((identity_data ->> 'email'::text))) STORED,
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL
);

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';

ALTER TABLE auth.identities
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.identities
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.identities
  ADD CONSTRAINT identities_pkey PRIMARY KEY (id);

ALTER TABLE auth.identities
  ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);

ALTER TABLE auth.identities
  ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.identities TO postgres;

GRANT SELECT ON auth.identities TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.identities TO dashboard_user;

CREATE INDEX identities_user_id_idx ON auth.identities (user_id);

CREATE INDEX identities_email_idx ON auth.identities (email text_pattern_ops);

ALTER TABLE auth.instances
  ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON auth.instances TO postgres WITH GRANT OPTION;

CREATE TABLE auth.mfa_amr_claims (
  session_id            uuid                     NOT NULL,
  created_at            timestamp with time zone NOT NULL,
  updated_at            timestamp with time zone NOT NULL,
  authentication_method text                     NOT NULL,
  id                    uuid                     NOT NULL
);

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';

ALTER TABLE auth.mfa_amr_claims
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.mfa_amr_claims
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.mfa_amr_claims
  ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);

ALTER TABLE auth.mfa_amr_claims
  ADD
    CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE
    (session_id, authentication_method);

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.mfa_amr_claims TO postgres;

GRANT SELECT ON auth.mfa_amr_claims TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.mfa_amr_claims TO dashboard_user;

CREATE TABLE auth.mfa_challenges (
  id                     uuid                     NOT NULL,
  factor_id              uuid                     NOT NULL,
  created_at             timestamp with time zone NOT NULL,
  verified_at            timestamp with time zone,
  ip_address             inet                     NOT NULL,
  otp_code               text,
  web_authn_session_data jsonb
);

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';

ALTER TABLE auth.mfa_challenges
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.mfa_challenges
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.mfa_challenges
  ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.mfa_challenges TO postgres;

GRANT SELECT ON auth.mfa_challenges TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.mfa_challenges TO dashboard_user;

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges (created_at DESC);

CREATE TABLE auth.mfa_factors (
  id                           uuid                     NOT NULL,
  user_id                      uuid                     NOT NULL,
  friendly_name                text,
  factor_type                  auth.factor_type         NOT NULL,
  status                       auth.factor_status       NOT NULL,
  created_at                   timestamp with time zone NOT NULL,
  updated_at                   timestamp with time zone NOT NULL,
  secret                       text,
  phone                        text,
  last_challenged_at           timestamp with time zone,
  web_authn_credential         jsonb,
  web_authn_aaguid             uuid,
  last_webauthn_challenge_data jsonb
);

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';

ALTER TABLE auth.mfa_factors
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.mfa_factors
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.mfa_factors
  ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);

ALTER TABLE auth.mfa_factors
  ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);

ALTER TABLE auth.mfa_challenges
  ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id)
    REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;

ALTER TABLE auth.mfa_factors
  ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.mfa_factors TO postgres;

GRANT SELECT ON auth.mfa_factors TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.mfa_factors TO dashboard_user;

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors (user_id, created_at);

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors (user_id);

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique
  ON auth.mfa_factors (friendly_name, user_id)
  WHERE TRIM(BOTH FROM friendly_name) <> ''::text;

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors (user_id, phone);

CREATE TABLE auth.oauth_authorizations (
  id                    uuid                            NOT NULL,
  authorization_id      text                            NOT NULL,
  client_id             uuid                            NOT NULL,
  user_id               uuid,
  redirect_uri          text                            NOT NULL,
  scope                 text                            NOT NULL,
  state                 text,
  resource              text,
  code_challenge        text,
  code_challenge_method auth.code_challenge_method,
  response_type         auth.oauth_response_type        DEFAULT 'code'::auth.oauth_response_type
    NOT NULL,
  status                auth.oauth_authorization_status DEFAULT
    'pending'::auth.oauth_authorization_status NOT NULL,
  authorization_code    text,
  created_at            timestamp with time zone        DEFAULT now() NOT NULL,
  expires_at            timestamp with time zone        DEFAULT (now() + '00:03:00'::interval)
    NOT NULL,
  approved_at           timestamp with time zone,
  nonce                 text
);

ALTER TABLE auth.oauth_authorizations
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_authorization_code_length
    CHECK (char_length(authorization_code) <= 255);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_code_challenge_length
    CHECK (char_length(code_challenge) <= 128);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_expires_at_future CHECK (expires_at > created_at);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_nonce_length CHECK (char_length(nonce) <= 255);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_redirect_uri_length CHECK (char_length(redirect_uri) <= 2048);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_resource_length CHECK (char_length(resource) <= 2048);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_scope_length CHECK (char_length(scope) <= 4096);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_state_length CHECK (char_length(state) <= 4096);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT ALL ON auth.oauth_authorizations TO postgres;

GRANT ALL ON auth.oauth_authorizations TO dashboard_user;

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations (expires_at)
  WHERE status = 'pending'::auth.oauth_authorization_status;

CREATE TABLE auth.oauth_client_states (
  id            uuid                     NOT NULL,
  provider_type text                     NOT NULL,
  code_verifier text,
  created_at    timestamp with time zone NOT NULL
);

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';

ALTER TABLE auth.oauth_client_states
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.oauth_client_states
  ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);

GRANT ALL ON auth.oauth_client_states TO postgres;

GRANT ALL ON auth.oauth_client_states TO dashboard_user;

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states (created_at);

CREATE TABLE auth.oauth_clients (
  id                         uuid                         NOT NULL,
  client_secret_hash         text,
  registration_type          auth.oauth_registration_type NOT NULL,
  redirect_uris              text                         NOT NULL,
  grant_types                text                         NOT NULL,
  client_name                text,
  client_uri                 text,
  logo_uri                   text,
  created_at                 timestamp with time zone     DEFAULT now() NOT NULL,
  updated_at                 timestamp with time zone     DEFAULT now() NOT NULL,
  deleted_at                 timestamp with time zone,
  client_type                auth.oauth_client_type       DEFAULT
    'confidential'::auth.oauth_client_type NOT NULL,
  token_endpoint_auth_method text                         NOT NULL
);

ALTER TABLE auth.oauth_clients
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.oauth_clients
  ADD CONSTRAINT oauth_clients_client_name_length CHECK (char_length(client_name) <= 1024);

ALTER TABLE auth.oauth_clients
  ADD CONSTRAINT oauth_clients_client_uri_length CHECK (char_length(client_uri) <= 2048);

ALTER TABLE auth.oauth_clients
  ADD CONSTRAINT oauth_clients_logo_uri_length CHECK (char_length(logo_uri) <= 2048);

ALTER TABLE auth.oauth_clients
  ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);

ALTER TABLE auth.oauth_authorizations
  ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;

ALTER TABLE auth.oauth_clients
  ADD CONSTRAINT oauth_clients_token_endpoint_auth_method_check
    CHECK
    (token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text,
    'client_secret_post'::text, 'none'::text]));

GRANT ALL ON auth.oauth_clients TO postgres;

GRANT ALL ON auth.oauth_clients TO dashboard_user;

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients (deleted_at);

CREATE TABLE auth.oauth_consents (
  id         uuid                     NOT NULL,
  user_id    uuid                     NOT NULL,
  client_id  uuid                     NOT NULL,
  scopes     text                     NOT NULL,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone
);

ALTER TABLE auth.oauth_consents
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id)
    REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_revoked_after_granted
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at);

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_scopes_length CHECK (char_length(scopes) <= 2048);

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_scopes_not_empty CHECK (char_length(TRIM(BOTH FROM scopes)) > 0);

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);

ALTER TABLE auth.oauth_consents
  ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT ALL ON auth.oauth_consents TO postgres;

GRANT ALL ON auth.oauth_consents TO dashboard_user;

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents (user_id, granted_at DESC);

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents (user_id, client_id)
  WHERE revoked_at IS NULL;

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents (client_id)
  WHERE revoked_at IS NULL;

CREATE TABLE auth.one_time_tokens (
  id         uuid                        NOT NULL,
  user_id    uuid                        NOT NULL,
  token_type auth.one_time_token_type    NOT NULL,
  token_hash text                        NOT NULL,
  relates_to text                        NOT NULL,
  created_at timestamp without time zone DEFAULT now() NOT NULL,
  updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE auth.one_time_tokens
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.one_time_tokens
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.one_time_tokens
  ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);

ALTER TABLE auth.one_time_tokens
  ADD CONSTRAINT one_time_tokens_token_hash_check CHECK (char_length(token_hash) > 0);

ALTER TABLE auth.one_time_tokens
  ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.one_time_tokens TO postgres;

GRANT SELECT ON auth.one_time_tokens TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.one_time_tokens TO dashboard_user;

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key
  ON auth.one_time_tokens (user_id, token_type);

ALTER TABLE auth.refresh_tokens
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.refresh_tokens
  ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);

ALTER TABLE auth.refresh_tokens
  ADD COLUMN parent character varying(255);

ALTER TABLE auth.refresh_tokens
  ADD COLUMN session_id uuid;

GRANT SELECT ON auth.refresh_tokens TO postgres WITH GRANT OPTION;

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens (updated_at DESC);

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens (parent);

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens (session_id, revoked);

CREATE TABLE auth.saml_providers (
  id                uuid                     NOT NULL,
  sso_provider_id   uuid                     NOT NULL,
  entity_id         text                     NOT NULL,
  metadata_xml      text                     NOT NULL,
  metadata_url      text,
  attribute_mapping jsonb,
  created_at        timestamp with time zone,
  updated_at        timestamp with time zone,
  name_id_format    text
);

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';

ALTER TABLE auth.saml_providers
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.saml_providers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.saml_providers
  ADD CONSTRAINT "entity_id not empty" CHECK (char_length(entity_id) > 0);

ALTER TABLE auth.saml_providers
  ADD CONSTRAINT "metadata_url not empty"
    CHECK (metadata_url = NULL::text OR char_length(metadata_url) > 0);

ALTER TABLE auth.saml_providers
  ADD CONSTRAINT "metadata_xml not empty" CHECK (char_length(metadata_xml) > 0);

ALTER TABLE auth.saml_providers
  ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);

ALTER TABLE auth.saml_providers
  ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.saml_providers TO postgres;

GRANT SELECT ON auth.saml_providers TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.saml_providers TO dashboard_user;

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers (sso_provider_id);

CREATE TABLE auth.saml_relay_states (
  id              uuid                     NOT NULL,
  sso_provider_id uuid                     NOT NULL,
  request_id      text                     NOT NULL,
  for_email       text,
  redirect_to     text,
  created_at      timestamp with time zone,
  updated_at      timestamp with time zone,
  flow_state_id   uuid
);

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';

ALTER TABLE auth.saml_relay_states
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.saml_relay_states
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.saml_relay_states
  ADD CONSTRAINT "request_id not empty" CHECK (char_length(request_id) > 0);

ALTER TABLE auth.saml_relay_states
  ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id)
    REFERENCES auth.flow_state(id) ON DELETE CASCADE;

ALTER TABLE auth.saml_relay_states
  ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.saml_relay_states TO postgres;

GRANT SELECT ON auth.saml_relay_states TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.saml_relay_states TO dashboard_user;

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states (for_email);

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states (created_at DESC);

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states (sso_provider_id);

ALTER TABLE auth.schema_migrations
  ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON auth.schema_migrations TO postgres WITH GRANT OPTION;

CREATE TABLE auth.sessions (
  id                     uuid                        NOT NULL,
  user_id                uuid                        NOT NULL,
  created_at             timestamp with time zone,
  updated_at             timestamp with time zone,
  factor_id              uuid,
  aal                    auth.aal_level,
  not_after              timestamp with time zone,
  refreshed_at           timestamp without time zone,
  user_agent             text,
  ip                     inet,
  tag                    text,
  oauth_client_id        uuid,
  refresh_token_hmac_key text,
  refresh_token_counter  bigint,
  scopes                 text
);

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';

ALTER TABLE auth.sessions
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.sessions
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.sessions
  ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id)
    REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;

ALTER TABLE auth.sessions
  ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE auth.mfa_amr_claims
  ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES auth.sessions(id) ON DELETE CASCADE;

ALTER TABLE auth.refresh_tokens
  ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id)
    REFERENCES auth.sessions(id) ON DELETE CASCADE;

ALTER TABLE auth.sessions
  ADD CONSTRAINT sessions_scopes_length CHECK (char_length(scopes) <= 4096);

ALTER TABLE auth.sessions
  ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.sessions TO postgres;

GRANT SELECT ON auth.sessions TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.sessions TO dashboard_user;

CREATE INDEX user_id_created_at_idx ON auth.sessions (user_id, created_at);

CREATE INDEX sessions_user_id_idx ON auth.sessions (user_id);

CREATE INDEX sessions_not_after_idx ON auth.sessions (not_after DESC);

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions (oauth_client_id);

CREATE TABLE auth.sso_domains (
  id              uuid                     NOT NULL,
  sso_provider_id uuid                     NOT NULL,
  domain          text                     NOT NULL,
  created_at      timestamp with time zone,
  updated_at      timestamp with time zone
);

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';

ALTER TABLE auth.sso_domains
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.sso_domains
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.sso_domains
  ADD CONSTRAINT "domain not empty" CHECK (char_length(domain) > 0);

ALTER TABLE auth.sso_domains
  ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.sso_domains TO postgres;

GRANT SELECT ON auth.sso_domains TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.sso_domains TO dashboard_user;

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains (lower(domain));

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains (sso_provider_id);

CREATE TABLE auth.sso_providers (
  id          uuid                     NOT NULL,
  resource_id text,
  created_at  timestamp with time zone,
  updated_at  timestamp with time zone,
  disabled    boolean
);

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';

ALTER TABLE auth.sso_providers
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.sso_providers
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.sso_providers
  ADD CONSTRAINT "resource_id not empty"
    CHECK (resource_id = NULL::text OR char_length(resource_id) > 0);

ALTER TABLE auth.sso_providers
  ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);

ALTER TABLE auth.saml_providers
  ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id)
    REFERENCES auth.sso_providers(id) ON DELETE CASCADE;

ALTER TABLE auth.saml_relay_states
  ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id)
    REFERENCES auth.sso_providers(id) ON DELETE CASCADE;

ALTER TABLE auth.sso_domains
  ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id)
    REFERENCES auth.sso_providers(id) ON DELETE CASCADE;

GRANT DELETE,
  INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON auth.sso_providers TO postgres;

GRANT SELECT ON auth.sso_providers TO postgres WITH GRANT OPTION;

GRANT ALL ON auth.sso_providers TO dashboard_user;

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers (lower(resource_id));

CREATE INDEX sso_providers_resource_id_pattern_idx
  ON auth.sso_providers (resource_id text_pattern_ops);

ALTER TABLE auth.users
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE auth.users
  ADD COLUMN email_confirmed_at timestamp with time zone;

ALTER TABLE auth.users
  ADD COLUMN email_change_token_new character varying(255);

ALTER TABLE auth.users
  ADD COLUMN phone text DEFAULT NULL::character varying;

ALTER TABLE auth.users
  ADD CONSTRAINT users_phone_key UNIQUE (phone);

ALTER TABLE auth.users
  ADD COLUMN phone_confirmed_at timestamp with time zone;

ALTER TABLE auth.users
  ADD COLUMN phone_change text DEFAULT ''::character varying;

ALTER TABLE auth.users
  ADD COLUMN phone_change_token character varying(255) DEFAULT ''::character varying;

ALTER TABLE auth.users
  ADD COLUMN phone_change_sent_at timestamp with time zone;

ALTER TABLE auth.users
  ADD COLUMN email_change_token_current character varying(255) DEFAULT ''::character varying;

ALTER TABLE auth.users
  ADD COLUMN email_change_confirm_status smallint DEFAULT 0;

ALTER TABLE auth.users
  ADD CONSTRAINT users_email_change_confirm_status_check
    CHECK (email_change_confirm_status >= 0 AND email_change_confirm_status <= 2);

ALTER TABLE auth.users
  ADD COLUMN banned_until timestamp with time zone;

ALTER TABLE auth.users
  ADD COLUMN reauthentication_token character varying(255) DEFAULT ''::character varying;

ALTER TABLE auth.users
  ADD COLUMN reauthentication_sent_at timestamp with time zone;

ALTER TABLE auth.users
  ADD COLUMN is_sso_user boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';

ALTER TABLE auth.users
  ADD COLUMN deleted_at timestamp with time zone;

ALTER TABLE auth.users
  ADD COLUMN is_anonymous boolean DEFAULT false NOT NULL;

ALTER TABLE auth.users
  ADD COLUMN confirmed_at timestamp
    with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED;

GRANT SELECT ON auth.users TO postgres WITH GRANT OPTION;

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users (confirmation_token)
  WHERE confirmation_token::text !~ '^[0-9 ]*$'::text;

CREATE UNIQUE INDEX users_email_partial_key ON auth.users (email)
  WHERE is_sso_user = false;

CREATE INDEX users_is_anonymous_idx ON auth.users (is_anonymous);

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users (reauthentication_token)
  WHERE reauthentication_token::text !~ '^[0-9 ]*$'::text;

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users (email_change_token_new)
  WHERE email_change_token_new::text !~ '^[0-9 ]*$'::text;

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users (email_change_token_current)
  WHERE email_change_token_current::text !~ '^[0-9 ]*$'::text;

CREATE UNIQUE INDEX recovery_token_idx ON auth.users (recovery_token)
  WHERE recovery_token::text !~ '^[0-9 ]*$'::text;

CREATE INDEX users_instance_id_email_idx ON auth.users (instance_id, lower(email::text));

CREATE TABLE auth.webauthn_challenges (
  id             uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id        uuid,
  challenge_type text                     NOT NULL,
  session_data   jsonb                    NOT NULL,
  created_at     timestamp with time zone DEFAULT now() NOT NULL,
  expires_at     timestamp with time zone NOT NULL
);

ALTER TABLE auth.webauthn_challenges
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.webauthn_challenges
  ADD CONSTRAINT webauthn_challenges_challenge_type_check
    CHECK
    (challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text]));

ALTER TABLE auth.webauthn_challenges
  ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);

ALTER TABLE auth.webauthn_challenges
  ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT ALL ON auth.webauthn_challenges TO postgres;

GRANT ALL ON auth.webauthn_challenges TO dashboard_user;

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges (expires_at);

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges (user_id);

CREATE TABLE auth.webauthn_credentials (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id          uuid                     NOT NULL,
  credential_id    bytea                    NOT NULL,
  public_key       bytea                    NOT NULL,
  attestation_type text                     DEFAULT ''::text NOT NULL,
  aaguid           uuid,
  sign_count       bigint                   DEFAULT 0 NOT NULL,
  transports       jsonb                    DEFAULT '[]'::jsonb NOT NULL,
  backup_eligible  boolean                  DEFAULT false NOT NULL,
  backed_up        boolean                  DEFAULT false NOT NULL,
  friendly_name    text                     DEFAULT ''::text NOT NULL,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at     timestamp with time zone
);

ALTER TABLE auth.webauthn_credentials
  OWNER TO supabase_auth_admin;

ALTER TABLE auth.webauthn_credentials
  ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);

ALTER TABLE auth.webauthn_credentials
  ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

GRANT ALL ON auth.webauthn_credentials TO postgres;

GRANT ALL ON auth.webauthn_credentials TO dashboard_user;

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials (user_id);

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key
  ON auth.webauthn_credentials (credential_id);

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';

CREATE EXTENSION pg_net WITH SCHEMA extensions;

COMMENT ON EXTENSION pg_net IS 'Async HTTP';

CREATE OR REPLACE FUNCTION extensions.grant_pg_net_access()
  RETURNS event_trigger
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
    ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

    ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
    ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

    REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
    REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
  END IF;
END;
$function$;

GRANT USAGE ON SCHEMA realtime TO anon;

GRANT USAGE ON SCHEMA realtime TO authenticated;

GRANT USAGE ON SCHEMA realtime TO service_role;

GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;

CREATE TYPE realtime.action AS ENUM (
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'ERROR'
);

CREATE TYPE realtime.equality_op AS ENUM (
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in'
);

CREATE TYPE realtime.user_defined_filter AS (
  column_name text,
  op          realtime.equality_op,
  value       text
);

CREATE TYPE realtime.wal_column AS (
  name          text,
  type_name     text,
  type_oid      oid,
  value         jsonb,
  is_pkey       boolean,
  is_selectable boolean
);

CREATE TYPE realtime.wal_rls AS (
  wal              jsonb,
  is_rls_enabled   boolean,
  subscription_ids uuid[],
  errors           text[]
);

CREATE FUNCTION realtime."cast" (
  val   text,
  type_ regtype
)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$function$;

GRANT ALL ON FUNCTION realtime."cast"(text, regtype) TO anon;

GRANT ALL ON FUNCTION realtime."cast"(text, regtype) TO authenticated;

GRANT ALL ON FUNCTION realtime."cast"(text, regtype) TO service_role;

GRANT ALL ON FUNCTION realtime."cast"(text, regtype) TO supabase_realtime_admin;

CREATE FUNCTION realtime.apply_rls (
  wal              jsonb,
  max_record_bytes integer DEFAULT (1024 * 1024)
)
  RETURNS SETOF realtime.wal_rls
  LANGUAGE plpgsql
  AS $function$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$function$;

GRANT ALL ON FUNCTION realtime.apply_rls(jsonb, integer) TO anon;

GRANT ALL ON FUNCTION realtime.apply_rls(jsonb, integer) TO authenticated;

GRANT ALL ON FUNCTION realtime.apply_rls(jsonb, integer) TO service_role;

GRANT ALL ON FUNCTION realtime.apply_rls(jsonb, integer) TO supabase_realtime_admin;

CREATE FUNCTION realtime.broadcast_changes (
  topic_name   text,
  event_name   text,
  operation    text,
  table_name   text,
  table_schema text,
  new          record,
  old          record,
  level        text   DEFAULT 'ROW'::text
)
  RETURNS void
  LANGUAGE plpgsql
  AS $function$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$function$;

CREATE FUNCTION realtime.build_prepared_statement_sql (
  prepared_statement_name text,
  entity                  regclass,
  columns                 realtime.wal_column[]
)
  RETURNS text
  LANGUAGE sql
  AS $function$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $function$;

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(text, regclass, realtime.wal_column[])
  TO anon;

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(text, regclass, realtime.wal_column[])
  TO authenticated;

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(text, regclass, realtime.wal_column[])
  TO service_role;

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(text, regclass, realtime.wal_column[])
  TO supabase_realtime_admin;

CREATE FUNCTION realtime.check_equality_op (
  op    realtime.equality_op,
  type_ regtype,
  val_1 text,
  val_2 text
)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $function$;

GRANT ALL ON FUNCTION realtime.check_equality_op(realtime.equality_op, regtype, text, text) TO anon;

GRANT ALL ON FUNCTION realtime.check_equality_op(realtime.equality_op, regtype, text, text) TO
  authenticated;

GRANT ALL ON FUNCTION realtime.check_equality_op(realtime.equality_op, regtype, text, text) TO
  service_role;

GRANT ALL ON FUNCTION realtime.check_equality_op(realtime.equality_op, regtype, text, text) TO
  supabase_realtime_admin;

CREATE FUNCTION realtime.is_visible_through_filters (
  columns realtime.wal_column[],
  filters realtime.user_defined_filter[]
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $function$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $function$;

GRANT ALL ON FUNCTION
  realtime.is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]) TO anon;

GRANT ALL ON FUNCTION
  realtime.is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]) TO
  authenticated;

GRANT ALL ON FUNCTION
  realtime.is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]) TO
  service_role;

GRANT ALL ON FUNCTION
  realtime.is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]) TO
  supabase_realtime_admin;

CREATE FUNCTION realtime.list_changes (
  publication      name,
  slot_name        name,
  max_changes      integer,
  max_record_bytes integer
)
  RETURNS TABLE (
    wal                jsonb,
    is_rls_enabled     boolean,
    subscription_ids   uuid[],
    errors             text[],
    slot_changes_count bigint
  )
  LANGUAGE sql
  SET log_min_messages TO 'fatal'
  AS $function$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL AND ppt.tablename NOT LIKE '% %'),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  -- Count raw slot entries before apply_rls/subscription filter
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  -- Apply RLS and filter as before
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  -- Real rows with slot count attached
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  -- Sentinel row: always returned when no real rows exist so Elixir can
  -- always read slot_changes_count. Identified by wal IS NULL.
  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$function$;

CREATE FUNCTION realtime.quote_wal2json (
  entity regclass
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  AS $function$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $function$;

GRANT ALL ON FUNCTION realtime.quote_wal2json(regclass) TO anon;

GRANT ALL ON FUNCTION realtime.quote_wal2json(regclass) TO authenticated;

GRANT ALL ON FUNCTION realtime.quote_wal2json(regclass) TO service_role;

GRANT ALL ON FUNCTION realtime.quote_wal2json(regclass) TO supabase_realtime_admin;

CREATE FUNCTION realtime.send (
  payload jsonb,
  event   text,
  topic   text,
  private boolean DEFAULT true
)
  RETURNS void
  LANGUAGE plpgsql
  AS $function$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$function$;

CREATE FUNCTION realtime.subscription_check_filters()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $function$;

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO anon;

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO authenticated;

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO service_role;

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO supabase_realtime_admin;

CREATE FUNCTION realtime.to_regrole (
  role_name text
)
  RETURNS regrole
  LANGUAGE sql
  IMMUTABLE
  AS $function$ select role_name::regrole $function$;

GRANT ALL ON FUNCTION realtime.to_regrole(text) TO anon;

GRANT ALL ON FUNCTION realtime.to_regrole(text) TO authenticated;

GRANT ALL ON FUNCTION realtime.to_regrole(text) TO service_role;

GRANT ALL ON FUNCTION realtime.to_regrole(text) TO supabase_realtime_admin;

CREATE FUNCTION realtime.topic()
  RETURNS text
  LANGUAGE sql
  STABLE
  AS $function$
select nullif(current_setting('realtime.topic', true), '')::text;
$function$;

ALTER FUNCTION realtime.topic() OWNER TO supabase_realtime_admin;

CREATE TABLE realtime.messages (
  topic       text                        NOT NULL,
  extension   text                        NOT NULL,
  payload     jsonb,
  event       text,
  private     boolean                     DEFAULT false,
  updated_at  timestamp without time zone DEFAULT now() NOT NULL,
  inserted_at timestamp without time zone DEFAULT now() NOT NULL,
  id          uuid                        DEFAULT gen_random_uuid() NOT NULL
) PARTITION BY RANGE (inserted_at);

ALTER TABLE realtime.messages
  OWNER TO supabase_realtime_admin;

ALTER TABLE realtime.messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE realtime.messages
  ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);

GRANT INSERT, SELECT, UPDATE ON realtime.messages TO anon;

GRANT INSERT, SELECT, UPDATE ON realtime.messages TO authenticated;

GRANT INSERT, SELECT, UPDATE ON realtime.messages TO service_role;

CREATE INDEX messages_inserted_at_topic_index ON realtime.messages (inserted_at DESC, topic)
  WHERE extension = 'broadcast'::text AND private IS TRUE;

CREATE TABLE realtime.messages_2026_04_15 PARTITION OF realtime.messages FOR VALUES FROM
  ('2026-04-15 00:00:00') TO ('2026-04-16 00:00:00');

CREATE TABLE realtime.messages_2026_04_16 PARTITION OF realtime.messages FOR VALUES FROM
  ('2026-04-16 00:00:00') TO ('2026-04-17 00:00:00');

CREATE TABLE realtime.messages_2026_04_17 PARTITION OF realtime.messages FOR VALUES FROM
  ('2026-04-17 00:00:00') TO ('2026-04-18 00:00:00');

CREATE TABLE realtime.messages_2026_04_18 PARTITION OF realtime.messages FOR VALUES FROM
  ('2026-04-18 00:00:00') TO ('2026-04-19 00:00:00');

CREATE TABLE realtime.messages_2026_04_19 PARTITION OF realtime.messages FOR VALUES FROM
  ('2026-04-19 00:00:00') TO ('2026-04-20 00:00:00');

CREATE TABLE realtime.schema_migrations (
  version     bigint                         NOT NULL,
  inserted_at timestamp(0) without time zone
);

ALTER TABLE realtime.schema_migrations
  ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

GRANT SELECT ON realtime.schema_migrations TO anon;

GRANT SELECT ON realtime.schema_migrations TO authenticated;

GRANT SELECT ON realtime.schema_migrations TO service_role;

GRANT ALL ON realtime.schema_migrations TO supabase_realtime_admin;

CREATE TABLE realtime.subscription (
  id              bigint                         GENERATED ALWAYS AS IDENTITY NOT NULL,
  subscription_id uuid                           NOT NULL,
  entity          regclass                       NOT NULL,
  filters         realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[]
    NOT NULL,
  claims          jsonb                          NOT NULL,
  claims_role     regrole                        GENERATED ALWAYS AS
    (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
  created_at      timestamp without time zone    DEFAULT timezone('utc'::text, now()) NOT NULL,
  action_filter   text                           DEFAULT '*'::text
);

ALTER TABLE realtime.subscription
  ADD CONSTRAINT pk_subscription PRIMARY KEY (id);

ALTER TABLE realtime.subscription
  ADD CONSTRAINT subscription_action_filter_check
    CHECK (action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text]));

GRANT SELECT ON realtime.subscription TO anon;

GRANT SELECT ON realtime.subscription TO authenticated;

GRANT SELECT ON realtime.subscription TO service_role;

GRANT ALL ON realtime.subscription TO supabase_realtime_admin;

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription (entity);

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key
  ON realtime.subscription (subscription_id, entity, filters, action_filter);

CREATE TRIGGER tr_check_filters
  BEFORE INSERT OR UPDATE ON realtime.subscription
  FOR EACH ROW
  EXECUTE FUNCTION realtime.subscription_check_filters();

CREATE TYPE storage.buckettype AS ENUM (
  'STANDARD',
  'ANALYTICS',
  'VECTOR'
);

ALTER TYPE storage.buckettype OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.allow_any_operation (
  expected_operations text[]
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  AS $function$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$function$;

ALTER FUNCTION storage.allow_any_operation(text[]) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.allow_only_operation (
  expected_operation text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  AS $function$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$function$;

ALTER FUNCTION storage.allow_only_operation(text) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.can_insert_object (
  bucketid text,
  name     text,
  owner    uuid,
  metadata jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  AS $function$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$function$;

ALTER FUNCTION storage.can_insert_object(text, text, uuid, jsonb) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.enforce_bucket_name_length()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$;

ALTER FUNCTION storage.enforce_bucket_name_length() OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.extension (
  name text
)
  RETURNS text
  LANGUAGE plpgsql
  AS $function$
DECLARE
_parts text[];
_filename text;
BEGIN
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	-- @todo return the last part instead of 2
	return reverse(split_part(reverse(_filename), '.', 1));
END
$function$;

ALTER FUNCTION storage.extension(text) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.filename (
  name text
)
  RETURNS text
  LANGUAGE plpgsql
  AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$function$;

ALTER FUNCTION storage.filename(text) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.foldername (
  name text
)
  RETURNS text[]
  LANGUAGE plpgsql
  AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$function$;

ALTER FUNCTION storage.foldername(text) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.get_common_prefix (
  p_key       text,
  p_prefix    text,
  p_delimiter text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $function$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$function$;

ALTER FUNCTION storage.get_common_prefix(text, text, text) OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.get_size_by_bucket()
  RETURNS TABLE (
    size      bigint,
    bucket_id text
  )
  LANGUAGE plpgsql
  AS $function$
BEGIN
    return query
        select sum((metadata->>'size')::int) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$function$;

ALTER FUNCTION storage.get_size_by_bucket() OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter (
  bucket_id         text,
  prefix_param      text,
  delimiter_param   text,
  max_keys          integer DEFAULT 100,
  next_key_token    text    DEFAULT ''::text,
  next_upload_token text    DEFAULT ''::text
)
  RETURNS TABLE (
    key        text,
    id         text,
    created_at timestamp with time zone
  )
  LANGUAGE plpgsql
  AS $function$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$function$;

ALTER FUNCTION storage.list_multipart_uploads_with_delimiter(text, text, text, integer, text, text)
  OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.list_objects_with_delimiter (
  _bucket_id      text,
  prefix_param    text,
  delimiter_param text,
  max_keys        integer DEFAULT 100,
  start_after     text    DEFAULT ''::text,
  next_token      text    DEFAULT ''::text,
  sort_order      text    DEFAULT 'asc'::text
)
  RETURNS TABLE (
    name             text,
    id               uuid,
    metadata         jsonb,
    updated_at       timestamp with time zone,
    created_at       timestamp with time zone,
    last_accessed_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$function$;

ALTER FUNCTION storage.list_objects_with_delimiter(text, text, text, integer, text, text, text)
  OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.operation()
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  AS $function$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$function$;

ALTER FUNCTION storage.operation() OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.protect_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$function$;

ALTER FUNCTION storage.protect_delete() OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.search_by_timestamp (
  p_prefix            text,
  p_bucket_id         text,
  p_limit             integer,
  p_level             integer,
  p_start_after       text,
  p_sort_order        text,
  p_sort_column       text,
  p_sort_column_after text
)
  RETURNS TABLE (
    key              text,
    name             text,
    id               uuid,
    updated_at       timestamp with time zone,
    created_at       timestamp with time zone,
    last_accessed_at timestamp with time zone,
    metadata         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$function$;

ALTER FUNCTION storage.search_by_timestamp(text, text, integer, integer, text, text, text, text)
  OWNER TO supabase_storage_admin;

CREATE FUNCTION storage.search_v2 (
  prefix            text,
  bucket_name       text,
  limits            integer DEFAULT 100,
  levels            integer DEFAULT 1,
  start_after       text    DEFAULT ''::text,
  sort_order        text    DEFAULT 'asc'::text,
  sort_column       text    DEFAULT 'name'::text,
  sort_column_after text    DEFAULT ''::text
)
  RETURNS TABLE (
    key              text,
    name             text,
    id               uuid,
    updated_at       timestamp with time zone,
    created_at       timestamp with time zone,
    last_accessed_at timestamp with time zone,
    metadata         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$function$;

ALTER FUNCTION storage.search_v2(text, text, integer, integer, text, text, text, text) OWNER TO
  supabase_storage_admin;

CREATE FUNCTION storage.search (
  prefix     text,
  bucketname text,
  limits     integer DEFAULT 100,
  levels     integer DEFAULT 1,
  offsets    integer DEFAULT 0,
  search     text    DEFAULT ''::text,
  sortcolumn text    DEFAULT 'name'::text,
  sortorder  text    DEFAULT 'asc'::text
)
  RETURNS TABLE (
    name             text,
    id               uuid,
    updated_at       timestamp with time zone,
    created_at       timestamp with time zone,
    last_accessed_at timestamp with time zone,
    metadata         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  AS $function$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$function$;

ALTER FUNCTION storage.search(text, text, integer, integer, integer, text, text, text) OWNER TO
  supabase_storage_admin;

CREATE FUNCTION storage.update_updated_at_column()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$function$;

ALTER FUNCTION storage.update_updated_at_column() OWNER TO supabase_storage_admin;

CREATE TABLE storage.buckets (
  id                 text                     NOT NULL,
  name               text                     NOT NULL,
  owner              uuid,
  created_at         timestamp with time zone DEFAULT now(),
  updated_at         timestamp with time zone DEFAULT now(),
  public             boolean                  DEFAULT false,
  avif_autodetection boolean                  DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  owner_id           text,
  type               storage.buckettype       DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';

ALTER TABLE storage.buckets
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.buckets
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.buckets
  ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);

GRANT ALL ON storage.buckets TO postgres WITH GRANT OPTION;

GRANT ALL ON storage.buckets TO anon;

GRANT ALL ON storage.buckets TO authenticated;

GRANT ALL ON storage.buckets TO service_role;

CREATE UNIQUE INDEX bname ON storage.buckets (name);

CREATE TRIGGER enforce_bucket_name_length_trigger
  BEFORE INSERT OR UPDATE OF name ON storage.buckets
  FOR EACH ROW
  EXECUTE FUNCTION storage.enforce_bucket_name_length();

CREATE TRIGGER protect_buckets_delete
  BEFORE DELETE ON storage.buckets
  FOR EACH STATEMENT
  EXECUTE FUNCTION storage.protect_delete();

CREATE TABLE storage.buckets_analytics (
  name       text                     NOT NULL,
  type       storage.buckettype       DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
  format     text                     DEFAULT 'ICEBERG'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  deleted_at timestamp with time zone
);

ALTER TABLE storage.buckets_analytics
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.buckets_analytics
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.buckets_analytics
  ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);

GRANT ALL ON storage.buckets_analytics TO anon;

GRANT ALL ON storage.buckets_analytics TO authenticated;

GRANT ALL ON storage.buckets_analytics TO service_role;

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics (name)
  WHERE deleted_at IS NULL;

CREATE TABLE storage.buckets_vectors (
  id         text                     NOT NULL,
  type       storage.buckettype       DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE storage.buckets_vectors
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.buckets_vectors
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.buckets_vectors
  ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);

GRANT SELECT ON storage.buckets_vectors TO anon;

GRANT SELECT ON storage.buckets_vectors TO authenticated;

GRANT SELECT ON storage.buckets_vectors TO service_role;

CREATE TABLE storage.iceberg_namespaces (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  bucket_name text                     NOT NULL,
  name        text                     COLLATE "C" NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now() NOT NULL,
  metadata    jsonb                    DEFAULT '{}'::jsonb NOT NULL,
  catalog_id  uuid                     NOT NULL
);

ALTER TABLE storage.iceberg_namespaces
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.iceberg_namespaces
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.iceberg_namespaces
  ADD CONSTRAINT iceberg_namespaces_catalog_id_fkey FOREIGN KEY (catalog_id)
    REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;

ALTER TABLE storage.iceberg_namespaces
  ADD CONSTRAINT iceberg_namespaces_pkey PRIMARY KEY (id);

GRANT SELECT ON storage.iceberg_namespaces TO anon;

GRANT SELECT ON storage.iceberg_namespaces TO authenticated;

GRANT ALL ON storage.iceberg_namespaces TO service_role;

CREATE UNIQUE INDEX idx_iceberg_namespaces_bucket_id
  ON storage.iceberg_namespaces (catalog_id, name);

CREATE TABLE storage.iceberg_tables (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  namespace_id    uuid                     NOT NULL,
  bucket_name     text                     NOT NULL,
  name            text                     COLLATE "C" NOT NULL,
  location        text                     NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  updated_at      timestamp with time zone DEFAULT now() NOT NULL,
  remote_table_id text,
  shard_key       text,
  shard_id        text,
  catalog_id      uuid                     NOT NULL
);

ALTER TABLE storage.iceberg_tables
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.iceberg_tables
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.iceberg_tables
  ADD CONSTRAINT iceberg_tables_catalog_id_fkey FOREIGN KEY (catalog_id)
    REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;

ALTER TABLE storage.iceberg_tables
  ADD CONSTRAINT iceberg_tables_namespace_id_fkey FOREIGN KEY (namespace_id)
    REFERENCES storage.iceberg_namespaces(id) ON DELETE CASCADE;

ALTER TABLE storage.iceberg_tables
  ADD CONSTRAINT iceberg_tables_pkey PRIMARY KEY (id);

GRANT SELECT ON storage.iceberg_tables TO anon;

GRANT SELECT ON storage.iceberg_tables TO authenticated;

GRANT ALL ON storage.iceberg_tables TO service_role;

CREATE UNIQUE INDEX idx_iceberg_tables_location ON storage.iceberg_tables (location);

CREATE UNIQUE INDEX idx_iceberg_tables_namespace_id
  ON storage.iceberg_tables (catalog_id, namespace_id, name);

CREATE TABLE storage.migrations (
  id          integer                     NOT NULL,
  name        character varying(100)      NOT NULL,
  hash        character varying(40)       NOT NULL,
  executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE storage.migrations
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.migrations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.migrations
  ADD CONSTRAINT migrations_name_key UNIQUE (name);

ALTER TABLE storage.migrations
  ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);

CREATE TABLE storage.objects (
  id               uuid                     DEFAULT gen_random_uuid() NOT NULL,
  bucket_id        text,
  name             text,
  owner            uuid,
  created_at       timestamp with time zone DEFAULT now(),
  updated_at       timestamp with time zone DEFAULT now(),
  last_accessed_at timestamp with time zone DEFAULT now(),
  metadata         jsonb,
  path_tokens      text[]                   GENERATED ALWAYS AS (string_to_array(name, '/'::text))
    STORED,
  version          text,
  owner_id         text,
  user_metadata    jsonb
);

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';

ALTER TABLE storage.objects
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.objects
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.objects
  ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);

ALTER TABLE storage.objects
  ADD CONSTRAINT objects_pkey PRIMARY KEY (id);

GRANT ALL ON storage.objects TO postgres WITH GRANT OPTION;

GRANT ALL ON storage.objects TO anon;

GRANT ALL ON storage.objects TO authenticated;

GRANT ALL ON storage.objects TO service_role;

CREATE UNIQUE INDEX bucketid_objname ON storage.objects (bucket_id, name);

CREATE INDEX idx_objects_bucket_id_name ON storage.objects (bucket_id, name COLLATE "C");

CREATE INDEX name_prefix_search ON storage.objects (name text_pattern_ops);

CREATE INDEX idx_objects_bucket_id_name_lower
  ON storage.objects (bucket_id, lower(name) COLLATE "C");

CREATE TRIGGER protect_objects_delete
  BEFORE DELETE ON storage.objects
  FOR EACH STATEMENT
  EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER update_objects_updated_at
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION storage.update_updated_at_column();

CREATE TABLE storage.s3_multipart_uploads (
  id               text                     NOT NULL,
  in_progress_size bigint                   DEFAULT 0 NOT NULL,
  upload_signature text                     NOT NULL,
  bucket_id        text                     NOT NULL,
  key              text                     COLLATE "C" NOT NULL,
  version          text                     NOT NULL,
  owner_id         text,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  user_metadata    jsonb,
  metadata         jsonb
);

ALTER TABLE storage.s3_multipart_uploads
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.s3_multipart_uploads
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.s3_multipart_uploads
  ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id)
    REFERENCES storage.buckets(id);

ALTER TABLE storage.s3_multipart_uploads
  ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);

GRANT SELECT ON storage.s3_multipart_uploads TO anon;

GRANT SELECT ON storage.s3_multipart_uploads TO authenticated;

GRANT ALL ON storage.s3_multipart_uploads TO service_role;

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads (bucket_id, key, created_at);

CREATE TABLE storage.s3_multipart_uploads_parts (
  id          uuid                     DEFAULT gen_random_uuid() NOT NULL,
  upload_id   text                     NOT NULL,
  size        bigint                   DEFAULT 0 NOT NULL,
  part_number integer                  NOT NULL,
  bucket_id   text                     NOT NULL,
  key         text                     COLLATE "C" NOT NULL,
  etag        text                     NOT NULL,
  owner_id    text,
  version     text                     NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE storage.s3_multipart_uploads_parts
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.s3_multipart_uploads_parts
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.s3_multipart_uploads_parts
  ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id)
    REFERENCES storage.buckets(id);

ALTER TABLE storage.s3_multipart_uploads_parts
  ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);

ALTER TABLE storage.s3_multipart_uploads_parts
  ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id)
    REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;

GRANT SELECT ON storage.s3_multipart_uploads_parts TO anon;

GRANT SELECT ON storage.s3_multipart_uploads_parts TO authenticated;

GRANT ALL ON storage.s3_multipart_uploads_parts TO service_role;

CREATE TABLE storage.vector_indexes (
  id                     text                     DEFAULT gen_random_uuid() NOT NULL,
  name                   text                     COLLATE "C" NOT NULL,
  bucket_id              text                     NOT NULL,
  data_type              text                     NOT NULL,
  dimension              integer                  NOT NULL,
  distance_metric        text                     NOT NULL,
  metadata_configuration jsonb,
  created_at             timestamp with time zone DEFAULT now() NOT NULL,
  updated_at             timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE storage.vector_indexes
  OWNER TO supabase_storage_admin;

ALTER TABLE storage.vector_indexes
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE storage.vector_indexes
  ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id)
    REFERENCES storage.buckets_vectors(id);

ALTER TABLE storage.vector_indexes
  ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);

GRANT SELECT ON storage.vector_indexes TO anon;

GRANT SELECT ON storage.vector_indexes TO authenticated;

GRANT SELECT ON storage.vector_indexes TO service_role;

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes (name, bucket_id);

CREATE SCHEMA supabase_functions AUTHORIZATION supabase_admin;

GRANT USAGE ON SCHEMA supabase_functions TO postgres;

GRANT USAGE ON SCHEMA supabase_functions TO anon;

GRANT USAGE ON SCHEMA supabase_functions TO authenticated;

GRANT USAGE ON SCHEMA supabase_functions TO service_role;

GRANT ALL ON SCHEMA supabase_functions TO supabase_functions_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO
  anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES
  TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON ROUTINES
  TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO
  authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES
  TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON ROUTINES
  TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO
  postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES
  TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON ROUTINES
  TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON TABLES TO
  service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON SEQUENCES
  TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA supabase_functions GRANT ALL ON ROUTINES
  TO service_role;

CREATE SEQUENCE supabase_functions.hooks_id_seq;

CREATE FUNCTION supabase_functions.http_request()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'supabase_functions'
  AS $function$
  DECLARE
    request_id bigint;
    payload jsonb;
    url text := TG_ARGV[0]::text;
    method text := TG_ARGV[1]::text;
    headers jsonb DEFAULT '{}'::jsonb;
    params jsonb DEFAULT '{}'::jsonb;
    timeout_ms integer DEFAULT 1000;
  BEGIN
    IF url IS NULL OR url = 'null' THEN
      RAISE EXCEPTION 'url argument is missing';
    END IF;

    IF method IS NULL OR method = 'null' THEN
      RAISE EXCEPTION 'method argument is missing';
    END IF;

    IF TG_ARGV[2] IS NULL OR TG_ARGV[2] = 'null' THEN
      headers = '{"Content-Type": "application/json"}'::jsonb;
    ELSE
      headers = TG_ARGV[2]::jsonb;
    END IF;

    IF TG_ARGV[3] IS NULL OR TG_ARGV[3] = 'null' THEN
      params = '{}'::jsonb;
    ELSE
      params = TG_ARGV[3]::jsonb;
    END IF;

    IF TG_ARGV[4] IS NULL OR TG_ARGV[4] = 'null' THEN
      timeout_ms = 1000;
    ELSE
      timeout_ms = TG_ARGV[4]::integer;
    END IF;

    CASE
      WHEN method = 'GET' THEN
        SELECT http_get INTO request_id FROM net.http_get(
          url,
          params,
          headers,
          timeout_ms
        );
      WHEN method = 'POST' THEN
        payload = jsonb_build_object(
          'old_record', OLD,
          'record', NEW,
          'type', TG_OP,
          'table', TG_TABLE_NAME,
          'schema', TG_TABLE_SCHEMA
        );

        SELECT http_post INTO request_id FROM net.http_post(
          url,
          payload,
          params,
          headers,
          timeout_ms
        );
      ELSE
        RAISE EXCEPTION 'method argument % is invalid', method;
    END CASE;

    INSERT INTO supabase_functions.hooks
      (hook_table_id, hook_name, request_id)
    VALUES
      (TG_RELID, TG_NAME, request_id);

    RETURN NEW;
  END
$function$;

ALTER FUNCTION supabase_functions.http_request() OWNER TO supabase_functions_admin;

CREATE TABLE supabase_functions.hooks (
  id            bigint                   DEFAULT
    nextval('supabase_functions.hooks_id_seq'::regclass) NOT NULL,
  hook_table_id integer                  NOT NULL,
  hook_name     text                     NOT NULL,
  created_at    timestamp with time zone DEFAULT now() NOT NULL,
  request_id    bigint
);

ALTER SEQUENCE supabase_functions.hooks_id_seq OWNED BY supabase_functions.hooks.id;

COMMENT ON TABLE supabase_functions.hooks IS 'Supabase Functions Hooks: Audit trail for triggered hooks.';

ALTER TABLE supabase_functions.hooks
  OWNER TO supabase_functions_admin;

ALTER TABLE supabase_functions.hooks
  ADD CONSTRAINT hooks_pkey PRIMARY KEY (id);

CREATE INDEX supabase_functions_hooks_request_id_idx ON supabase_functions.hooks (request_id);

CREATE INDEX supabase_functions_hooks_h_table_id_h_name_idx
  ON supabase_functions.hooks (hook_table_id, hook_name);

CREATE TABLE supabase_functions.migrations (
  version     text                     NOT NULL,
  inserted_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE supabase_functions.migrations
  OWNER TO supabase_functions_admin;

ALTER TABLE supabase_functions.migrations
  ADD CONSTRAINT migrations_pkey PRIMARY KEY (version);