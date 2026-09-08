# HMaigc Single-Source Image Prompt Specialist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route HMaigc's paid `portraitTexture` image command through `image_prompt_specialist` while keeping HMaigc's frozen model catalog and encrypted provider runtime as the only model authority.

**Architecture:** HMaigc owns identity, permission, billing, task state, model selection, immutable provider-version identity, provider credentials, and final media evidence. Hono owns internal protocol authentication, Redis idempotency, single-use relay grants, and trace correlation; agents-cli owns specialist semantics and can make exactly one no-tool, non-stream model call through the grant. The existing Hono/new-api proxy remains available for unrelated features but is removed from this specialist path.

**Tech Stack:** Go 1.25, Gin, GORM, go-redis v9, TypeScript strict, Node HTTP, Hono, ioredis, Vitest, Node test runner, Bun tests, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-07-image-prompt-specialist-service-design.md`

## Global Constraints

- HMaigc's model catalog and encrypted provider credentials are the sole model authority; Hono and agents-cli must not own or synchronize a second specialist model catalog.
- The path is `Web -> HMaigc task -> Hono gateway -> agents-cli specialist -> Hono relay -> HMaigc model relay -> configured provider`.
- The specialist path is server-controlled, non-streaming, has `tools: []`, performs zero HTTP retries, and never switches models.
- Missing model identity, provider versions, credentials, Redis, authentication, evidence, usage, or strict JSON output must fail explicitly before downstream image generation.
- A successful provider asset is always retained and recorded; post-processing must not discard or refund it.
- Specialist inference is an internal platform cost for this release and must not create a second user billing order.
- No HMaigc database schema migration or production data mutation is part of this implementation plan.
- Do not introduce `any`, semantic regular expressions, keyword routing, compatibility branches, default routes, default prompts, or silent fallback.
- Keep the rollout closed until the exact tests, both repository builds, the failure matrix, and one controlled paid E2E pass.
- Changes to the specialist bridge and internal AI routes must update `apps/hono-api/README.md` under “AI 对话架构（当前）”.
- This plan is one shared-state execution sequence. Do not parallelize tasks that touch the relay grant, frozen model identity, or commercial task state.
- Git commits are local only. Do not push, merge, rebase, tag, or deploy without a separate explicit user instruction.

## Change Budget

- Production responsibilities: five seams — shared binding contract, Hono grant state machine, request-scoped agents relay, HMaigc frozen model execution, and paid image-task evidence.
- TapCanvas root worktree: 9–13 production/test/documentation files, approximately 400–650 net new lines after deleting the specialist's new-api/model-catalog branch.
- HMaigc worktree: 8–12 production/test/configuration files, approximately 300–450 net new lines.
- The total 700–1,100 net lines exceed the design's early lower estimate only because the mapped implementation requires an independent reverse-HMAC verifier, atomic Redis grant tests, private Gin handler tests, and cross-language five-field contract tests. No extra product feature has entered scope.
- Expensive gates: focused RED/GREEN per task; root builds after Tasks 3, 6, and 7; HMaigc backend/web full gates at Task 9; one real paid generation only after every no-paid gate is green.
- Deferred scope: video/pacing specialists, skills-library UI, creative-workbench replacement, plugin center, drawing nodes, and unrelated canvas-node migration.

## File Responsibility Map

### TapCanvas root worktree

- `packages/schemas/image-prompt-specialist/index.js`: one strict runtime parser and canonical digest implementation for cross-service specialist DTOs.
- `packages/schemas/image-prompt-specialist/index.d.ts`: exact TypeScript declarations for those DTOs.
- `apps/agents-cli/src/server/image-prompt-contract.ts`: agents-cli import adapter for the shared schema.
- `apps/agents-cli/src/server/image-prompt-relay-client.ts`: request-scoped LLM client that accepts a single-use grant; no persistent relay credential.
- `apps/agents-cli/src/server/image-prompt-specialist.ts`: semantic specialist execution and final schema self-check.
- `apps/agents-cli/src/server/image-prompt-route.ts`: private Hono-to-agents transport endpoint.
- `apps/hono-api/src/modules/internal/image-prompt-relay-grant.ts`: grant issue/consume state machine and Redis adapter.
- `apps/hono-api/src/modules/internal/internal-agents-client.ts`: Hono client for the private agents execution envelope.
- `apps/hono-api/src/modules/internal/internal-hmaigc-model-client.ts`: canonical HMAC client for Hono-to-HMaigc model relay.
- `apps/hono-api/src/modules/internal/image-prompt-model-relay.ts`: validates one model request, atomically consumes one grant, and forwards it to HMaigc.
- `apps/hono-api/src/modules/internal/image-prompt-specialist.service.ts`: specialist orchestration and idempotency; no model lookup.
- `apps/hono-api/src/modules/internal/image-prompt-specialist.routes.ts`: internal Hono routes and dependency composition.
- `apps/hono-api/src/modules/agents/agents-llm-proxy.ts`: generic user-facing new-api proxy only; specialist relay code is removed from this module.

### HMaigc worktree

- `backend/internal/service/image_prompt_specialist_client.go`: shared Go DTO mirror and Go-to-Hono HMAC client.
- `backend/internal/service/image_prompt_specialist.go`: freezes prompt-model identity into the paid image task and persists prompt evidence.
- `backend/internal/service/image_prompt_model_relay.go`: verifies parent task/order/model facts and performs one configured provider call.
- `backend/internal/service/image_prompt_model_relay_auth.go`: independent Hono-to-HMaigc HMAC verification and Redis nonce claim.
- `backend/internal/repository/provider_account.go`: resolves the prompt model's exact frozen endpoint/credential versions independently from the image generation task's provider runtime.
- `backend/internal/handler/image_prompt_model_relay.go`: bounded-body private Gin endpoint with stable errors.
- `backend/cmd/server/main.go`: registers the private route only when specialist runtime is enabled.
- HMaigc web files already implementing `portraitTexture`: remain behaviorally unchanged except for tests required by contract changes.

---

### Task 1: Freeze the Five-Part Model Binding Contract

**Files:**

- Modify: `packages/schemas/image-prompt-specialist/index.js`
- Modify: `packages/schemas/image-prompt-specialist/index.d.ts`
- Modify: `packages/schemas/image-prompt-specialist/index.test.mjs`
- Modify: `apps/agents-cli/src/server/image-prompt-contract.ts`
- Modify: `apps/hono-api/src/modules/internal/image-prompt-contract.ts`
- Modify: `backend/internal/service/image_prompt_specialist_client.go`
- Modify: `backend/internal/service/image_prompt_specialist_client_test.go`

**Interfaces:**

- Consumes: existing `image-prompt-request/v1`, `image-prompt/v1`, canonical JSON, and evidence digest rules.
- Produces: `ImagePromptSpecialistModelBindingV1` with five required identity fields and strict response equality checks used by every later task.

- [ ] **Step 1: Add failing JavaScript contract tests**

```js
const binding = {
  catalogRecordId: "model-record-1",
  modelKey: "deepseek-chat",
  configurationRevision: "2026-09-07T12:00:00.000Z",
  providerEndpointVersionId: "endpoint-v1",
  providerCredentialVersionId: "credential-v1",
};

