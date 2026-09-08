import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { setTimeout } from "node:timers/promises";

// Disposable PostgreSQL only; never loads application/database credentials.
let container;
const release = readFileSync(new URL("../sql/releases/20260908_one_click_video_nodes_v1.sql", import.meta.url), "utf8");
function sql(text) {
  // TCP excludes the temporary socket-only server used during initdb.
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=isolated-release-test", container, "psql", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
before(async () => {
  container = execFileSync("docker", ["run", "--rm", "-d", "-e", "POSTGRES_PASSWORD=isolated-release-test", "postgres:16-alpine"], { encoding: "utf8" }).trim();
  for (let attempt = 0; attempt < 60; attempt++) {
    try { sql("SELECT 1"); return; } catch (error) {
      if (attempt === 59) throw error;
      await setTimeout(250);
    }
  }
});
after(() => { if (container) execFileSync("docker", ["stop", container], { stdio: "pipe" }); });

const schema = `
CREATE TABLE users (id text PRIMARY KEY, role text, disabled integer, deleted_at text);
CREATE TABLE projects (id text PRIMARY KEY, name text, owner_id text REFERENCES users(id), project_kind text, description text, created_at text, updated_at text);
CREATE TABLE flows (id text PRIMARY KEY, name text, data text, owner_id text REFERENCES users(id), project_id text REFERENCES projects(id), canvas_revision integer, created_at text, updated_at text);
CREATE TABLE flow_versions (id text PRIMARY KEY, flow_id text REFERENCES flows(id), name text, data text, user_id text REFERENCES users(id), created_at text);
CREATE TABLE agent_capability_attachments (id text PRIMARY KEY, user_id text REFERENCES users(id), capability_kind text, source_id text, source_version_id text, descriptor_json text, descriptor_sha256 text, conflict_report_json text, route_decisions_json text, conflict_report_revision integer, scope text, created_at text, updated_at text, UNIQUE(user_id, capability_kind, source_id));
INSERT INTO users VALUES ('administrator', 'admin', 0, NULL), ('new-user', 'user', 0, NULL);
`;

test("release publishes all-users data atomically, repeats without overwrites and rejects identity drift", () => {
  sql(schema);
  assert.throws(() => sql(release), /bootstrap administrator/);
  assert.equal(sql("SELECT count(*) FROM projects"), "0");
  const configuredRelease = "SET tapcanvas.workflow_owner_id = 'administrator';\n" + release;
  sql(configuredRelease);
  const count = "SELECT (SELECT count(*) FROM projects), (SELECT count(*) FROM flows), (SELECT count(*) FROM flow_versions), (SELECT count(*) FROM agent_capability_attachments)";
  assert.equal(sql(count), "1|1|1|1");
  // Same scope predicate used by listEquippedWorkflowCapabilities for a fresh user.
  assert.equal(sql("SELECT count(*) FROM agent_capability_attachments WHERE user_id = 'new-user' OR scope = 'all_users'"), "1");
  assert.equal(sql("SELECT jsonb_array_length(data::jsonb -> 'nodes') FROM flows"), "5");
  assert.equal(sql("SELECT descriptor_json::jsonb -> 'requiredSkills' FROM agent_capability_attachments"), "[]");
  const before = sql("SELECT row_to_json(a) FROM agent_capability_attachments a");
  sql(configuredRelease);
  assert.equal(sql(count), "1|1|1|1");
  assert.equal(sql("SELECT row_to_json(a) FROM agent_capability_attachments a"), before);
  // Editing the source canvas must not rewrite its published immutable version.
  sql("UPDATE flows SET name = 'administrator edited canvas' WHERE id = '00000000-0000-4000-8000-000000000112'");
  sql(configuredRelease);
  assert.equal(sql("SELECT name FROM flows"), "administrator edited canvas");
  sql("UPDATE flow_versions SET data = '{}' WHERE id = '00000000-0000-4000-8000-000000000113'");
  assert.throws(() => sql(configuredRelease), /immutable workflow version mismatch/);
  assert.equal(sql("SELECT data FROM flow_versions"), "{}");
  assert.equal(sql("SELECT row_to_json(a) FROM agent_capability_attachments a"), before);
});
