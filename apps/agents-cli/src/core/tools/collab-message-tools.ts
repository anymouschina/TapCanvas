import { ToolHandler } from "./registry.js";
import { PersistedProtocolResponseStatus } from "../collab/protocol-store.js";
import { getManager } from "./collab-tool-helpers.js";

export function createMailboxSendTool(): ToolHandler {
  return {
    definition: {
      name: "mailbox_send",
      description:
        "Send a persistent mailbox message to a team agent. Use this for async coordination or evidence handoff that must survive process restarts.",
      parameters: {
        type: "object",
        properties: {
          to_agent_id: { type: "string", description: "Recipient agent id" },
          body: { type: "string", description: "Message body" },
          subject: { type: "string", description: "Optional short subject line" },
        },
        required: ["to_agent_id", "body"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const fromAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId : undefined;
        const subject = typeof args.subject === "string" ? args.subject.trim() : "";
        const message = mgr.sendMailboxMessage({
          toAgentId: String(args.to_agent_id ?? ""),
          body: String(args.body ?? ""),
          ...(subject ? { subject } : {}),
          ...(fromAgentId ? { fromAgentId } : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify({
            id: message.id,
            to_agent_id: message.toAgentId,
            from_agent_id: message.fromAgentId,
            subject: message.subject,
            created_at: message.createdAt,
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createMailboxReadTool(): ToolHandler {
  return {
    definition: {
      name: "mailbox_read",
      description:
        "Read persistent mailbox messages for a team agent. Defaults to the current agent inbox and marks unread messages as read.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Optional target agent id. Defaults to the current agent when omitted.",
          },
          include_read: {
            type: "boolean",
            description: "Include already-read messages.",
          },
          mark_as_read: {
            type: "boolean",
            description: "Mark unread messages as read after reading. Defaults to true.",
          },
          limit: {
            type: "number",
            description: "Optional maximum number of messages to return.",
          },
        },
        required: [],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const defaultAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId : "";
        const agentId = String(args.agent_id ?? defaultAgentId).trim();
        if (!agentId) {
          throw new Error("mailbox_read 缺少 agent_id，且当前上下文没有 currentAgentId。");
        }
        const limitRaw = Number(args.limit);
        const messages = mgr.readMailbox(agentId, {
          includeRead: args.include_read === true,
          markAsRead: args.mark_as_read !== false,
          ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify({
            agent_id: agentId,
            unread_count: mgr.unreadMailboxCount(agentId),
            messages: messages.map((message) => ({
              id: message.id,
              to_agent_id: message.toAgentId,
              from_agent_id: message.fromAgentId,
              subject: message.subject,
              body: message.body,
              created_at: message.createdAt,
              read_at: message.readAt,
            })),
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createProtocolRequestTool(): ToolHandler {
  return {
    definition: {
      name: "protocol_request",
      description:
        "Create a persistent structured request for a team agent. Use this when work needs an explicit request/reply contract instead of an ad hoc mailbox note.",
      parameters: {
        type: "object",
        properties: {
          to_agent_id: { type: "string", description: "Target agent id" },
          action: { type: "string", description: "Stable action name for the request" },
          input: { type: "string", description: "Structured request payload as text/JSON string" },
        },
        required: ["to_agent_id", "action", "input"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const fromAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId : undefined;
        const request = mgr.requestProtocol({
          toAgentId: String(args.to_agent_id ?? ""),
          action: String(args.action ?? ""),
          input: String(args.input ?? ""),
          ...(fromAgentId ? { fromAgentId } : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify({
            id: request.id,
            from_agent_id: request.fromAgentId,
            to_agent_id: request.toAgentId,
            action: request.action,
            status: request.status,
            created_at: request.createdAt,
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createProtocolReadTool(): ToolHandler {
  return {
    definition: {
      name: "protocol_read",
      description:
        "Read structured protocol requests for a team agent. Defaults to the current agent inbox.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Optional target agent id. Defaults to the current agent when omitted.",
          },
          include_responded: {
            type: "boolean",
            description: "Include already-responded requests.",
          },
          limit: {
            type: "number",
            description: "Optional maximum number of requests to return.",
          },
        },
        required: [],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const defaultAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId : "";
        const agentId = String(args.agent_id ?? defaultAgentId).trim();
        if (!agentId) {
          throw new Error("protocol_read 缺少 agent_id，且当前上下文没有 currentAgentId。");
        }
        const limitRaw = Number(args.limit);
        const requests = mgr.readProtocolInbox(agentId, {
          includeResponded: args.include_responded === true,
          ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify({
            agent_id: agentId,
            pending_count: mgr.protocolPendingCount(agentId),
            requests: requests.map((request) => ({
              id: request.id,
              from_agent_id: request.fromAgentId,
              to_agent_id: request.toAgentId,
              action: request.action,
              input: request.input,
              status: request.status,
              created_at: request.createdAt,
              updated_at: request.updatedAt,
              response: request.response
                ? {
                    responder_agent_id: request.response.responderAgentId,
                    status: request.response.status,
                    output: request.response.output,
                    responded_at: request.response.respondedAt,
                  }
                : null,
            })),
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createProtocolRespondTool(): ToolHandler {
  return {
    definition: {
      name: "protocol_respond",
      description:
        "Respond to a persistent protocol request with a terminal result.",
      parameters: {
        type: "object",
        properties: {
          request_id: { type: "string", description: "Protocol request id" },
          output: { type: "string", description: "Response payload as text/JSON string" },
          status: {
            type: "string",
            enum: ["completed", "failed"],
            description: "Terminal response status",
          },
        },
        required: ["request_id", "output", "status"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const responderAgentId =
          typeof ctx.meta?.currentAgentId === "string" ? ctx.meta.currentAgentId : undefined;
        const request = mgr.respondProtocol({
          requestId: String(args.request_id ?? ""),
          output: String(args.output ?? ""),
          status: String(args.status ?? "") as PersistedProtocolResponseStatus,
          ...(responderAgentId ? { responderAgentId } : {}),
        });
        return {
          toolCallId,
          content: JSON.stringify({
            id: request.id,
            status: request.status,
            response: request.response
              ? {
                  responder_agent_id: request.response.responderAgentId,
                  status: request.response.status,
                  output: request.response.output,
                  responded_at: request.response.respondedAt,
                }
              : null,
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}

export function createProtocolGetTool(): ToolHandler {
  return {
    definition: {
      name: "protocol_get",
      description:
        "Get the current state of a protocol request by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Protocol request id" },
        },
        required: ["id"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const mgr = getManager(ctx.meta);
        const request = mgr.getProtocolRequest(String(args.id ?? ""));
        return {
          toolCallId,
          content: JSON.stringify({
            id: request.id,
            from_agent_id: request.fromAgentId,
            to_agent_id: request.toAgentId,
            action: request.action,
            input: request.input,
            status: request.status,
            created_at: request.createdAt,
            updated_at: request.updatedAt,
            response: request.response
              ? {
                  responder_agent_id: request.response.responderAgentId,
                  status: request.response.status,
                  output: request.response.output,
                  responded_at: request.response.respondedAt,
                }
              : null,
          }),
        };
      } catch (e) {
        return { toolCallId, content: `Error: ${(e as Error).message}` };
      }
    },
  };
}