assert.equal(parseImagePromptSpecialistRequest(validRequest({ promptModel: binding })).ok, true);
assert.equal(
  parseImagePromptSpecialistRequest(
    validRequest({ promptModel: { ...binding, providerEndpointVersionId: "" } }),
  ).ok,
  false,
);
assert.equal(
  parseImagePromptSpecialistResponse(
    validResponse({ trace: { model: { ...binding, providerCredentialVersionId: "" } } }),
  ).ok,
  false,
);
```

- [ ] **Step 2: Run the shared test and verify RED**

```powershell
node --test packages/schemas/image-prompt-specialist/index.test.mjs
```

Expected: FAIL because endpoint and credential version fields are not yet required.

- [ ] **Step 3: Extend the strict schema and declarations**

```ts
export interface ImagePromptSpecialistModelBindingV1 {
  catalogRecordId: string;
  modelKey: string;
  configurationRevision: string;
  providerEndpointVersionId: string;
  providerCredentialVersionId: string;
}
```

Update both request and response parsers so empty, missing, unknown, or over-limit fields fail. Keep the schema version unchanged because no released consumer has accepted the incomplete draft.

- [ ] **Step 4: Add the same RED/GREEN cases to the Go mirror**

```go
type imagePromptSpecialistModelBindingV1 struct {
    CatalogRecordID             string `json:"catalogRecordId"`
    ModelKey                    string `json:"modelKey"`
    ConfigurationRevision       string `json:"configurationRevision"`
    ProviderEndpointVersionID   string `json:"providerEndpointVersionId"`
    ProviderCredentialVersionID string `json:"providerCredentialVersionId"`
}
```

Assert that `validateImagePromptSpecialistRequest` and `validateImagePromptSpecialistResponse` reject either missing provider-version field and reject any response field that differs from the request.

- [ ] **Step 5: Run focused contract tests and builds**

```powershell
node --test packages/schemas/image-prompt-specialist/index.test.mjs
corepack pnpm --filter agents build
corepack pnpm --filter @tapcanvas/api typecheck
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service -run 'TestImagePromptSpecialist(Request|Response|Client)' -count=1
Pop-Location
```

Expected: all commands PASS.

- [ ] **Step 6: Review and commit only the contract slice**

```powershell
git diff --check
git add -- packages/schemas/image-prompt-specialist apps/agents-cli/src/server/image-prompt-contract.ts apps/hono-api/src/modules/internal/image-prompt-contract.ts
git commit -m "feat: freeze specialist provider model identity"
```

In the HMaigc worktree, stage only the two Go client files and commit separately after confirming the staged list.

---

### Task 2: Add Atomic Single-Use Relay Grants in Hono

**Files:**

- Create: `apps/hono-api/src/modules/internal/image-prompt-relay-grant.ts`
- Create: `apps/hono-api/src/modules/internal/image-prompt-relay-grant.test.ts`
- Modify: `apps/hono-api/src/modules/internal/image-prompt-idempotency.ts`

**Interfaces:**

- Consumes: `ImagePromptSpecialistModelBindingV1` and the existing Redis command adapter shape.
- Produces:

```ts
export interface ImagePromptRelayGrantStore {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  take(key: string): Promise<string | null>;
}

export type ImagePromptRelayGrantBindingV1 = {
  schemaVersion: "image-prompt-relay-grant/v1";
  correlationId: string;
  generationTaskId: string;
  promptModel: ImagePromptSpecialistModelBindingV1;
  expiresAt: string;
};

export function issueImagePromptRelayGrant(
  store: ImagePromptRelayGrantStore,
  binding: Omit<ImagePromptRelayGrantBindingV1, "schemaVersion" | "expiresAt">,
  now: Date,
): Promise<{ grant: string; expiresAt: string }>;

