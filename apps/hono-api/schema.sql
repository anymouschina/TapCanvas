-- D1 schema for Tasks demo
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
	role TEXT,
	last_seen_at TEXT,
	guest INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

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
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_public ON projects(is_public);

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

-- Chat sessions for AI assistant
CREATE TABLE IF NOT EXISTS chat_sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	title TEXT,
	model TEXT,
	provider TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id),
	UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_created_at ON chat_sessions(user_id, created_at);

-- Chat messages inside a session
CREATE TABLE IF NOT EXISTS chat_messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	role TEXT NOT NULL,
	content TEXT,
	raw TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at ON chat_messages(session_id, created_at);

-- LangGraph research assistant thread mapping (one thread per project)
CREATE TABLE IF NOT EXISTS langgraph_project_threads (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	project_id TEXT NOT NULL,
	thread_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
	UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_langgraph_project_threads_user_project ON langgraph_project_threads(user_id, project_id);

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
