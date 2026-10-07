import { createHash } from "node:crypto";
export class AuthorEditScopeProtocolError extends Error {
    code;
    path;
    constructor(code, path) {
        super(`${code}: ${path}`);
        this.code = code;
        this.path = path;
        this.name = "AuthorEditScopeProtocolError";
    }
}
const owns = (value, key) => Object.hasOwn(value, key);
const array = (value) => Array.isArray(value);
const object = (value) => value !== null
    && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const encode = (token) => token.replace(/~/g, "~0").replace(/\//g, "~1");
const pointer = (tokens) => tokens.length ? `/${tokens.map(encode).join("/")}` : "";
const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
/** Clone JSON data without getters, sparse arrays, non-JSON values or caller mutation. */
function json(value, path, ancestors = new Set()) {
    if (value === null || typeof value === "boolean" || typeof value === "string")
        return value;
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (!value || typeof value !== "object" || ancestors.has(value)) {
        throw new AuthorEditScopeProtocolError("author_edit_scope_json_invalid", path);
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            const rows = value;
            if (Reflect.ownKeys(value).some(key => key !== "length"
                && (typeof key !== "string" || !Number.isSafeInteger(Number(key)) || String(Number(key)) !== key
                    || Number(key) < 0 || Number(key) >= rows.length))) {
                throw new AuthorEditScopeProtocolError("author_edit_scope_json_invalid", path);
            }
            const copied = [];
            for (let index = 0; index < rows.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                if (!descriptor || !owns(descriptor, "value") || !descriptor.enumerable) {
                    throw new AuthorEditScopeProtocolError("author_edit_scope_json_invalid", `${path}/${index}`);
                }
                copied.push(json(descriptor.value, `${path}/${index}`, ancestors));
            }
            return Object.freeze(copied);
        }
        if (!object(value) || Reflect.ownKeys(value).some(key => typeof key !== "string")) {
            throw new AuthorEditScopeProtocolError("author_edit_scope_json_invalid", path);
        }
        const fields = [];
        for (const key of Object.getOwnPropertyNames(value).sort()) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!owns(descriptor, "value") || !descriptor.enumerable) {
                throw new AuthorEditScopeProtocolError("author_edit_scope_json_invalid", `${path}/${encode(key)}`);
            }
            fields.push([key, json(descriptor.value, `${path}/${encode(key)}`, ancestors)]);
        }
        return Object.freeze(Object.fromEntries(fields));
    }
    finally {
        ancestors.delete(value);
    }
}
function tokens(value) {
    if (typeof value !== "string" || (value !== "" && !value.startsWith("/"))) {
        throw new AuthorEditScopeProtocolError("author_edit_scope_pointer_invalid", "/editablePaths");
    }
    if (value === "")
        return [];
    return value.slice(1).split("/").map(token => {
        if (/~(?:[^01]|$)/.test(token))
            throw new AuthorEditScopeProtocolError("author_edit_scope_pointer_invalid", value);
        return token.replace(/~[01]/g, escape => escape === "~0" ? "~" : "/");
    });
}
const prefix = (parent, child) => parent.length <= child.length
    && parent.every((token, index) => token === child[index]);
function existing(baseline, path) {
    let current = baseline;
    for (const token of path) {
        if (array(current)) {
            const index = Number(token);
            if (!Number.isSafeInteger(index) || index < 0 || String(index) !== token || index >= current.length)
                return false;
            current = current[index];
        }
        else if (object(current) && owns(current, token))
            current = current[token];
        else
            return false;
    }
    return true;
}
function paths(value, baseline) {
    const supplied = json(value, "/editablePaths");
    if (!array(supplied) || supplied.length === 0)
        throw new AuthorEditScopeProtocolError("author_edit_scope_paths_invalid", "/editablePaths");
    const decoded = supplied.map(tokens);
    for (const [index, path] of decoded.entries()) {
        if (!existing(baseline, path))
            throw new AuthorEditScopeProtocolError("author_edit_scope_target_missing", pointer(path));
        if (decoded.slice(0, index).some(prior => prefix(prior, path) || prefix(path, prior))) {
            throw new AuthorEditScopeProtocolError("author_edit_scope_paths_overlap", pointer(path));
        }
    }
    return Object.freeze(decoded.map(pointer).sort());
}
/** Explicit empty-root JSON Pointer authorizes the entire projection; never inferred. */
export function createAuthorEditScope(input) {
    const baseline = json(input.baseline, "/baseline");
    const editablePaths = paths(input.editablePaths, baseline);
    const body = { version: 1, representation: "author_projection",
        baseline, baselineHash: digest(baseline), editablePaths };
    return Object.freeze({ ...body, scopeHash: digest(body) });
}
/** Persisted scope data is validated before it can authorize a candidate action. */
export function normalizeAuthorEditScope(value) {
    const copied = json(value, "/scope");
    if (!object(copied) || copied.version !== 1 || copied.representation !== "author_projection"
        || Object.keys(copied).some(key => !["version", "representation", "baseline", "baselineHash", "editablePaths", "scopeHash"].includes(key))) {
        throw new AuthorEditScopeProtocolError("author_edit_scope_invalid", "/scope");
    }
    const scope = createAuthorEditScope({ baseline: copied.baseline, editablePaths: copied.editablePaths });
    if (copied.baselineHash !== scope.baselineHash)
        throw new AuthorEditScopeProtocolError("author_edit_scope_baseline_hash_mismatch", "/baselineHash");
    if (copied.scopeHash !== scope.scopeHash)
        throw new AuthorEditScopeProtocolError("author_edit_scope_hash_mismatch", "/scopeHash");
    return scope;
}
/** Caller owns rollback/persistence; this function neither edits data nor schedules work. */
export function inspectAuthorEditScope(input) {
    const scope = normalizeAuthorEditScope(input.scope);
    const candidate = json(input.candidate, "/candidate");
    const editable = scope.editablePaths.map(tokens);
    const violations = [];
    const compare = (baseline, current, location) => {
        if (editable.some(path => prefix(path, location)))
            return;
        if (array(baseline) && array(current)) {
            if (baseline.length !== current.length) {
                violations.push({ path: pointer(location), kind: "array_structure_changed" });
                return;
            }
            baseline.forEach((item, index) => compare(item, current[index], [...location, String(index)]));
        }
        else if (object(baseline) && object(current)) {
            for (const key of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) {
                const child = [...location, key];
                if (editable.some(path => prefix(path, child)))
                    continue;
                if (!owns(baseline, key) || !owns(current, key))
                    violations.push({ path: pointer(child), kind: "presence_changed" });
                else
                    compare(baseline[key], current[key], child);
            }
        }
        else if (baseline !== current)
            violations.push({ path: pointer(location), kind: "value_changed" });
    };
    compare(scope.baseline, candidate, []);
    return violations.length === 0 ? Object.freeze({ status: "within_scope", violations: Object.freeze([]) })
        : Object.freeze({ status: "current_action_not_applied", violations: Object.freeze(violations.map(row => Object.freeze(row))) });
}