export function consumeImagePromptRelayGrant(
  store: ImagePromptRelayGrantStore,
  grant: string,
  expected: Omit<ImagePromptRelayGrantBindingV1, "schemaVersion" | "expiresAt">,
  now: Date,
): Promise<ImagePromptRelayGrantBindingV1>;
```

- [ ] **Step 1: Write RED tests for issue, consume, expiry, replay, and binding mismatch**

```ts
it("consumes a bound grant exactly once", async () => {
  const issued = await issueImagePromptRelayGrant(store, binding, now);
  await expect(consumeImagePromptRelayGrant(store, issued.grant, binding, now)).resolves.toMatchObject(binding);
  await expect(consumeImagePromptRelayGrant(store, issued.grant, binding, now)).rejects.toMatchObject({
    code: "specialist_replay_rejected",
  });
});
```

Also cover wrong correlation ID, task ID, every model identity field, expired grant, duplicate generated token, corrupt Redis value, and Redis command failure.

- [ ] **Step 2: Run the test and verify RED**

```powershell
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/image-prompt-relay-grant.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement random-token issue and SHA-256 keyed storage**

Use 32 random bytes, base64url encode the grant, store only `SHA-256(grant)`, and cap TTL at 120 seconds.

```ts
const raw = crypto.getRandomValues(new Uint8Array(32));
const grant = Buffer.from(raw).toString("base64url");
const key = `image-prompt-specialist:relay-grant:v1:${await sha256Hex(grant)}`;
```

- [ ] **Step 4: Implement atomic Redis consume**

Add a `GETDEL` Lua adapter rather than `GET` followed by `DEL`:

```lua
local value = redis.call('GET', KEYS[1])
if not value then return false end
redis.call('DEL', KEYS[1])
return value
```

The record is consumed even when its payload later fails validation, preventing reuse of a malformed or mismatched grant.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/image-prompt-relay-grant.test.ts src/modules/internal/image-prompt-idempotency.test.ts
corepack pnpm --filter @tapcanvas/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Review and commit the grant state machine**

```powershell
git diff --check
git add -- apps/hono-api/src/modules/internal/image-prompt-relay-grant.ts apps/hono-api/src/modules/internal/image-prompt-relay-grant.test.ts apps/hono-api/src/modules/internal/image-prompt-idempotency.ts
git commit -m "feat(api): add single-use specialist relay grants"
```

---

### Task 3: Make agents-cli Use the Request-Scoped Grant

**Files:**

- Modify: `packages/schemas/image-prompt-specialist/index.js`
- Modify: `packages/schemas/image-prompt-specialist/index.d.ts`
- Modify: `packages/schemas/image-prompt-specialist/index.test.mjs`
- Modify: `apps/agents-cli/src/server/image-prompt-relay-client.ts`
- Modify: `apps/agents-cli/src/server/image-prompt-relay-client.test.ts`
- Modify: `apps/agents-cli/src/server/image-prompt-route.ts`
- Modify: `apps/agents-cli/src/server/image-prompt-route.test.ts`
- Modify: `apps/agents-cli/src/server/http-server.ts`
- Modify: `apps/hono-api/src/modules/internal/internal-agents-client.ts`
- Modify: `apps/hono-api/src/modules/internal/internal-agents-client.test.ts`

**Interfaces:**

- Consumes: Task 1 model binding and Task 2 raw grant.
- Produces:

```ts
export interface ImagePromptSpecialistExecutionRequestV1 {
  schemaVersion: "image-prompt-execution/v1";
  request: ImagePromptSpecialistRequestV1;
  relayGrant: string;
}

export type ImagePromptRelayConfig = {
  baseUrl: string;
  grant: string;
  correlationId: string;
  generationTaskId: string;
  promptModel: ImagePromptSpecialistModelBindingV1;
};
```

- [ ] **Step 1: Write RED shared-envelope tests**

Test a valid envelope and reject an empty grant, an unknown field, a nested request with missing provider versions, and a grant longer than 512 UTF-8 bytes.

```js
assert.equal(parseImagePromptSpecialistExecutionRequest({
  schemaVersion: "image-prompt-execution/v1",
  request,
  relayGrant: "g".repeat(43),
}).ok, true);
```

- [ ] **Step 2: Write RED agents and Hono transport tests**

