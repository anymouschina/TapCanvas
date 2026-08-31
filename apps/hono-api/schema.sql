-- Database schema for Tasks demo
CREATE TABLE IF NOT EXISTS tasks (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	slug TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	completed INTEGER NOT NULL DEFAULT 0,
	due_date TEXT NOT NULL
);

-- Users table (replacing NestJS + Postgres User model for auth)
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	login TEXT NOT NULL,
	name TEXT,
	avatar_url TEXT,
	email TEXT,
	phone TEXT,
	password_hash TEXT,
	password_salt TEXT,
	password_updated_at TEXT,
	role TEXT,
	disabled INTEGER NOT NULL DEFAULT 0,
	deleted_at TEXT,
	last_seen_at TEXT,
	guest INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_bound_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
CREATE INDEX IF NOT EXISTS idx_users_referrer_user_id ON users(referrer_user_id);

-- Email login codes (passwordless OTP)
CREATE TABLE IF NOT EXISTS email_login_codes (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	code_salt TEXT NOT NULL,
	code_hash TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_login_codes_email_created_at ON email_login_codes(email, created_at);
CREATE INDEX IF NOT EXISTS idx_email_login_codes_email_expires_at ON email_login_codes(email, expires_at);

-- Teams (enterprise mode) + shared credits
CREATE TABLE IF NOT EXISTS teams (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	credits INTEGER NOT NULL DEFAULT 0,
	credits_frozen INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_memberships (
	team_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (team_id, user_id),
	FOREIGN KEY (team_id) REFERENCES teams(id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_memberships_user_id ON team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team_id ON team_memberships(team_id);

-- Team invites (share code to join)
CREATE TABLE IF NOT EXISTS team_invites (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL,
	code TEXT NOT NULL UNIQUE,
	email TEXT,
	phone TEXT,
	login TEXT,
	status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | revoked | expired
	expires_at TEXT,
	inviter_user_id TEXT NOT NULL,
	accepted_user_id TEXT,
	accepted_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (team_id) REFERENCES teams(id),
	FOREIGN KEY (inviter_user_id) REFERENCES users(id),
	FOREIGN KEY (accepted_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team_status ON team_invites(team_id, status);

-- Team credit ledger (topups + deductions; idempotent by (team_id, entry_type, task_id))
CREATE TABLE IF NOT EXISTS team_credit_ledger (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL,
	entry_type TEXT NOT NULL, -- topup | reserve | deduct | release
	amount INTEGER NOT NULL,
	task_id TEXT,
	task_kind TEXT,
	actor_user_id TEXT,
	note TEXT,
	created_at TEXT NOT NULL,
	api_key_id TEXT,
	UNIQUE (team_id, entry_type, task_id),
	FOREIGN KEY (team_id) REFERENCES teams(id),
	FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

-- Existing databases created before per-API-key billing attribution need the
-- same append-only schema repair before required data migrations are replayed.
ALTER TABLE team_credit_ledger ADD COLUMN IF NOT EXISTS api_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_team_credit_ledger_team_created_at ON team_credit_ledger(team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_team_credit_ledger_api_key_created ON team_credit_ledger(api_key_id, created_at);

-- Credit grants are retained as spendable batches. Temporary batches sort by
-- expiry; permanent batches have a NULL expiry and are consumed last.
CREATE TABLE IF NOT EXISTS team_credit_batches (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL,
	source_type TEXT NOT NULL,
	source_key TEXT NOT NULL,
	original_amount INTEGER NOT NULL CHECK (original_amount > 0),
	remaining_amount INTEGER NOT NULL CHECK (remaining_amount >= 0),
	reserved_amount INTEGER NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0 AND reserved_amount <= remaining_amount),
	expires_at TEXT,
	granted_at TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (team_id, source_type, source_key),
	FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_team_credit_batches_spend_order
	ON team_credit_batches(team_id, expires_at, granted_at);

-- Every reserve/deduct/release/direct charge records the exact source batches
-- it touched. This keeps settlement and refunds traceable to the original grant.
CREATE TABLE IF NOT EXISTS team_credit_allocations (
	id TEXT PRIMARY KEY,
	team_id TEXT NOT NULL,
	ledger_entry_id TEXT NOT NULL,
	batch_id TEXT NOT NULL,
	priority INTEGER NOT NULL,
	amount INTEGER NOT NULL CHECK (amount > 0),
	expired_amount INTEGER NOT NULL DEFAULT 0 CHECK (expired_amount >= 0 AND expired_amount <= amount),
	created_at TEXT NOT NULL,
	UNIQUE (ledger_entry_id, batch_id),
	FOREIGN KEY (team_id) REFERENCES teams(id),
	FOREIGN KEY (ledger_entry_id) REFERENCES team_credit_ledger(id),
	FOREIGN KEY (batch_id) REFERENCES team_credit_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_team_credit_allocations_ledger_priority
	ON team_credit_allocations(team_id, ledger_entry_id, priority);
CREATE INDEX IF NOT EXISTS idx_team_credit_allocations_batch
	ON team_credit_allocations(batch_id);

-- Model credit costs (admin-configurable; used for team credit deductions)
CREATE TABLE IF NOT EXISTS model_credit_costs (
	model_key TEXT PRIMARY KEY,
	cost INTEGER NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- Model credit cost rules by spec (same model, different spec prices)
CREATE TABLE IF NOT EXISTS model_credit_cost_specs (
	model_key TEXT NOT NULL,
	spec_key TEXT NOT NULL,
	cost INTEGER NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (model_key, spec_key)
);

CREATE INDEX IF NOT EXISTS idx_model_credit_cost_specs_model_key ON model_credit_cost_specs(model_key);

-- Daily active users (one row per user per UTC day)
CREATE TABLE IF NOT EXISTS user_activity_days (
	day TEXT NOT NULL,
	user_id TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	PRIMARY KEY (day, user_id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_activity_days_day ON user_activity_days(day);
CREATE INDEX IF NOT EXISTS idx_user_activity_days_user_id ON user_activity_days(user_id);

-- Projects table (migrated from Prisma Project model)
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	is_public INTEGER NOT NULL DEFAULT 0,
	owner_id TEXT,
	clone_count INTEGER NOT NULL DEFAULT 0,
	sort_weight INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	project_kind TEXT NOT NULL DEFAULT 'creative',
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_weight INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_kind TEXT NOT NULL DEFAULT 'creative';
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_public ON projects(is_public);
CREATE INDEX IF NOT EXISTS idx_projects_sort_weight ON projects(sort_weight DESC);
CREATE INDEX IF NOT EXISTS idx_projects_owner_kind_updated ON projects(owner_id, project_kind, updated_at DESC);

-- Flows table (migrated from Prisma Flow model)
CREATE TABLE IF NOT EXISTS flows (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	data TEXT NOT NULL,
	owner_id TEXT,
	project_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_flows_owner_id ON flows(owner_id);
CREATE INDEX IF NOT EXISTS idx_flows_project_id ON flows(project_id);

-- Flow versions table (history for flows)
CREATE TABLE IF NOT EXISTS flow_versions (
	id TEXT PRIMARY KEY,
	flow_id TEXT NOT NULL,
	name TEXT NOT NULL,
	data TEXT NOT NULL,
	user_id TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (flow_id) REFERENCES flows(id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id ON flow_versions(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_versions_user_id ON flow_versions(user_id);

-- User-approved workflow capabilities exposed to Small T.
-- The source version/hash are intentionally frozen so canvas edits cannot be
-- reused silently; runtime access is revalidated before every execution.
CREATE TABLE IF NOT EXISTS agent_capability_attachments (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	capability_kind TEXT NOT NULL,
	source_id TEXT NOT NULL,
	source_version_id TEXT NOT NULL,
	descriptor_json TEXT NOT NULL,
	descriptor_sha256 TEXT NOT NULL,
	conflict_report_json TEXT NOT NULL,
	route_decisions_json TEXT,
	conflict_report_revision INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_capability_attachments_user_source
	ON agent_capability_attachments(user_id, capability_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_agent_capability_attachments_user_updated
	ON agent_capability_attachments(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_capability_attachments_source_version
	ON agent_capability_attachments(source_version_id);

-- Per-user routing authority for Skills. An absent row means the visible Skill
-- remains enabled; disabled rows record whether the user switched it off or a
-- workflow explicitly replaced it as the single primary route.
CREATE TABLE IF NOT EXISTS agent_capability_preferences (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	capability_kind TEXT NOT NULL,
	capability_id TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	disabled_reason TEXT,
	replaced_by_capability_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_capability_preferences_user_capability
	ON agent_capability_preferences(user_id, capability_kind, capability_id);
CREATE INDEX IF NOT EXISTS idx_agent_capability_preferences_user_enabled
	ON agent_capability_preferences(user_id, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_capability_preferences_replaced_by
	ON agent_capability_preferences(replaced_by_capability_id);

-- Platform-wide authority for Small T built-in capabilities. Missing rows use
-- the enabled state declared by the built-in runtime catalog; an explicit
-- disabled row removes the capability for every user and every live session.
CREATE TABLE IF NOT EXISTS agent_builtin_capability_settings (
	capability_id TEXT PRIMARY KEY,
	enabled INTEGER NOT NULL DEFAULT 1,
	updated_by_user_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_builtin_capability_settings_enabled
	ON agent_builtin_capability_settings(enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_builtin_capability_settings_updated_by
	ON agent_builtin_capability_settings(updated_by_user_id);

-- Workflow executions (n8n-like: each run binds to an immutable flow_version snapshot)
CREATE TABLE IF NOT EXISTS workflow_executions (
	id TEXT PRIMARY KEY,
	flow_id TEXT NOT NULL,
	flow_version_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	status TEXT NOT NULL, -- queued | running | success | failed | canceled
	concurrency INTEGER NOT NULL DEFAULT 1,
	trigger TEXT, -- manual | api | schedule | agent
	error_message TEXT,
	created_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	FOREIGN KEY (flow_id) REFERENCES flows(id),
	FOREIGN KEY (flow_version_id) REFERENCES flow_versions(id),
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_owner_id ON workflow_executions(owner_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_flow_id ON workflow_executions(flow_id);

-- Immutable capability-call audit identity. Node inputs/outputs and timings are
-- read through the referenced frozen workflow execution and its node-run ledger.
CREATE TABLE IF NOT EXISTS agent_capability_invocations (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	attachment_id TEXT NOT NULL,
	capability_id TEXT NOT NULL,
	capability_name TEXT NOT NULL,
	source_id TEXT NOT NULL,
	source_version_id TEXT NOT NULL,
	descriptor_sha256 TEXT NOT NULL,
	workflow_execution_id TEXT NOT NULL,
	agent_execution_id TEXT,
	session_id TEXT,
	tool_call_id TEXT,
	input_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id),
	FOREIGN KEY (workflow_execution_id) REFERENCES workflow_executions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_capability_invocations_execution
	ON agent_capability_invocations(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_capability_invocations_user_created
	ON agent_capability_invocations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_capability_invocations_attachment_created
	ON agent_capability_invocations(attachment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_capability_invocations_agent_execution
	ON agent_capability_invocations(agent_execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_capability_invocations_session
	ON agent_capability_invocations(session_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_flow_version_id ON workflow_executions(flow_version_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_created_at ON workflow_executions(created_at);

-- Node runs (one row per node per execution; fail-fast => if any node_run fails, execution fails)
CREATE TABLE IF NOT EXISTS workflow_node_runs (
	id TEXT PRIMARY KEY,
	execution_id TEXT NOT NULL,
	node_id TEXT NOT NULL,
	status TEXT NOT NULL, -- pending | queued | running | waiting_external | success | failed | canceled | skipped | not_selected
	attempt INTEGER NOT NULL DEFAULT 1,
	error_message TEXT,
	output_refs TEXT, -- JSON: asset refs / URLs / metadata
	created_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_node_runs_execution_node ON workflow_node_runs(execution_id, node_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_execution_id ON workflow_node_runs(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_status ON workflow_node_runs(status);

-- Execution events / logs (append-only; ordered by seq)
CREATE TABLE IF NOT EXISTS workflow_execution_events (
	id TEXT PRIMARY KEY,
	execution_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	event_type TEXT NOT NULL, -- execution_started | node_started | node_log | node_succeeded | node_failed | execution_failed | execution_succeeded
	level TEXT NOT NULL DEFAULT 'info', -- debug | info | warn | error
	node_id TEXT, -- optional: bind log to a node
	message TEXT,
	data TEXT, -- JSON payload (optional)
	created_at TEXT NOT NULL,
	FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_execution_events_execution_seq ON workflow_execution_events(execution_id, seq);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_events_execution_id ON workflow_execution_events(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_events_node_id ON workflow_execution_events(node_id);

-- Model providers (Sora / OpenAI / etc.)
CREATE TABLE IF NOT EXISTS model_providers (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	vendor TEXT NOT NULL,
	base_url TEXT,
	shared_base_url INTEGER NOT NULL DEFAULT 0,
	owner_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_model_providers_owner_id ON model_providers(owner_id);
CREATE INDEX IF NOT EXISTS idx_model_providers_vendor ON model_providers(vendor);

-- Model tokens (API keys)
CREATE TABLE IF NOT EXISTS model_tokens (
	id TEXT PRIMARY KEY,
	provider_id TEXT NOT NULL,
	label TEXT NOT NULL,
	secret_token TEXT NOT NULL,
	user_agent TEXT,
	user_id TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	shared INTEGER NOT NULL DEFAULT 0,
	shared_failure_count INTEGER NOT NULL DEFAULT 0,
	shared_last_failure_at TEXT,
	shared_disabled_until TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (provider_id) REFERENCES model_providers(id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_model_tokens_user_id ON model_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_model_tokens_provider_id ON model_tokens(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_tokens_shared ON model_tokens(shared);

-- Model endpoints (per provider)
CREATE TABLE IF NOT EXISTS model_endpoints (
	id TEXT PRIMARY KEY,
	provider_id TEXT NOT NULL,
	key TEXT NOT NULL,
	label TEXT NOT NULL,
	base_url TEXT NOT NULL,
	shared INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (provider_id) REFERENCES model_providers(id),
	UNIQUE (provider_id, key)
);

CREATE INDEX IF NOT EXISTS idx_model_endpoints_provider_id ON model_endpoints(provider_id);

-- Proxy providers (e.g. grsai, vendor routers)
CREATE TABLE IF NOT EXISTS proxy_providers (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	name TEXT NOT NULL,
	vendor TEXT NOT NULL,
	base_url TEXT,
	api_key TEXT,
	enabled INTEGER NOT NULL DEFAULT 0,
	enabled_vendors TEXT,
	settings TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	UNIQUE (owner_id, vendor)
);

CREATE INDEX IF NOT EXISTS idx_proxy_providers_owner_vendor ON proxy_providers(owner_id, vendor);

-- Task token mappings (which token was used for which Sora task)
CREATE TABLE IF NOT EXISTS task_token_mappings (
	id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	token_id TEXT NOT NULL,
	provider TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	FOREIGN KEY (token_id) REFERENCES model_tokens(id),
	FOREIGN KEY (user_id) REFERENCES users(id),
	UNIQUE (task_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_task_token_mappings_user_provider ON task_token_mappings(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_task_token_mappings_expires_at ON task_token_mappings(expires_at);

-- Task statuses (tracking async tasks like Sora generations)
CREATE TABLE IF NOT EXISTS task_statuses (
	id TEXT PRIMARY KEY,
	task_id TEXT NOT NULL,
	provider TEXT NOT NULL,
	user_id TEXT,
	status TEXT NOT NULL,
	data TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id),
	UNIQUE (task_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_task_statuses_status ON task_statuses(status);
CREATE INDEX IF NOT EXISTS idx_task_statuses_created_at ON task_statuses(created_at);
CREATE INDEX IF NOT EXISTS idx_task_statuses_user_provider ON task_statuses(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_task_statuses_provider_status_created
	ON task_statuses(provider, status, created_at);
CREATE INDEX IF NOT EXISTS idx_task_statuses_provider_status_updated
	ON task_statuses(provider, status, updated_at);

-- Immutable, version-pinned workflow plugin manifests. A manifest never grants
-- authority by itself; workflow_plugin_admissions is the independent host decision.
CREATE TABLE IF NOT EXISTS workflow_plugin_versions (
	id TEXT PRIMARY KEY,
	plugin_id TEXT NOT NULL,
	plugin_version TEXT NOT NULL,
	publisher_kind TEXT NOT NULL CHECK (publisher_kind IN ('platform', 'user', 'team')),
	publisher_id TEXT NOT NULL,
	manifest_json TEXT NOT NULL,
	manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
	runtime_owner_kind TEXT NOT NULL CHECK (runtime_owner_kind IN ('host', 'agents-cli', 'hono-api', 'isolated-worker')),
	runtime_owner_id TEXT NOT NULL,
	runtime_version TEXT NOT NULL,
	created_by_actor TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_plugin_versions_identity
	ON workflow_plugin_versions(plugin_id, plugin_version);
CREATE INDEX IF NOT EXISTS idx_workflow_plugin_versions_manifest_sha256
	ON workflow_plugin_versions(manifest_sha256);
CREATE INDEX IF NOT EXISTS idx_workflow_plugin_versions_publisher
	ON workflow_plugin_versions(publisher_kind, publisher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_plugin_versions_runtime_owner
	ON workflow_plugin_versions(runtime_owner_kind, runtime_owner_id, runtime_version);

CREATE TABLE IF NOT EXISTS workflow_plugin_admissions (
	id TEXT PRIMARY KEY,
	plugin_version_id TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('admitted', 'revoked')),
	granted_permissions_json TEXT NOT NULL,
	decision_revision INTEGER NOT NULL DEFAULT 1 CHECK (decision_revision > 0),
	decided_by_actor TEXT NOT NULL,
	reason TEXT,
	admitted_at TEXT NOT NULL,
	revoked_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (plugin_version_id) REFERENCES workflow_plugin_versions(id) ON DELETE RESTRICT,
	CHECK ((status = 'admitted' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_plugin_admissions_version
	ON workflow_plugin_admissions(plugin_version_id);
CREATE INDEX IF NOT EXISTS idx_workflow_plugin_admissions_status_updated
	ON workflow_plugin_admissions(status, updated_at DESC);

-- Task results (stored final results for sync vendors / unified polling)
CREATE TABLE IF NOT EXISTS task_results (
	user_id TEXT NOT NULL,
	task_id TEXT NOT NULL,
	vendor TEXT NOT NULL,
	kind TEXT NOT NULL,
	status TEXT NOT NULL,
	result TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	PRIMARY KEY (user_id, task_id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_task_results_user_updated_at ON task_results(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_task_results_user_status ON task_results(user_id, status);

-- Video generation history (for Sora and other providers)
CREATE TABLE IF NOT EXISTS video_generation_histories (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	node_id TEXT,
	project_id TEXT,
	prompt TEXT NOT NULL,
	parameters TEXT,
	image_url TEXT,
	task_id TEXT NOT NULL,
	generation_id TEXT,
	status TEXT NOT NULL,
	video_url TEXT,
	thumbnail_url TEXT,
	duration INTEGER,
	width INTEGER,
	height INTEGER,
	token_id TEXT,
	provider TEXT NOT NULL,
	model TEXT,
	cost REAL,
	is_favorite INTEGER NOT NULL DEFAULT 0,
	rating INTEGER,
	notes TEXT,
	remix_target_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_video_history_user ON video_generation_histories(user_id);
CREATE INDEX IF NOT EXISTS idx_video_history_task ON video_generation_histories(task_id);
CREATE INDEX IF NOT EXISTS idx_video_history_provider ON video_generation_histories(provider);

-- 视频整片后台自主驱动（L3）：持久化一次整章 run 的状态，供后台 worker 续跑到 concatenated。
CREATE TABLE IF NOT EXISTS video_runs (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  flow_id       TEXT,
  project_id    TEXT,
  chapter_id    TEXT,
  recipe_id     TEXT,
  state         TEXT NOT NULL DEFAULT 'scheduled',
  story_plan    TEXT,
  total_clips   INTEGER NOT NULL DEFAULT 0,
  clips_done    INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  last_drive_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_video_runs_state_updated ON video_runs(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_video_runs_flow_state ON video_runs(flow_id, state);

-- Vendor task refs (mapping vendor task ids to pid for follow-up operations)
CREATE TABLE IF NOT EXISTS vendor_task_refs (
	user_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	task_id TEXT NOT NULL,
	vendor TEXT NOT NULL,
	pid TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (user_id, kind, task_id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_task_refs_user_kind_pid ON vendor_task_refs(user_id, kind, pid);
CREATE INDEX IF NOT EXISTS idx_vendor_task_refs_user_kind_vendor ON vendor_task_refs(user_id, kind, vendor);

-- Saved Sora characters (local cache for @mentions, e.g. comfly character creation)
CREATE TABLE IF NOT EXISTS sora_saved_characters (
	user_id TEXT NOT NULL,
	character_id TEXT NOT NULL,
	username TEXT NOT NULL,
	permalink TEXT,
	profile_picture_url TEXT,
	source TEXT NOT NULL DEFAULT 'comfly',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (user_id, character_id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sora_saved_characters_user_id ON sora_saved_characters(user_id);
CREATE INDEX IF NOT EXISTS idx_sora_saved_characters_user_username ON sora_saved_characters(user_id, username);
CREATE INDEX IF NOT EXISTS idx_sora_saved_characters_updated_at ON sora_saved_characters(updated_at);

-- Model profiles (logical presets for AI tasks)
CREATE TABLE IF NOT EXISTS model_profiles (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	model_key TEXT NOT NULL,
	settings TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (provider_id) REFERENCES model_providers(id)
);

CREATE INDEX IF NOT EXISTS idx_model_profiles_owner ON model_profiles(owner_id);
CREATE INDEX IF NOT EXISTS idx_model_profiles_provider ON model_profiles(provider_id);

-- Model catalog (admin-configurable vendors/models/mappings)
CREATE TABLE IF NOT EXISTS model_catalog_vendors (
	key TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	base_url_hint TEXT,
	auth_type TEXT NOT NULL DEFAULT 'bearer', -- none | bearer | x-api-key | query
	auth_header TEXT,
	auth_query_param TEXT,
	meta TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- System-level vendor API keys (admin-managed, not exported/imported)
CREATE TABLE IF NOT EXISTS model_catalog_vendor_api_keys (
	vendor_key TEXT PRIMARY KEY,
	api_key TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS model_catalog_models (
	model_key TEXT NOT NULL,
	vendor_key TEXT NOT NULL,
	model_alias TEXT,
	label_zh TEXT NOT NULL,
	kind TEXT NOT NULL, -- text | image | video
	enabled INTEGER NOT NULL DEFAULT 1,
	meta TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (vendor_key, model_key),
	FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_models_vendor_kind ON model_catalog_models(vendor_key, kind);
CREATE INDEX IF NOT EXISTS idx_model_catalog_models_enabled ON model_catalog_models(enabled);

CREATE TABLE IF NOT EXISTS model_catalog_mappings (
	id TEXT PRIMARY KEY,
	vendor_key TEXT NOT NULL,
	task_kind TEXT NOT NULL, -- chat | prompt_refine | text_to_image | image_to_prompt | image_to_video | text_to_video | image_edit
	name TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	request_mapping TEXT, -- JSON
	response_mapping TEXT, -- JSON
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key) ON DELETE CASCADE,
	UNIQUE (vendor_key, task_kind, name)
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_mappings_vendor_kind ON model_catalog_mappings(vendor_key, task_kind);

-- Prompt samples (user-defined prompt library)
CREATE TABLE IF NOT EXISTS prompt_samples (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	node_kind TEXT NOT NULL,
	scene TEXT NOT NULL,
	command_type TEXT NOT NULL,
	title TEXT NOT NULL,
	prompt TEXT NOT NULL,
	description TEXT,
	input_hint TEXT,
	output_note TEXT,
	keywords TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_samples_user ON prompt_samples(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_samples_user_kind ON prompt_samples(user_id, node_kind);

-- LLM node prompt presets (base presets by admin + per-user presets)
CREATE TABLE IF NOT EXISTS llm_node_presets (
	id TEXT PRIMARY KEY,
	owner_id TEXT,
	scope TEXT NOT NULL, -- base | user
	preset_type TEXT NOT NULL, -- text | image | video
	title TEXT NOT NULL,
	prompt TEXT NOT NULL,
	description TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER,
	meta TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_llm_node_presets_scope_type_enabled ON llm_node_presets(scope, preset_type, enabled);
CREATE INDEX IF NOT EXISTS idx_llm_node_presets_owner_type ON llm_node_presets(owner_id, preset_type);

-- Agents: skills (admin-configurable) and presets (user-facing)
CREATE TABLE IF NOT EXISTS agent_skills (
	id TEXT PRIMARY KEY,
	key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	content TEXT NOT NULL,
	logo_url TEXT,
	category TEXT NOT NULL DEFAULT '系统技能',
	enabled INTEGER NOT NULL DEFAULT 1,
	visible INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled_visible_sort ON agent_skills(enabled, visible, sort_order);

CREATE TABLE IF NOT EXISTS user_skill_assets (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	file_name TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT,
	content TEXT NOT NULL,
	logo_url TEXT,
	force_full_context INTEGER NOT NULL DEFAULT 0,
	size_bytes INTEGER NOT NULL,
	sha256 TEXT NOT NULL,
	marketplace_product_id TEXT,
	marketplace_price_cents INTEGER,
	marketplace_currency TEXT,
	marketplace_listed_at TEXT,
	source_marketplace_product_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skill_assets_owner_file ON user_skill_assets(owner_id, file_name);
CREATE INDEX IF NOT EXISTS idx_user_skill_assets_owner_updated ON user_skill_assets(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_skill_assets_marketplace_product ON user_skill_assets(marketplace_product_id);
CREATE INDEX IF NOT EXISTS idx_user_skill_assets_source_product ON user_skill_assets(source_marketplace_product_id);

CREATE TABLE IF NOT EXISTS agent_presets (
	id TEXT PRIMARY KEY,
	key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	system_prompt TEXT,
	opening_message TEXT,
	skill_ids TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	visible INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_presets_enabled_visible_sort ON agent_presets(enabled, visible, sort_order);

CREATE TABLE IF NOT EXISTS agent_pipeline_runs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	title TEXT NOT NULL,
	goal TEXT,
	status TEXT NOT NULL, -- queued | running | succeeded | failed | canceled
	stages_json TEXT NOT NULL,
	progress_json TEXT,
	result_json TEXT,
	error_message TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_pipeline_runs_owner_project_updated ON agent_pipeline_runs(owner_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_pipeline_runs_owner_status_updated ON agent_pipeline_runs(owner_id, status, updated_at DESC);

-- User assets (stored as JSON blobs)
CREATE TABLE IF NOT EXISTS assets (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	data TEXT,
	owner_id TEXT NOT NULL,
	project_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_owner_active_project_directory
	ON assets(owner_id)
	WHERE project_id IS NULL
		AND (data::jsonb ->> 'kind') = 'projectFsState';

-- Storyboard pipeline (plan/render/rerender/timeline/metrics)
CREATE TABLE IF NOT EXISTS storyboard_assets (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	kind TEXT NOT NULL, -- character | scene | prop | style
	name TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	prompt_pack_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storyboard_assets_owner_project ON storyboard_assets(owner_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS storyboard_asset_views (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	view_kind TEXT NOT NULL, -- front | back | left | right | side
	image_url TEXT NOT NULL,
	metadata_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (asset_id) REFERENCES storyboard_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_asset_views_asset_view ON storyboard_asset_views(asset_id, view_kind);

CREATE TABLE IF NOT EXISTS storyboard_shots (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	chunk_index INTEGER NOT NULL,
	shot_index INTEGER NOT NULL,
	scene_asset_id TEXT NOT NULL,
	character_asset_ids TEXT NOT NULL, -- JSON array
	prop_asset_ids TEXT NOT NULL, -- JSON array
	camera_plan_json TEXT NOT NULL,
	lighting_plan_json TEXT NOT NULL,
	continuity_tail_frame_url TEXT,
	status TEXT NOT NULL, -- queued | running | succeeded | failed
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, chunk_index, shot_index)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_shots_owner_project ON storyboard_shots(owner_id, project_id, chunk_index, shot_index);

CREATE TABLE IF NOT EXISTS storyboard_render_jobs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	shot_id TEXT NOT NULL,
	model_key TEXT NOT NULL,
	mode TEXT NOT NULL, -- cost | quality | balanced
	params_json TEXT NOT NULL,
	seed INTEGER,
	status TEXT NOT NULL, -- queued | running | succeeded | failed
	output_video_url TEXT,
	output_last_frame_url TEXT,
	cost_cents INTEGER,
	latency_ms INTEGER,
	fail_code TEXT,
	fail_reason TEXT,
	based_on_job_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
	FOREIGN KEY (based_on_job_id) REFERENCES storyboard_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_shot_created ON storyboard_render_jobs(shot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_owner_project ON storyboard_render_jobs(owner_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS storyboard_timeline_tracks (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	shot_id TEXT NOT NULL,
	active_job_id TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	audio_track_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, shot_id),
	FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
	FOREIGN KEY (active_job_id) REFERENCES storyboard_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_timeline_tracks_owner_project ON storyboard_timeline_tracks(owner_id, project_id, position);

CREATE TABLE IF NOT EXISTS storyboard_diagnostic_logs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	shot_id TEXT,
	job_id TEXT,
	stage TEXT NOT NULL,
	level TEXT NOT NULL,
	message TEXT NOT NULL,
	summary_json TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
	FOREIGN KEY (job_id) REFERENCES storyboard_render_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_storyboard_diagnostic_owner_project_stage ON storyboard_diagnostic_logs(owner_id, project_id, stage, created_at DESC);

-- Material hub (asset/version/shot-binding)
CREATE TABLE IF NOT EXISTS material_assets (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	kind TEXT NOT NULL, -- character | scene | prop | style
	name TEXT NOT NULL,
	current_version INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_assets_owner_project ON material_assets(owner_id, project_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS material_asset_versions (
	id TEXT PRIMARY KEY,
	asset_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	data_json TEXT NOT NULL,
	note TEXT,
	created_at TEXT NOT NULL,
	UNIQUE (asset_id, version),
	FOREIGN KEY (asset_id) REFERENCES material_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_material_versions_asset ON material_asset_versions(asset_id, version DESC);

CREATE TABLE IF NOT EXISTS shot_material_refs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	shot_id TEXT NOT NULL,
	asset_id TEXT NOT NULL,
	asset_version INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, shot_id, asset_id),
	FOREIGN KEY (asset_id) REFERENCES material_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_shot_material_refs_owner_project ON shot_material_refs(owner_id, project_id, shot_id);

-- Vendor API call logs (one row per vendor task; final status driven by whether a resource is produced)
CREATE TABLE IF NOT EXISTS vendor_api_call_logs (
	user_id TEXT NOT NULL,
	vendor TEXT NOT NULL,
	task_id TEXT NOT NULL,
	task_kind TEXT,
	status TEXT NOT NULL, -- running | succeeded | failed
	started_at TEXT,
	finished_at TEXT,
	duration_ms INTEGER,
	error_message TEXT,
	request_json TEXT,
	response_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (user_id, vendor, task_id),
	FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_vendor_finished_at ON vendor_api_call_logs(vendor, finished_at);
CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_finished_at ON vendor_api_call_logs(finished_at);
CREATE INDEX IF NOT EXISTS idx_vendor_api_call_logs_status ON vendor_api_call_logs(status);
ALTER TABLE vendor_api_call_logs ADD COLUMN IF NOT EXISTS request_json TEXT;
ALTER TABLE vendor_api_call_logs ADD COLUMN IF NOT EXISTS response_json TEXT;

-- API request logs (slow/aborted requests; debug tracing)
CREATE TABLE IF NOT EXISTS api_request_logs (
	id TEXT PRIMARY KEY,
	user_id TEXT,
	api_key_id TEXT,
	method TEXT NOT NULL,
	path TEXT NOT NULL,
	status INTEGER,
	stage TEXT,
	aborted INTEGER NOT NULL DEFAULT 0,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	duration_ms INTEGER,
	trace_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_started_at ON api_request_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_path_started_at ON api_request_logs(path, started_at);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_started_at ON api_request_logs(user_id, started_at);

-- Prompt evolution task center (history + runtime policy)
CREATE TABLE IF NOT EXISTS prompt_evolution_runs (
	id TEXT PRIMARY KEY,
	actor_user_id TEXT,
	since_hours INTEGER NOT NULL,
	min_samples INTEGER NOT NULL,
	dry_run INTEGER NOT NULL DEFAULT 1,
	action TEXT NOT NULL, -- ready_for_optimizer | skip
	metrics_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_evolution_runs_created_at ON prompt_evolution_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_evolution_runtime (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	active_run_id TEXT,
	canary_percent INTEGER NOT NULL DEFAULT 5,
	status TEXT NOT NULL DEFAULT 'idle', -- idle | active | rolled_back
	last_action TEXT,
	note TEXT,
	updated_at TEXT NOT NULL,
	updated_by TEXT
);

-- External API keys (for browser/server clients; enforce Origin allowlist at runtime)
CREATE TABLE IF NOT EXISTS api_keys (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	label TEXT NOT NULL,
	key_prefix TEXT NOT NULL,
	key_hash TEXT NOT NULL,
	allowed_origins TEXT NOT NULL, -- JSON array of origins or ["*"]
	enabled INTEGER NOT NULL DEFAULT 1,
	kind TEXT NOT NULL DEFAULT 'user', -- 'user' | 'internal_system'
	last_used_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(owner_id);

-- Commerce catalog: products remain available for administrator-managed entitlements.
CREATE TABLE IF NOT EXISTS merchants (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active', -- active | inactive
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_merchants_owner_id ON merchants(owner_id);
CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);

CREATE TABLE IF NOT EXISTS products (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	merchant_id TEXT NOT NULL,
	title TEXT NOT NULL,
	subtitle TEXT,
	description TEXT,
	currency TEXT NOT NULL DEFAULT 'CNY',
	price_cents INTEGER NOT NULL DEFAULT 0,
	stock INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'draft', -- draft | active | inactive
	cover_image_url TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_products_owner_updated ON products(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_merchant_updated ON products(merchant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS product_images (
	id TEXT PRIMARY KEY,
	product_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	image_url TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_sort ON product_images(product_id, sort_order);

CREATE TABLE IF NOT EXISTS product_skus (
	id TEXT PRIMARY KEY,
	product_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	merchant_id TEXT NOT NULL,
	name TEXT NOT NULL,
	spec TEXT NOT NULL DEFAULT '',
	price_cents INTEGER NOT NULL DEFAULT 0,
	stock INTEGER NOT NULL DEFAULT 0,
	is_default INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'active', -- draft | active | inactive
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_product_skus_product ON product_skus(product_id);
CREATE INDEX IF NOT EXISTS idx_product_skus_owner ON product_skus(owner_id);

-- Commerce dictionary (owner-scoped enum/config dictionary)
CREATE TABLE IF NOT EXISTS commerce_dictionaries (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	dict_type TEXT NOT NULL,
	code TEXT NOT NULL,
	name TEXT NOT NULL,
	value_json TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (owner_id, dict_type, code),
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_dict_owner_type_sort ON commerce_dictionaries(owner_id, dict_type, sort_order, code);

-- Product entitlement config (points topup / monthly quota etc.)
CREATE TABLE IF NOT EXISTS product_entitlements (
	id TEXT PRIMARY KEY,
	product_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	entitlement_type TEXT NOT NULL DEFAULT 'none', -- none | points_topup | membership
	config_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (owner_id, product_id),
	FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_product_entitlements_owner_type ON product_entitlements(owner_id, entitlement_type);

-- Detail page sample library (owner-scoped; for retrieval-augmented generation)
CREATE TABLE IF NOT EXISTS detail_page_samples (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	title TEXT NOT NULL,
	category TEXT NOT NULL,
	tags_json TEXT NOT NULL DEFAULT '[]',
	source TEXT,
	image_url TEXT,
	summary TEXT,
	modules_json TEXT,
	copy_json TEXT,
	style_json TEXT,
	score_quality REAL NOT NULL DEFAULT 0,
	score_visual REAL NOT NULL DEFAULT 0,
	score_conversion REAL NOT NULL DEFAULT 0,
	usage_count INTEGER NOT NULL DEFAULT 0,
	last_used_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_detail_page_samples_owner_updated ON detail_page_samples(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_detail_page_samples_owner_category ON detail_page_samples(owner_id, category, updated_at DESC);

CREATE TABLE IF NOT EXISTS detail_page_retrieval_logs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	query_text TEXT,
	category TEXT,
	sample_id TEXT NOT NULL,
	rank_no INTEGER NOT NULL DEFAULT 0,
	score REAL NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (sample_id) REFERENCES detail_page_samples(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_detail_page_retrieval_logs_owner_created ON detail_page_retrieval_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detail_page_retrieval_logs_owner_sample ON detail_page_retrieval_logs(owner_id, sample_id, created_at DESC);

CREATE TABLE IF NOT EXISTS detail_page_feedback_logs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	generation_id TEXT,
	sample_id TEXT NOT NULL,
	score_overall INTEGER NOT NULL,
	score_structure INTEGER,
	score_visual INTEGER,
	score_conversion INTEGER,
	edit_ratio REAL,
	note TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (sample_id) REFERENCES detail_page_samples(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_detail_page_feedback_logs_owner_created ON detail_page_feedback_logs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detail_page_feedback_logs_owner_sample ON detail_page_feedback_logs(owner_id, sample_id, created_at DESC);

CREATE TABLE IF NOT EXISTS detail_page_evolution_runs (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	min_feedbacks INTEGER NOT NULL,
	action TEXT NOT NULL,
	metrics_json TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_detail_page_evolution_runs_owner_created ON detail_page_evolution_runs(owner_id, created_at DESC);

-- Points account and ledger
CREATE TABLE IF NOT EXISTS points_accounts (
	owner_id TEXT PRIMARY KEY,
	balance INTEGER NOT NULL DEFAULT 0,
	total_earned INTEGER NOT NULL DEFAULT 0,
	total_spent INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS points_ledger (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	change_amount INTEGER NOT NULL,
	balance_after INTEGER NOT NULL,
	source_type TEXT NOT NULL, -- order_paid | consume | manual_adjust | refund_revert
	source_id TEXT,
	note TEXT,
	idempotency_key TEXT NOT NULL,
	created_at TEXT NOT NULL,
	UNIQUE (owner_id, idempotency_key),
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_owner_created ON points_ledger(owner_id, created_at DESC);

-- Subscriptions and daily quota buckets
CREATE TABLE IF NOT EXISTS subscriptions (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	plan_code TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active', -- active | expired | canceled
	start_at TEXT NOT NULL,
	end_at TEXT NOT NULL,
	duration_days INTEGER NOT NULL,
	daily_limit INTEGER NOT NULL,
	billing_team_id TEXT,
	billing_cycle TEXT NOT NULL DEFAULT 'monthly',
	monthly_credits INTEGER NOT NULL DEFAULT 0,
	daily_gift_credits INTEGER NOT NULL DEFAULT 0,
	concurrency_limit INTEGER NOT NULL DEFAULT 1,
	capacity_label TEXT NOT NULL DEFAULT '',
	credit_grant_count INTEGER NOT NULL DEFAULT 1,
	credit_grants_issued INTEGER NOT NULL DEFAULT 0,
	next_credit_grant_at TEXT,
	timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	canceled_at TEXT,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- CREATE TABLE IF NOT EXISTS is a no-op on deployments where `subscriptions`
-- predates the membership-credit columns, so the columns above never appear and
-- the credit-due index below fails with 42703. Backfill them explicitly, like
-- every other evolved table in this file.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_team_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_cycle TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS monthly_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS daily_gift_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS concurrency_limit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS capacity_label TEXT NOT NULL DEFAULT '';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS credit_grant_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS credit_grants_issued INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS next_credit_grant_at TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_owner_status_time ON subscriptions(owner_id, status, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_membership_credit_due ON subscriptions(status, next_credit_grant_at);

CREATE TABLE IF NOT EXISTS membership_credit_grants (
	id TEXT PRIMARY KEY,
	subscription_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	team_id TEXT NOT NULL,
	grant_type TEXT NOT NULL,
	grant_key TEXT NOT NULL,
	amount INTEGER NOT NULL,
	granted_at TEXT NOT NULL,
	expires_at TEXT,
	expired_amount INTEGER NOT NULL DEFAULT 0,
	processed_at TEXT,
	UNIQUE (subscription_id, grant_type, grant_key),
	FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE INDEX IF NOT EXISTS idx_membership_credit_grants_owner_time ON membership_credit_grants(owner_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_credit_grants_team_time ON membership_credit_grants(team_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_credit_grants_expiry ON membership_credit_grants(grant_type, expires_at, processed_at);

CREATE TABLE IF NOT EXISTS subscription_daily_quotas (
	id TEXT PRIMARY KEY,
	subscription_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	quota_date TEXT NOT NULL, -- YYYY-MM-DD in business timezone
	daily_limit INTEGER NOT NULL,
	used_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (subscription_id, quota_date),
	FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_daily_quotas_owner_date ON subscription_daily_quotas(owner_id, quota_date);

CREATE TABLE IF NOT EXISTS subscription_quota_events (
	id TEXT PRIMARY KEY,
	subscription_id TEXT NOT NULL,
	owner_id TEXT NOT NULL,
	quota_date TEXT NOT NULL,
	delta INTEGER NOT NULL, -- positive consume, negative rollback
	idempotency_key TEXT NOT NULL,
	reason TEXT,
	created_at TEXT NOT NULL,
	UNIQUE (subscription_id, idempotency_key),
	FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_quota_events_owner_created ON subscription_quota_events(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chapters (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	chapter_index INTEGER NOT NULL,
	title TEXT NOT NULL,
	summary TEXT,
	status TEXT NOT NULL,
	sort_order INTEGER NOT NULL,
	cover_asset_id TEXT,
	continuity_context TEXT,
	style_profile_override TEXT,
	legacy_chunk_index INTEGER,
	source_book_id TEXT,
	source_book_chapter INTEGER,
	last_worked_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (project_id, chapter_index),
	FOREIGN KEY (owner_id) REFERENCES users(id),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_chapters_owner_project_sort ON chapters(owner_id, project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_chapters_project_last_worked ON chapters(project_id, last_worked_at);
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS canvas_flow TEXT;

-- Public prompt library. Original attribution is retained as provenance while
-- the public card author remains the fixed collection label.
CREATE TABLE IF NOT EXISTS prompt_library_entries (
  id TEXT PRIMARY KEY,
  canonical_hash TEXT NOT NULL CONSTRAINT idx_prompt_library_entries_hash UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  prompt_text TEXT NOT NULL,
  prompt_text_original TEXT,
  media_type TEXT NOT NULL,
  author_label TEXT NOT NULL DEFAULT '搜集自网络',
  published_at TEXT,
  latest_source_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  community_like_count INTEGER NOT NULL DEFAULT 0,
  community_comment_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_entries_media_latest ON prompt_library_entries(media_type, latest_source_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_library_entries_updated ON prompt_library_entries(updated_at DESC);

CREATE TABLE IF NOT EXISTS prompt_library_sources (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
  source_site TEXT NOT NULL,
  source_prompt_id TEXT NOT NULL,
  source_url TEXT NOT NULL CONSTRAINT idx_prompt_library_sources_url UNIQUE,
  source_author TEXT,
  source_author_url TEXT,
  original_language TEXT,
  model_slug TEXT NOT NULL,
  model_name TEXT NOT NULL,
  original_source_url TEXT,
  categories_json TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  share_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  quote_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_sources_entry ON prompt_library_sources(entry_id);
CREATE INDEX IF NOT EXISTS idx_prompt_library_sources_model_fetched ON prompt_library_sources(model_slug, fetched_at DESC);

CREATE TABLE IF NOT EXISTS prompt_library_models (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
  model_slug TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT idx_prompt_library_models_entry_slug UNIQUE(entry_id, model_slug)
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_models_slug ON prompt_library_models(model_slug);

CREATE TABLE IF NOT EXISTS prompt_library_media (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES prompt_library_sources(id) ON DELETE SET NULL,
  media_kind TEXT NOT NULL,
  media_url TEXT NOT NULL,
  thumbnail_url TEXT,
  width INTEGER,
  height INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CONSTRAINT idx_prompt_library_media_entry_url UNIQUE(entry_id, media_url)
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_media_entry_order ON prompt_library_media(entry_id, sort_order);

-- Community reactions for crawled prompt-library entries.
CREATE TABLE IF NOT EXISTS prompt_library_likes (
	id TEXT PRIMARY KEY,
	entry_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (entry_id) REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	UNIQUE (entry_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_likes_entry ON prompt_library_likes(entry_id);
CREATE INDEX IF NOT EXISTS idx_prompt_library_likes_user ON prompt_library_likes(user_id);

CREATE TABLE IF NOT EXISTS prompt_library_comments (
	id TEXT PRIMARY KEY,
	entry_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	content TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (entry_id) REFERENCES prompt_library_entries(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_comments_entry_created ON prompt_library_comments(entry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_library_comments_user ON prompt_library_comments(user_id);

CREATE TABLE IF NOT EXISTS prompt_library_crawl_runs (
  id TEXT PRIMARY KEY,
  target_site TEXT NOT NULL,
  status TEXT NOT NULL,
  actor_user_id TEXT,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  deduplicated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  current_url TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_crawl_runs_status_created ON prompt_library_crawl_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_library_crawl_targets (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES prompt_library_crawl_runs(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_prompt_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  entry_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT idx_prompt_library_crawl_targets_run_url UNIQUE(run_id, source_url)
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_crawl_targets_run_status ON prompt_library_crawl_targets(run_id, status, created_at);
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS canvas_flow_revision INTEGER NOT NULL DEFAULT 0;

-- Referral campaign configuration (single row, id=1)
CREATE TABLE IF NOT EXISTS referral_config (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	enabled INTEGER NOT NULL DEFAULT 0,
	title TEXT NOT NULL DEFAULT '邀请好友，注册赠送',
	body TEXT NOT NULL DEFAULT '好友完成注册后获得欢迎额度',
	cta_text TEXT NOT NULL DEFAULT '复制我的邀请链接',
	image_url TEXT,
	anti_self_check INTEGER NOT NULL DEFAULT 1,
	anti_self_window_days INTEGER NOT NULL DEFAULT 30,
	invitee_welcome_credits INTEGER NOT NULL DEFAULT 1000,
	updated_at TEXT NOT NULL
);

-- Referral bonus grant log (idempotency + audit)
CREATE TABLE IF NOT EXISTS referral_grant_log (
	id TEXT PRIMARY KEY,
	source_topup_ledger_id TEXT NOT NULL,
	referrer_user_id TEXT NOT NULL,
	invitee_user_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	granted_credits INTEGER NOT NULL,
	ledger_entry_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	UNIQUE(source_topup_ledger_id, referrer_user_id, kind),
	FOREIGN KEY (referrer_user_id) REFERENCES users(id),
	FOREIGN KEY (invitee_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_referral_grant_log_referrer
	ON referral_grant_log(referrer_user_id, created_at);

-- 【编排域状态机 P1·2026-07-11】BeatSheet/authoring 态/依赖图底座/章级合同（与 prisma migration 20260711150000 同步）。
ALTER TABLE video_runs ADD COLUMN IF NOT EXISTS film_bible TEXT;
ALTER TABLE video_runs ADD COLUMN IF NOT EXISTS adaptation_strategy TEXT;
ALTER TABLE video_runs ADD COLUMN IF NOT EXISTS beat_sheet TEXT;
ALTER TABLE video_runs ADD COLUMN IF NOT EXISTS authoring_state TEXT;
CREATE INDEX IF NOT EXISTS idx_video_runs_authoring_state ON video_runs(authoring_state, updated_at);
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS adaptation_contract TEXT;
CREATE TABLE IF NOT EXISTS authoring_artifacts (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	artifact_key TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	derived_from TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|waiting_external|ready|failed|stale
	payload TEXT,
	error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_authoring_artifacts_run_key ON authoring_artifacts(run_id, artifact_key);
CREATE INDEX IF NOT EXISTS idx_authoring_artifacts_run_status ON authoring_artifacts(run_id, status);

-- One-click production external effect ledger + append-only bounded workflow events.
CREATE TABLE IF NOT EXISTS production_effects (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	workflow_node_id TEXT NOT NULL CHECK (workflow_node_id IN ('production-contract','story-adaptation','clip-contracts','asset-preparation','media-production','composition','delivery')),
	effect_key TEXT NOT NULL,
	revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
	operation TEXT NOT NULL,
	input_hash TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','submitting','accepted','materialized','rejected_pre_upstream','uncertain','failed','cancelled')),
	provider TEXT,
	provider_task_id TEXT,
	provider_receipt TEXT,
	asset_url TEXT,
	error_code TEXT,
	error_message TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	accepted_at TEXT,
	materialized_at TEXT,
	finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_effects_run_key_revision ON production_effects(run_id, effect_key, revision);
CREATE INDEX IF NOT EXISTS idx_production_effects_run_node_status ON production_effects(run_id, workflow_node_id, status);
CREATE INDEX IF NOT EXISTS idx_production_effects_provider_task ON production_effects(provider, provider_task_id);

CREATE TABLE IF NOT EXISTS production_workflow_events (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	seq INTEGER NOT NULL CHECK (seq > 0),
	workflow_node_id TEXT NOT NULL CHECK (workflow_node_id IN ('production-contract','story-adaptation','clip-contracts','asset-preparation','media-production','composition','delivery')),
	event_kind TEXT NOT NULL CHECK (event_kind IN ('agent_turn','tool_call','effect','artifact','diagnostic','status')),
	payload_ref TEXT,
	artifact_ids TEXT NOT NULL DEFAULT '[]',
	effect_ids TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_workflow_events_run_seq ON production_workflow_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_production_workflow_events_run_node_seq ON production_workflow_events(run_id, workflow_node_id, seq);

-- Durable AI execution journal. Deploy migrations own this schema; the API
-- request path performs readiness checks only and never creates/changes it.
CREATE TABLE IF NOT EXISTS execution_traces (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	scope_type TEXT NOT NULL,
	scope_id TEXT NOT NULL,
	task_id TEXT,
	request_kind TEXT NOT NULL,
	input_summary TEXT NOT NULL,
	decision_log_json TEXT,
	tool_calls_json TEXT,
	meta_json TEXT,
	result_summary TEXT,
	error_code TEXT,
	error_detail TEXT,
	created_at TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'succeeded',
	session_key TEXT,
	workflow_key TEXT,
	started_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	finished_at TEXT,
	next_event_seq BIGINT NOT NULL DEFAULT 0,
	logical_task_id TEXT,
	root_trace_id TEXT,
	parent_trace_id TEXT,
	physical_run_id TEXT,
	workflow_run_id TEXT
);
-- CREATE TABLE IF NOT EXISTS does not evolve an already-existing runtime-era
-- journal table. Keep these additive repairs before every index that consumes
-- the newer columns; the following Prisma migration owns data backfills and
-- NOT NULL enforcement.
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS meta_json TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS session_key TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS workflow_key TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS updated_at TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS finished_at TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS next_event_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS logical_task_id TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS root_trace_id TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS parent_trace_id TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS physical_run_id TEXT;
ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_execution_traces_user_scope ON execution_traces(user_id, scope_type, scope_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_traces_root_started ON execution_traces(user_id, root_trace_id, started_at ASC);
CREATE INDEX IF NOT EXISTS idx_execution_traces_logical_task ON execution_traces(user_id, logical_task_id, started_at ASC);
CREATE INDEX IF NOT EXISTS idx_execution_traces_user_status_updated ON execution_traces(user_id, status, updated_at ASC);
CREATE INDEX IF NOT EXISTS idx_execution_traces_parent ON execution_traces(user_id, parent_trace_id);

CREATE TABLE IF NOT EXISTS execution_trace_events (
	id TEXT PRIMARY KEY,
	trace_id TEXT NOT NULL REFERENCES execution_traces(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	seq BIGINT NOT NULL,
	producer_event_id TEXT NOT NULL,
	event_type TEXT NOT NULL,
	event_class TEXT NOT NULL,
	event_key TEXT NOT NULL,
	phase TEXT,
	status TEXT,
	logical_task_id TEXT,
	root_trace_id TEXT,
	parent_trace_id TEXT,
	physical_run_id TEXT,
	workflow_run_id TEXT,
	workflow_node_id TEXT,
	agent_id TEXT,
	parent_agent_id TEXT,
	tool_call_id TEXT,
	effect_id TEXT,
	provider_task_id TEXT,
	span_id TEXT,
	parent_span_id TEXT,
	attempt INTEGER CHECK (attempt IS NULL OR attempt > 0),
	payload_json TEXT NOT NULL,
	payload_size_bytes INTEGER NOT NULL,
	payload_truncated BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TEXT NOT NULL
);
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS producer_event_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS event_class TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS logical_task_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS root_trace_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS parent_trace_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS physical_run_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS workflow_run_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS workflow_node_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS parent_agent_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS tool_call_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS effect_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS provider_task_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS span_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS parent_span_id TEXT;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS attempt INTEGER;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS payload_size_bytes INTEGER;
ALTER TABLE execution_trace_events ADD COLUMN IF NOT EXISTS payload_truncated BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_trace_events_trace_seq ON execution_trace_events(trace_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_trace_events_trace_producer ON execution_trace_events(trace_id, producer_event_id);
CREATE INDEX IF NOT EXISTS idx_execution_trace_events_trace_seq ON execution_trace_events(trace_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_execution_trace_events_user_created ON execution_trace_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_trace_events_workflow_node ON execution_trace_events(workflow_run_id, workflow_node_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_execution_trace_events_tool_call ON execution_trace_events(tool_call_id, seq ASC);

-- Cross-process run-drive leases. PostgreSQL is authoritative; there is no
-- process-memory or Redis fallback because a fallback would permit duplicate effects.
CREATE TABLE IF NOT EXISTS production_run_leases (
  lease_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  acquired_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT chk_production_run_lease_window CHECK (expires_at > acquired_at)
);
CREATE INDEX IF NOT EXISTS idx_production_run_leases_expires_at ON production_run_leases(expires_at);
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS film_spec TEXT;
