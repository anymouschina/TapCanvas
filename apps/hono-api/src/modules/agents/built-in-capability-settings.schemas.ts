import { z } from "zod";

export const AdminBuiltInCapabilitySchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	requiredTools: z.array(z.string()),
	sideEffects: z.array(z.enum(["none", "external_mutation", "paid_generation"])),
	replaceable: z.boolean(),
	enabled: z.boolean(),
	updatedAt: z.string().nullable(),
	updatedByUserId: z.string().nullable(),
}).strict();

export const UpdateAdminBuiltInCapabilityRequestSchema = z.object({
	enabled: z.boolean(),
}).strict();

export type AdminBuiltInCapability = z.infer<typeof AdminBuiltInCapabilitySchema>;