Assert the agents route passes the envelope grant into the call factory, the call sends `Authorization: Bearer <grant>`, and no environment token is read. Assert Hono sends the same freshly issued grant once and never logs or returns it.

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
node --test packages/schemas/image-prompt-specialist/index.test.mjs
corepack pnpm --filter agents test -- image-prompt-relay-client.test.ts image-prompt-route.test.ts
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/internal-agents-client.test.ts
```

Expected: FAIL on the missing execution envelope and request-scoped grant.

- [ ] **Step 4: Replace the static relay token with the grant**

Keep `AGENTS_IMAGE_PROMPT_RELAY_BASE_URL`; delete `AGENTS_IMAGE_PROMPT_RELAY_TOKEN`. Construct `LLMClient` per specialist request with `apiKey: relay.grant`, `stream: false`, `maxHttpRetries: 0`, and payload logging disabled. Bind the relay request to correlation, parent task, and the complete model identity in its strict JSON body rather than trusting free-form headers.

- [ ] **Step 5: Update the private agents route and Hono client**

The route continues using the independent `IMAGE_PROMPT_AGENTS_TOKEN` for Hono-to-agents service authentication. It strictly parses `ImagePromptSpecialistExecutionRequestV1`, creates the relay call from that envelope, and passes only `envelope.request` to `executeImagePromptSpecialist`.

- [ ] **Step 6: Run focused tests and builds**

```powershell
node --test packages/schemas/image-prompt-specialist/index.test.mjs
corepack pnpm --filter agents test -- image-prompt-relay-client.test.ts image-prompt-route.test.ts image-prompt-specialist.test.ts
corepack pnpm --filter agents build
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/internal-agents-client.test.ts
corepack pnpm --filter @tapcanvas/api typecheck
```

Expected: PASS and repository search finds no `AGENTS_IMAGE_PROMPT_RELAY_TOKEN`.

- [ ] **Step 7: Review and commit the request-scoped transport**

```powershell
rg -n "AGENTS_IMAGE_PROMPT_RELAY_TOKEN" apps packages
git diff --check
git add -- packages/schemas/image-prompt-specialist apps/agents-cli/src/server apps/agents-cli/src/server/http-server.ts apps/hono-api/src/modules/internal/internal-agents-client.ts apps/hono-api/src/modules/internal/internal-agents-client.test.ts
git commit -m "refactor: bind specialist inference to request grants"
```

Expected: `rg` exits with no matches.

---

### Task 4: Freeze the HMaigc Prompt Provider Runtime

**Files:**

- Modify: `backend/internal/service/image_prompt_specialist.go`
- Modify: `backend/internal/service/image_prompt_specialist_test.go`
- Modify: `backend/internal/service/provider_credentials.go`
- Create: `backend/internal/service/image_prompt_model_binding_test.go`

**Interfaces:**

- Consumes: Task 1 five-part binding, `agentRuntimeDefaultModel`, `ResolveSystemProxyRuntime`, and immutable provider endpoint/credential versions.
- Produces:

```go
func (s *Service) freezeImagePromptModelBinding() (imagePromptSpecialistModelBindingV1, error)
func (s *Service) verifyFrozenImagePromptModel(binding imagePromptSpecialistModelBindingV1) error
```

- [ ] **Step 1: Write RED model-freeze tests**

Create a text model linked to an enabled, healthy `ProviderCredential`, one active `ProviderEndpointVersion`, and one active `ProviderCredentialVersion`. Assert the frozen binding contains the model record, model key, model revision, endpoint version ID, and credential version ID.

```go
if binding.ProviderEndpointVersionID != endpoint.ID || binding.ProviderCredentialVersionID != version.ID {
    t.Fatalf("freezeImagePromptModelBinding() = %#v", binding)
}
```

Also assert explicit failure for a direct channel with no versioned credential, a partial runtime, a disabled model, a changed model revision, and a mismatched endpoint/credential version.

- [ ] **Step 2: Run the focused Go tests and verify RED**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service -run 'Test(Freeze|VerifyFrozen)ImagePromptModel' -count=1
Pop-Location
```

Expected: FAIL because the existing binding contains only three fields.

- [ ] **Step 3: Freeze only versioned HMaigc provider facts**

Call `ResolveSystemProxyRuntime` once during commercial task creation and copy only its endpoint/credential version IDs into `input["promptModel"]`; do not copy the URL or API key. An unversioned direct channel is ineligible for this release and must return `ServiceUnavailable` before the image task is created.

- [ ] **Step 4: Verify frozen identity without requiring current active status**

Re-read the exact model record and exact provider versions by ID. A retired version remains valid for an already frozen task; missing or cross-account versions fail. Do not replace a retired version with the new active version.

- [ ] **Step 5: Run focused task, billing, and provider-freeze tests**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service -run 'Test(Freeze|VerifyFrozen|PrepareCanvasImagePrompt|TaskBillingOrder)' -count=1
go test ./internal/repository -run 'Test.*Provider.*Freeze' -count=1
Pop-Location
```

Expected: PASS.

- [ ] **Step 6: Review and commit the HMaigc freeze slice**

```powershell
git diff --check
git add -- backend/internal/service/image_prompt_specialist.go backend/internal/service/image_prompt_specialist_test.go backend/internal/service/provider_credentials.go backend/internal/service/image_prompt_model_binding_test.go
git commit -m "feat(backend): freeze specialist provider runtime"
```

---

### Task 5: Add the HMaigc Private Model Relay

**Files:**

- Create: `backend/internal/service/image_prompt_model_relay.go`
- Create: `backend/internal/service/image_prompt_model_relay_test.go`
- Create: `backend/internal/service/image_prompt_model_relay_auth.go`
- Create: `backend/internal/service/image_prompt_model_relay_auth_test.go`
- Modify: `backend/internal/repository/provider_account.go`
- Modify: `backend/internal/repository/provider_account_test.go`
- Create: `backend/internal/handler/image_prompt_model_relay.go`
- Create: `backend/internal/handler/image_prompt_model_relay_test.go`
- Modify: `backend/internal/service/service.go`
- Modify: `backend/internal/service/provider.go`
- Modify: `backend/internal/service/coordination.go`
- Modify: `backend/cmd/server/main.go`
- Modify: `backend/cmd/server/main_test.go`

**Interfaces:**

- Consumes: parent `Task`, `BillingOrder`, Task 4 model binding, `ProviderSecretCipher`, and the existing provider chat parser. The prompt runtime is resolved from the prompt binding itself; it must never read the image task's `ProviderAccountID`, `ProviderEndpointVersionID`, or `ProviderCredentialVersionID` fields.
- Produces:

```go
type ImagePromptModelRelayRequestV1 struct {
    SchemaVersion     string                                    `json:"schemaVersion"`
    CorrelationID     string                                    `json:"correlationId"`
    CommercialContext imagePromptSpecialistCommercialContextV1 `json:"commercialContext"`
    PromptModel       imagePromptSpecialistModelBindingV1       `json:"promptModel"`
    Messages          []imagePromptRelayMessageV1               `json:"messages"`
    Tools             []struct{}                                `json:"tools"`
    Stream            bool                                      `json:"stream"`
}

