/**
 * Public flow node identities can be composed from workflow, item, family,
 * execution and output segments. They are therefore intentionally wider than
 * UUID-sized identifiers. Every API and workflow contract that transports a
 * real flow node ID must use this single bound.
 */
export const FLOW_NODE_ID_MAX_LENGTH = 512;
