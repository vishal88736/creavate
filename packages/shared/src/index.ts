import { z } from "zod";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const roles = [
  "talent-manager",
  "brand-agent",
  "campaign-agent",
] as const;
export const RoleSchema = z.enum(roles);
export type Role = z.infer<typeof RoleSchema>;
export const states = [
  "received",
  "analyzing",
  "awaiting_approval",
  "approved",
  "rejected",
  "executing",
  "completed",
  "failed",
] as const;
export type TaskState = (typeof states)[number];
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
const transitions: Record<TaskState, TaskState[]> = {
  received: ["analyzing", "failed"],
  analyzing: ["awaiting_approval", "rejected", "failed"],
  awaiting_approval: ["approved", "rejected", "failed"],
  approved: ["executing", "failed"],
  executing: ["completed", "failed"],
  completed: [],
  rejected: [],
  failed: [],
};
export function assertTransition(from: TaskState, to: TaskState) {
  if (!transitions[from]?.includes(to))
    throw new AppError(409, `Invalid transition: ${from} → ${to}`);
}
export function nextHop(current: number, max = 6) {
  if (!Number.isInteger(current) || current < 0 || current >= max)
    throw new AppError(409, "Task hop limit exceeded");
  return current + 1;
}
export const DeadlineSchema = z
  .object({
    label: z.string().min(1).max(200),
    due_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const AnalysisSchema = z
  .object({
    is_sponsorship: z.boolean(),
    brand: z.string().min(1).max(200),
    contact: z
      .object({ name: z.string().max(200), email: z.email().nullable() })
      .strict(),
    deliverables: z.array(z.string().min(1).max(500)).max(40),
    fee: z.number().nonnegative().nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    dates: z.array(DeadlineSchema).max(40),
    exclusivity: z.string().max(2000).nullable(),
    usage_rights: z.string().max(2000).nullable(),
    payment_terms: z.string().max(2000).nullable(),
    red_flags: z.array(z.string().max(500)).max(40),
    fit_score: z.number().int().min(0).max(100),
    summary: z.string().min(1).max(4000),
  })
  .strict();
export type Analysis = z.infer<typeof AnalysisSchema>;
export const WriteToolSchema = z.enum([
  "drive.createFolder",
  "drive.uploadAttachment",
  "drive.writeBrief",
  "drive.copyFile",
  "drive.moveFile",
  "calendar.createEvent",
  "tasks.create",
]);
export type WriteTool = z.infer<typeof WriteToolSchema>;
export const ActionSchema = z
  .object({
    id: z.uuid(),
    tool: WriteToolSchema,
    title: z.string().min(1).max(300),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export type Action = z.infer<typeof ActionSchema>;
export const ManifestSchema = z
  .object({
    deal_id: z.uuid(),
    task_id: z.uuid(),
    actions: z.array(ActionSchema).min(1).max(100),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export function hash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export interface ApprovalRecord {
  id: string;
  user_id: string;
  deal_id: string;
  task_id: string;
  status: string;
  decided_by: string | null;
  expires_at: string | Date;
  manifest: Manifest;
  manifest_hash: string;
  source: string | null;
  verified_identity: boolean;
}
export function requireApproval(
  a: ApprovalRecord | null,
  ctx: {
    userId: string;
    dealId: string;
    taskId: string;
    actionId: string;
    role: Role;
  },
  now = Date.now(),
): Action {
  if (ctx.role !== "campaign-agent")
    throw new AppError(403, "This agent has no write permission");
  if (
    !a ||
    a.status !== "approved" ||
    !a.verified_identity ||
    a.decided_by !== a.user_id
  )
    throw new AppError(403, "A verified creator approval is required");
  if (
    a.user_id !== ctx.userId ||
    a.deal_id !== ctx.dealId ||
    a.task_id !== ctx.taskId
  )
    throw new AppError(
      403,
      "Approval belongs to another creator, deal or task",
    );
  if (new Date(a.expires_at).getTime() <= now)
    throw new AppError(403, "Approval expired");
  const manifest = ManifestSchema.parse(a.manifest);
  if (
    manifest.deal_id !== a.deal_id ||
    manifest.task_id !== a.task_id ||
    hash(manifest) !== a.manifest_hash
  )
    throw new AppError(403, "Approval action manifest was modified");
  const action = manifest.actions.find((x) => x.id === ctx.actionId);
  if (!action) throw new AppError(403, "This action was not approved");
  return action;
}
function keyBytes(key: string) {
  const b = Buffer.from(key, "base64");
  if (b.length !== 32)
    throw new AppError(
      503,
      "TOKEN_ENCRYPTION_KEY must be a base64 32-byte key",
    );
  return b;
}
export function encrypt(value: unknown, key: string, owner: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(owner));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    bytes.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string, key: string, owner: string): unknown {
  const [v, iv, tag, data] = value.split(".");
  if (v !== "v1" || !iv || !tag || !data)
    throw new AppError(500, "Invalid encrypted token record");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(key),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
export const HandoffSchema = z
  .object({
    id: z.uuid(),
    user_id: z.uuid(),
    task_id: z.uuid(),
    from: RoleSchema,
    to: RoleSchema,
    kind: z.enum([
      "inquiry",
      "analyze",
      "analysis_ready",
      "execute",
      "execution_ready",
      "failed",
    ]),
    created_at: z.iso.datetime(),
  })
  .strict();
export type Handoff = z.infer<typeof HandoffSchema>;
export function sign(value: unknown, key: string) {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    data + "." + createHmac("sha256", key).update(data).digest("base64url")
  );
}
export function unsign(token: string, key: string): unknown {
  const parts = token.split(".");
  if (parts.length !== 2) throw new AppError(403, "Invalid signed message");
  const [data, sig] = parts;
  const expected = createHmac("sha256", key).update(data).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected))
    throw new AppError(403, "Message signature mismatch");
  return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
}
export function escapeMentions(text: string) {
  return text.replace(/@/g, "＠").replace(/<!/g, "＜!");
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|secret|password|authorization|api.?key|cookie/i.test(k)
          ? "[redacted]"
          : redact(v),
      ]),
    );
  return value;
}
export interface RunContext {
  userId: string;
  taskId: string;
  role: Role;
  runId: string;
}