type ImagePromptModelRelayResponseV1 struct {
    SchemaVersion     string                       `json:"schemaVersion"`
    Text              string                       `json:"text"`
    EffectiveModel    string                       `json:"effectiveModel"`
    ProviderRequestID string                       `json:"providerRequestId"`
    Usage             imagePromptSpecialistUsageV1 `json:"usage"`
}

func (s *Service) ExecuteImagePromptModelRelay(
    ctx context.Context,
    request ImagePromptModelRelayRequestV1,
) (ImagePromptModelRelayResponseV1, error)
```

- [ ] **Step 1: Write RED domain tests for parent fact validation**

Cover missing task, wrong billing order, wrong user/team, wrong task type, terminal/cancelled task, quote fingerprint mismatch, model record mismatch, endpoint mismatch, credential mismatch, and unavailable encrypted secret. Assert the fake provider is never called on each failure.

Add repository tests for this exact lookup contract:

```go
func (r *Repository) FrozenProviderRuntimeByVersionIDs(
    endpointVersionID string,
    credentialVersionID string,
) (*FrozenProviderRuntime, error)
```

The joined endpoint and credential must belong to the same provider account, and the returned runtime must include the provider account ID and provider credential ID needed for AAD decryption.

- [ ] **Step 2: Write RED provider-call tests**

Assert exactly two messages in `system,user` order, `tools: []`, `stream: false`, one HTTP call, zero retry after a 500/network failure, exact frozen base URL/key, exact effective model, required provider request ID, and non-negative usage with `totalTokens == inputTokens + outputTokens`.

- [ ] **Step 3: Write RED HMAC and nonce tests**

Use the canonical payload:

```text
hmaigc-image-prompt-model-relay/v1
<serviceId>
<unixTimestamp>
<nonce>
POST
/internal/v1/model-relays/image-prompt/chat-completions
<bodySha256>
<generationTaskId>
<correlationId>
```

Test wrong service ID, wrong signature, altered body, timestamp outside 60 seconds, Redis unavailable, first nonce claim, and replay rejection.

- [ ] **Step 4: Run the focused tests and verify RED**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service ./internal/handler -run 'TestImagePromptModelRelay' -count=1
Pop-Location
```

Expected: FAIL because the relay and handler do not exist.

- [ ] **Step 5: Implement strict request validation and Redis nonce claim**

Reuse the service coordinator's Redis client through a focused method:

```go
func (c *runtimeCoordinator) claimImagePromptRelayNonce(
    ctx context.Context,
    serviceID string,
    nonce string,
    ttl time.Duration,
) (bool, error)
```

Use Redis `SET key 1 NX PX ttl`; when specialist runtime is enabled, absence of Redis is a startup error. No in-process nonce fallback is allowed.

- [ ] **Step 6: Implement frozen-runtime provider execution**

Read the parent task and order, validate the five-part binding against task input, resolve the exact retired-or-active prompt-provider versions with `FrozenProviderRuntimeByVersionIDs`, decrypt the exact credential version, and execute the provider chat request once. Extract text, provider request ID, effective model, and usage into the strict response. Record a structured `ApiCallLog`/`TaskLog` linked to the parent task and correlation ID without creating a user order. Never call `FrozenProviderRuntime(task)` here because that task runtime belongs to the paid image-generation model.

- [ ] **Step 7: Implement the private Gin endpoint**

Read at most 1 MB, verify HMAC before provider execution, strictly decode one JSON body with unknown fields rejected, and return only stable error codes with request/correlation IDs. Register the route outside `/api`:

```go
handler.RegisterImagePromptModelRelayRoutes(r.Group("/internal/v1"), svc)
```

- [ ] **Step 8: Preserve successful provider evidence on post-processing failure**

Once the provider response contains a request ID and text, persist the provider call and usage before response encoding. If later logging/encoding fails, retain that provider fact and return an explicit reconciliation-required error; never delete it or mark a user refund from this internal-cost call.

- [ ] **Step 9: Run focused tests, race-sensitive tests, and vet**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service ./internal/handler ./internal/repository ./cmd/server -run 'TestImagePromptModelRelay|TestFrozenProviderRuntimeByVersionIDs' -count=1
go test -race ./internal/service -run 'TestImagePromptModelRelay.*(Nonce|Concurrent)' -count=1
go vet ./internal/service ./internal/handler ./cmd/server
Pop-Location
```

Expected: PASS.

- [ ] **Step 10: Review and commit the private relay**

```powershell
git diff --check
git add -- backend/internal/service/image_prompt_model_relay.go backend/internal/service/image_prompt_model_relay_test.go backend/internal/service/image_prompt_model_relay_auth.go backend/internal/service/image_prompt_model_relay_auth_test.go backend/internal/repository/provider_account.go backend/internal/repository/provider_account_test.go backend/internal/handler/image_prompt_model_relay.go backend/internal/handler/image_prompt_model_relay_test.go backend/internal/service/service.go backend/internal/service/provider.go backend/internal/service/coordination.go backend/cmd/server/main.go backend/cmd/server/main_test.go
git commit -m "feat(backend): add private specialist model relay"
```

---

### Task 6: Hard-Cut Hono from new-api to the HMaigc Relay

**Files:**

- Create: `apps/hono-api/src/modules/internal/internal-hmaigc-model-client.ts`
- Create: `apps/hono-api/src/modules/internal/internal-hmaigc-model-client.test.ts`
- Create: `apps/hono-api/src/modules/internal/image-prompt-model-relay.ts`
- Create: `apps/hono-api/src/modules/internal/image-prompt-model-relay.test.ts`
- Modify: `apps/hono-api/src/modules/internal/image-prompt-specialist.service.ts`
- Modify: `apps/hono-api/src/modules/internal/image-prompt-specialist.service.test.ts`
- Modify: `apps/hono-api/src/modules/internal/image-prompt-specialist.routes.ts`
- Modify: `apps/hono-api/src/modules/internal/image-prompt-specialist.routes.test.ts`
- Modify: `apps/hono-api/src/modules/agents/agents-llm-proxy.ts`
- Modify: `apps/hono-api/src/modules/agents/agents-llm-proxy.internal.test.ts`

**Interfaces:**

- Consumes: Task 2 grant store, Task 3 execution envelope, and Task 5 HMaigc relay DTO.
- Produces:

```ts
export interface InternalHmaigcImagePromptModelClient {
  execute(
    request: ImagePromptModelRelayRequestV1,
    abortSignal?: AbortSignal,
  ): Promise<ImagePromptModelRelayResponseV1>;
}

