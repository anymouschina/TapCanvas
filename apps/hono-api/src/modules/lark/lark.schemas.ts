import { z } from 'zod'

export const SaveLarkAppSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  brand: z.enum(['feishu', 'lark']).default('feishu'),
  ticketChatId: z.string().trim().min(1).optional(),
  ticketMentionMobiles: z.array(z.string().trim().min(1)).max(20).optional(),
})
export type SaveLarkAppInput = z.infer<typeof SaveLarkAppSchema>

export const TicketWebhookProjectQuerySchema = z.object({
  projectId: z.string().trim().min(1),
})

export const TicketBridgeDebugPayloadSchema = z.object({
  projectId: z.string().trim().min(1),
  externalUserId: z.string().trim().min(1),
  senderName: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  imageUrl: z.string().trim().url().optional(),
})