export async function relayGrantedImagePromptModelCall(input: {
  authorization: string;
  correlationId: string;
  generationTaskId: string;
  promptModel: ImagePromptSpecialistModelBindingV1;
  chatRequest: unknown;
  grantStore: ImagePromptRelayGrantStore;
  hmaigcClient: InternalHmaigcImagePromptModelClient;
  now: Date;
}): Promise<ImagePromptModelRelayResponseV1>;
```

- [ ] **Step 1: Write RED HMaigc HMAC client tests**

Assert exact path, canonical signature, independent service ID/secret, body digest, generation task/correlation binding, 90-second hard timeout, no retry, strict response parsing, and redacted failure messages.

- [ ] **Step 2: Write RED granted-relay tests**

Assert missing/expired/replayed grants fail before HMaigc fetch; correlation, task, and all five model fields must match. Assert valid input produces exactly one HMaigc call and maps the strict HMaigc response into the OpenAI-shaped `LLMResponse` expected by agents-cli.

- [ ] **Step 3: Write RED gateway tests for grant lifecycle**

Assert a new grant is issued only after business idempotency is claimed, passed once to agents, and not issued for a succeeded replay. If agents fails before consuming it, the grant expires naturally and the business idempotency record becomes `failed`.

- [ ] **Step 4: Run focused tests and verify RED**

```powershell
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/internal-hmaigc-model-client.test.ts src/modules/internal/image-prompt-model-relay.test.ts src/modules/internal/image-prompt-specialist.service.test.ts src/modules/internal/image-prompt-specialist.routes.test.ts
```

Expected: FAIL on missing HMaigc adapter and grant wiring.

- [ ] **Step 5: Implement the HMAC client and granted relay**

The HMaigc client signs the raw canonical JSON body with `IMAGE_PROMPT_HMAIGC_RELAY_SERVICE_ID` and `IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET`. The granted relay strictly accepts only `model`, two messages, `tools: []`, and `stream: false`; it atomically consumes the grant before any outbound call.

- [ ] **Step 6: Remove specialist model lookup and new-api dependency**

Delete `resolveExactPromptModelBinding`, `isEnabledExactPromptModel`, and `InternalImagePromptRelayDependencies` from the specialist path. Move/delete the specialist-only implementation currently appended to `agents-llm-proxy.ts`; retain `handleAgentsLlmChatCompletions` and `handleAgentsLlmVideoUnderstand` unchanged for unrelated product capabilities.

- [ ] **Step 7: Wire grant issue into the idempotent gateway**

After `claimImagePromptIdempotency` returns `claimed`, issue the grant bound to `request.correlationId`, `request.commercialContext.generationTaskId`, and `request.promptModel`, then call `agentsClient.execute({ schemaVersion: "image-prompt-execution/v1", request, relayGrant })`.

- [ ] **Step 8: Run exact Hono tests, typecheck, and build**

```powershell
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/image-prompt-relay-grant.test.ts src/modules/internal/internal-hmaigc-model-client.test.ts src/modules/internal/image-prompt-model-relay.test.ts src/modules/internal/image-prompt-specialist.service.test.ts src/modules/internal/image-prompt-specialist.routes.test.ts src/modules/internal/internal-agents-client.test.ts src/modules/agents/agents-llm-proxy.internal.test.ts
corepack pnpm --filter @tapcanvas/api typecheck
corepack pnpm --filter @tapcanvas/api build
```

Expected: PASS.

- [ ] **Step 9: Prove the specialist no longer queries a second catalog**

```powershell
rg -n "model_catalog_models|NEW_API_INTERNAL|newApiBaseUrl|newApiToken" apps/hono-api/src/modules/internal apps/agents-cli/src/server/image-prompt*
```

Expected: no matches in specialist/internal files. Matches in unrelated generic new-api proxy files are acceptable only when not imported by the specialist route.

- [ ] **Step 10: Review and commit the Hono cutover**

```powershell
git diff --check
git add -- apps/hono-api/src/modules/internal apps/hono-api/src/modules/agents/agents-llm-proxy.ts apps/hono-api/src/modules/agents/agents-llm-proxy.internal.test.ts
git commit -m "refactor(api): relay specialist models through HMaigc"
```

---

### Task 7: Wire Production Configuration and Architecture Documentation

**Files:**

- Modify: `apps/agents-cli/README.md`
- Modify: `apps/hono-api/.env.example`
- Modify: `apps/hono-api/docker-compose.yml`
- Modify: `apps/hono-api/src/platform/node/node-env.ts`
- Modify: `apps/hono-api/src/types.ts`
- Modify: `apps/hono-api/README.md`
- Modify: `E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\.env.example`
- Modify: `E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\.env.production.example`
- Modify: `E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\docker-compose.yml`
- Modify: `E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\docker-compose.production.yml`
- Modify: `E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\PRODUCTION.md`

**Interfaces:**

- Consumes: all runtime configuration names introduced by Tasks 2–6.
- Produces: an explicit four-secret deployment contract with no duplicated model credentials.

- [ ] **Step 1: Add configuration-validation tests**

Cover missing Redis, missing agents token, missing HMaigc relay URL, missing reverse service ID, secrets shorter than 32 UTF-8 bytes, URL credentials/query/hash, and valid configuration. Ensure the specialist can remain disabled without requiring these values.

- [ ] **Step 2: Replace obsolete specialist environment variables**

Keep:

```text
IMAGE_PROMPT_HMAC_SERVICE_ID
IMAGE_PROMPT_HMAC_SECRET
IMAGE_PROMPT_REDIS_URL
IMAGE_PROMPT_AGENTS_BASE_URL
IMAGE_PROMPT_AGENTS_TOKEN
AGENTS_IMAGE_PROMPT_RELAY_BASE_URL
```

Add:

```text
IMAGE_PROMPT_HMAIGC_RELAY_URL
IMAGE_PROMPT_HMAIGC_RELAY_SERVICE_ID
IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET
CANVAS_IMAGE_PROMPT_RELAY_ALLOWED_SERVICE_ID
CANVAS_IMAGE_PROMPT_RELAY_HMAC_SECRET
```

Remove:

```text
IMAGE_PROMPT_LLM_RELAY_TOKEN
AGENTS_IMAGE_PROMPT_RELAY_TOKEN
```

The two HMAC directions must use distinct secrets and neither may equal `IMAGE_PROMPT_AGENTS_TOKEN`.

- [ ] **Step 3: Update Compose without removing unrelated new-api services**

The specialist services receive only their required URLs and secrets. Do not remove the `new-api` container because generic agents chat/video routes still use it; prove only that the specialist dependency graph no longer depends on its health or model rows.

- [ ] **Step 4: Update architecture documentation**

In `apps/hono-api/README.md` under “AI 对话架构（当前）”, document the exact sequence, single-use grant, HMaigc single model authority, strict failure rules, internal-cost accounting, and the fact that this deterministic specialist endpoint is not a local intent router. Update agents-cli and HMaigc production docs with the same secret ownership and rollout order.

- [ ] **Step 5: Run config tests, typecheck, and documentation searches**

```powershell
corepack pnpm --filter agents build
corepack pnpm --filter @tapcanvas/api typecheck
corepack pnpm --filter @tapcanvas/api build
rg -n "AGENTS_IMAGE_PROMPT_RELAY_TOKEN|IMAGE_PROMPT_LLM_RELAY_TOKEN" apps packages
rg -n "HMaigc|single-use|单次|image_prompt_specialist" apps/hono-api/README.md apps/agents-cli/README.md
```

Expected: builds PASS, obsolete variables have no matches, and architecture terms are present.

- [ ] **Step 6: Review and commit configuration/docs per repository**

Root worktree:

```powershell
git diff --check
git add -- apps/agents-cli/README.md apps/hono-api/.env.example apps/hono-api/docker-compose.yml apps/hono-api/src/platform/node/node-env.ts apps/hono-api/src/types.ts apps/hono-api/README.md
git commit -m "docs: document specialist relay deployment"
```

HMaigc worktree:

```powershell
git diff --check
git add -- .env.example .env.production.example docker-compose.yml docker-compose.production.yml PRODUCTION.md
git commit -m "docs: configure private specialist model relay"
```

---

### Task 8: Integrate the Existing Paid Image Command Without Frontend Regression

**Files:**

- Modify: `backend/internal/service/image_prompt_specialist.go`
- Modify: `backend/internal/service/image_prompt_specialist_test.go`
- Modify: `backend/internal/service/provider.go`
- Modify: `backend/internal/repository/task_result_test.go`
- Verify: `web/src/lib/canvas/canvas-image-prompt-command.ts`
- Verify: `web/src/lib/canvas/canvas-image-command-evidence.ts`
- Verify: `web/src/pages/canvas/use-canvas-media-tools.ts`
- Test: `web/test/canvas-portrait-texture-command.test.ts`
- Test: `web/test/canvas-image-command-evidence.test.ts`

**Interfaces:**

- Consumes: the Hono specialist response, existing `GenerationTask`, `BillingOrder`, `TaskLog`, `Result`, `Resource`, and `CanvasChange` flows.
- Produces: one paid image task whose input freezes command/model facts and whose result freezes prompt/trace/provider evidence.

- [ ] **Step 1: Add RED commercial-state tests**

Assert quote cancellation creates no task/order; missing source asset creates no provider call; a specialist failure fails and refunds the image order; repeated execution reuses the same task idempotency key; successful specialist output becomes the exact provider prompt; and final result contains `imagePromptEvidence` with response digest.

- [ ] **Step 2: Add the success-after-provider-failure-boundary test**

Make the image provider return a real asset, then make prompt-evidence attachment/logging fail. Assert the resource/provider result remains recorded and the task is marked for reconciliation rather than refunded or erased.

- [ ] **Step 3: Run focused Go and Bun tests and verify any RED**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service ./internal/repository -run 'Test.*ImagePrompt|Test.*PortraitTexture|Test.*TaskResult' -count=1
Pop-Location
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\web'
bun test --isolate test/canvas-portrait-texture-command.test.ts test/canvas-image-command-evidence.test.ts
Pop-Location
```

Expected: any uncovered boundary fails before implementation; already implemented behavior remains green.

- [ ] **Step 4: Make the minimal commercial-state corrections**

Keep the existing front-end structured command payload. Ensure `prepareCanvasImagePromptSpecialist` runs only inside the already created paid image task, persists specialist evidence before image generation, and uses `image-prompt:<taskId>` for Hono idempotency. Do not add a browser prompt template or a second quote.

- [ ] **Step 5: Run the affected HMaigc gates**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./internal/service ./internal/repository -run 'Test.*ImagePrompt|Test.*PortraitTexture|Test.*TaskBilling|Test.*Provider' -count=1
go vet ./internal/service ./internal/repository
Pop-Location
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\web'
bun test --isolate test/canvas-portrait-texture-command.test.ts test/canvas-image-command-evidence.test.ts
bun run build
Pop-Location
```

Expected: PASS.

- [ ] **Step 6: Review and commit only the commercial integration slice**

```powershell
git diff --check
git add -- backend/internal/service/image_prompt_specialist.go backend/internal/service/image_prompt_specialist_test.go backend/internal/service/provider.go backend/internal/repository/task_result_test.go web/src/lib/canvas/canvas-image-prompt-command.ts web/src/lib/canvas/canvas-image-command-evidence.ts web/src/pages/canvas/use-canvas-media-tools.ts web/test/canvas-portrait-texture-command.test.ts web/test/canvas-image-command-evidence.test.ts
git commit -m "feat: complete paid portrait texture pipeline"
```

---

### Task 9: Final Review, Failure Matrix, and Controlled Paid E2E

**Files:**

- Modify only files implicated by the single concentrated review pass.
- Do not add case-specific completion rules, prompt keyword checks, compatibility branches, or database migrations.

**Interfaces:**

- Consumes: all previous task deliverables.
- Produces: reviewed build/test evidence and one real paid artifact chain suitable for rollout approval.

- [ ] **Step 1: Run an explicit requirement-to-diff review**

Check the approved spec against both repository diffs: sole model authority, five-part binding, service authentication in both directions, grant single-use, Redis fail-closed, zero retry, no tools, strict output, platform-cost audit, prompt evidence, successful-asset preservation, rollout closed, and required docs.

```powershell
git status --short
git diff --stat
git diff --check
rg -n "fallback|default route|AGENTS_IMAGE_PROMPT_RELAY_TOKEN|IMAGE_PROMPT_LLM_RELAY_TOKEN" apps packages
```

- [ ] **Step 2: Run the root repository exact suites**

```powershell
node --test packages/schemas/image-prompt-specialist/index.test.mjs
corepack pnpm --filter agents test -- image-prompt-relay-client.test.ts image-prompt-route.test.ts image-prompt-specialist.test.ts
corepack pnpm --filter agents build
corepack pnpm --filter @tapcanvas/api exec vitest run src/modules/internal/image-prompt-relay-grant.test.ts src/modules/internal/internal-hmaigc-model-client.test.ts src/modules/internal/image-prompt-model-relay.test.ts src/modules/internal/image-prompt-specialist.service.test.ts src/modules/internal/image-prompt-specialist.routes.test.ts src/modules/internal/internal-agents-client.test.ts
corepack pnpm --filter @tapcanvas/api typecheck
corepack pnpm --filter @tapcanvas/api build
```

- [ ] **Step 3: Run the HMaigc exact and full stable gates**

```powershell
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\backend'
go test ./... -count=1
go vet ./...
Pop-Location
Push-Location 'E:\新版短剧制作\open-ai-canvas\.worktrees\release-v1.0.73\web'
bun test --isolate
bun run build
Pop-Location
```

Expected: all current-release gates PASS. If an unrelated baseline failure appears, record its exact command and pre-existing evidence; do not hide it or modify unrelated code.

- [ ] **Step 4: Execute the no-paid failure matrix**

With local Docker services, verify wrong HMAC, expired timestamp, replayed nonce, Redis unavailable, invalid grant, replayed grant, model revision drift, endpoint drift, credential drift, parent task mismatch, cancelled task, provider 500, provider timeout, wrong effective model, missing usage, Markdown-wrapped JSON, and empty prompt. For every case assert zero image-provider call and a stable error with the shared correlation ID.

- [ ] **Step 5: Execute browser regression before spending credits**

In Chromium and one second engine, verify login, canvas load, source image selection, toolbar command visibility under rollout, quote cancellation, double-click deduplication, failed task display, refresh recovery, and unchanged normal image generation. Keep `canvasToolRegistryV2` closed for accounts outside the test cohort.

- [ ] **Step 6: Execute one controlled paid `portraitTexture` run**

Record before/after credit balance and verify exactly one image billing order, one generation task, one Hono idempotency record, one consumed relay grant, one HMaigc provider call, one prompt evidence result, one resource, one canvas change, and one derived node with the exact stored prompt/trace digest. Confirm the internal specialist inference created no second user billing order.

- [ ] **Step 7: Perform one concentrated fix and one targeted re-review**

Fix only defects found in Steps 1–6, rerun only affected focused gates, then rerun the complete confirmation once. If the targeted re-review still finds a new cross-module Critical/Important defect or an unclosed shared transaction, stop implementation and return to architecture rather than adding a third patch round.

- [ ] **Step 8: Prepare the final local commits and report**

Before each repository commit, inspect `git diff --cached --name-only` and exclude local data, secrets, build output, screenshots, and unrelated work. Report commit hashes, exact passing commands, known baseline failures, paid order/task/resource IDs, credit delta, rollout state, and rollback order. Do not push or deploy.
