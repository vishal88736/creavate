import { randomUUID, createHash } from "node:crypto";
import {
  AnalysisSchema,
  ManifestSchema,
  requireApproval,
  hash,
  sign,
  escapeMentions,
  AppError,
  type Action,
  type Manifest,
  type Role,
  type RunContext,
  type Handoff,
  type Analysis,
} from "@creavate/shared";
import {
  query,
  one,
  transaction,
  transition,
  incrementHop,
  activity,
  audit,
} from "./db.js";
import { google, slackConnection, slackApi } from "./oauth.js";
import { config, required } from "./config.js";
export async function taskData(uid: string, taskId: string) {
  const task = await one("select * from tasks where id=$1 and user_id=$2", [
    taskId,
    uid,
  ]);
  const email = await one(
    "select id,gmail_id,thread_id,sender,subject,attachments,received_at from emails where id=$1 and user_id=$2",
    [task.email_id, uid],
  );
  const deal = task.deal_id
    ? (
        await query("select * from deals where id=$1 and user_id=$2", [
          task.deal_id,
          uid,
        ])
      )[0]
    : null;
  const approvals = await query(
    "select * from approvals where task_id=$1 and user_id=$2 order by created_at desc",
    [taskId, uid],
  );
  return { task, email, deal, approvals };
}
export async function enqueue(
  db: any,
  uid: string,
  taskId: string,
  from: Role,
  to: Role,
  kind: Handoff["kind"],
  summary: string,
) {
  const old = (
    await db.query(
      "select * from handoffs where task_id=$1 and kind=$2 and recipient=$3",
      [taskId, kind, to],
    )
  ).rows[0];
  if (old) return old;
  await incrementHop(uid, taskId, db);
  const payload: Handoff = {
    id: randomUUID(),
    user_id: uid,
    task_id: taskId,
    from,
    to,
    kind,
    created_at: new Date().toISOString(),
  };
  const result = (
    await db.query(
      "insert into handoffs(id,user_id,task_id,sender,recipient,kind,summary,payload) values($1,$2,$3,$4,$5,$6,$7,$8) returning *",
      [
        payload.id,
        uid,
        taskId,
        from,
        to,
        kind,
        summary,
        JSON.stringify(payload),
      ],
    )
  ).rows[0];
  await activity(
    uid,
    taskId,
    from,
    "handoff.queued",
    { id: payload.id, to, kind },
    db,
  );
  return result;
}
export function handoffBody(row: any, callId: string) {
  return `${escapeMentions(row.summary).slice(0, 10000)}\n\nTrace: ${callId}\nCREAVATE/1 ${sign(row.payload, required("APP_SECRET"))}`;
}
export async function failTask(
  uid: string,
  taskId: string,
  actor: Role,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Execution failed";
  await transaction(async (db) => {
    const task = (
      await db.query(
        "select * from tasks where id=$1 and user_id=$2 for no key update",
        [taskId, uid],
      )
    ).rows[0];
    if (!task || ["completed", "rejected", "failed"].includes(task.state))
      return;
    await transition(uid, taskId, "failed", actor, message, db);
    await db.query("update emails set status='failed' where id=$1", [
      task.email_id,
    ]);
  });
}
export async function requestAnalysis(ctx: RunContext) {
  return audit(ctx, "workflow.requestAnalysis", {}, async () =>
    transaction(async (db) => {
      const task = (
        await db.query(
          "select * from tasks where id=$1 and user_id=$2 for no key update",
          [ctx.taskId, ctx.userId],
        )
      ).rows[0];
      if (!task) throw new AppError(404, "Task not found");
      if (task.state === "received")
        await transition(
          ctx.userId,
          ctx.taskId,
          "analyzing",
          ctx.role,
          undefined,
          db,
        );
      else if (task.state !== "analyzing")
        throw new AppError(409, "Task is not ready for analysis");
      const mail = (
        await db.query("select subject,sender from emails where id=$1", [
          task.email_id,
        ])
      ).rows[0];
      return enqueue(
        db,
        ctx.userId,
        ctx.taskId,
        ctx.role,
        "brand-agent",
        "analyze",
        `Analyze the persisted sponsorship inquiry: ${mail.subject}. Sender: ${mail.sender}.`,
      );
    }),
  );
}
export async function submitAnalysis(
  ctx: RunContext,
  raw: unknown,
  briefFiles: string[] = [],
) {
  if (ctx.role !== "brand-agent")
    throw new AppError(403, "Only Brand Agent can submit a deal analysis");
  const reads = await query(
    `select calls.id from tool_calls calls
     join tasks task on task.id=calls.task_id and task.user_id=calls.user_id
     join emails email on email.id=task.email_id and email.user_id=calls.user_id
     where calls.user_id=$1 and calls.task_id=$2 and calls.agent='brand-agent'
       and calls.tool='gmail.getThread' and calls.error is null and calls.duration is not null
       and calls.result->>'thread_id'=email.thread_id
       and case when jsonb_typeof(calls.result->'messages')='array'
         then jsonb_array_length(calls.result->'messages') else 0 end>0 limit 1`,
    [ctx.userId, ctx.taskId],
  );
  if (!reads.length)
    throw new AppError(
      403,
      "Read the actual inquiry thread before submitting an analysis",
    );
  const analysis = AnalysisSchema.parse(raw);
  if (analysis.fee === null && !analysis.red_flags.some((x) => /fee/i.test(x)))
    analysis.red_flags = [...analysis.red_flags.slice(0, 39), "Missing fee"];
  const verifiedBriefs: { id: string; name: string }[] = [];
  for (const id of [...new Set(briefFiles)].slice(0, 10)) {
    const meta = await audit(
      ctx,
      "drive.readFile.metadata",
      { file_id: id },
      () => google.file(ctx.userId, id),
    );
    verifiedBriefs.push({ id: meta.id, name: meta.name });
  }
  return audit(
    ctx,
    "deals.submitAnalysis",
    { analysis, brief_files: verifiedBriefs },
    async () =>
      transaction(async (db) => {
        const task = (
          await db.query(
            "select * from tasks where id=$1 and user_id=$2 for no key update",
            [ctx.taskId, ctx.userId],
          )
        ).rows[0];
        if (!task || task.state !== "analyzing")
          throw new AppError(409, "Task is not analyzing");
        if (task.deal_id)
          return (
            await db.query("select * from deals where id=$1", [task.deal_id])
          ).rows[0];
        let result: any;
        if (!analysis.is_sponsorship) {
          await transition(
            ctx.userId,
            ctx.taskId,
            "rejected",
            ctx.role,
            "Classified as not a sponsorship inquiry",
            db,
          );
          await db.query(
            "update emails set status='not_sponsorship' where id=$1",
            [task.email_id],
          );
          result = {
            classification: "not_sponsorship",
            summary: analysis.summary,
          };
        } else {
          result = (
            await db.query(
              "insert into deals(user_id,email_id,brand,contact,deliverables,fee,currency,dates,exclusivity,usage_rights,payment_terms,red_flags,fit_score,summary,analysis,brief_files) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *",
              [
                ctx.userId,
                task.email_id,
                analysis.brand,
                JSON.stringify(analysis.contact),
                JSON.stringify(analysis.deliverables),
                analysis.fee,
                analysis.currency,
                JSON.stringify(analysis.dates),
                analysis.exclusivity,
                analysis.usage_rights,
                analysis.payment_terms,
                analysis.red_flags,
                analysis.fit_score,
                analysis.summary,
                JSON.stringify(analysis),
                JSON.stringify(verifiedBriefs),
              ],
            )
          ).rows[0];
          await db.query("update tasks set deal_id=$1 where id=$2", [
            result.id,
            ctx.taskId,
          ]);
          await db.query("update emails set status='analyzed' where id=$1", [
            task.email_id,
          ]);
          await activity(
            ctx.userId,
            ctx.taskId,
            ctx.role,
            "deal.analyzed",
            { deal_id: result.id, fit_score: result.fit_score },
            db,
          );
        }
        await enqueue(
          db,
          ctx.userId,
          ctx.taskId,
          ctx.role,
          "talent-manager",
          "analysis_ready",
          JSON.stringify({
            deal_id: result.id || null,
            classification: result.classification,
            summary: result.summary,
            red_flags: analysis.red_flags,
            fit_score: analysis.fit_score,
          }),
        );
        return result;
      }),
  );
}
export async function buildManifest(ctx: RunContext): Promise<Manifest> {
  const data = await taskData(ctx.userId, ctx.taskId);
  if (!data.deal) throw new AppError(409, "No validated deal analysis exists");
  const full = await one("select * from emails where id=$1 and user_id=$2", [
    data.email.id,
    ctx.userId,
  ]);
  if (full.attachments.length > 10)
    throw new AppError(
      413,
      "More than ten attachments require manual review; no partial action plan was created",
    );
  const a = (
    tool: Action["tool"],
    title: string,
    args: Action["args"],
  ): Action => ({ id: randomUUID(), tool, title, args });
  const folder = a(
    "drive.createFolder",
    `Create campaign folder for ${data.deal.brand}`,
    {
      name: `${data.deal.brand} — ${data.deal.id.slice(0, 8)}`,
      parent_id: config.GOOGLE_DRIVE_PARENT_ID || null,
    },
  );
  const actions: Action[] = [
    folder,
    a("drive.writeBrief", "Save the original inquiry as inquiry.txt", {
      email_id: full.id,
      name: "inquiry.txt",
      folder_action_id: folder.id,
      sha256: createHash("sha256").update(full.body).digest("hex"),
    }),
  ];
  for (const attachment of full.attachments.slice(0, 10)) {
    const bytes = await audit(
      ctx,
      "gmail.getAttachment.plan",
      {
        message_id: attachment.message_id,
        attachment_id: attachment.attachment_id,
      },
      async () => {
        const b = await google.attachmentBytes(ctx.userId, attachment);
        return {
          sha256: createHash("sha256").update(b).digest("hex"),
          size: b.length,
        };
      },
    );
    actions.push(
      a("drive.uploadAttachment", `File attachment: ${attachment.filename}`, {
        ...attachment,
        folder_action_id: folder.id,
        sha256: bytes.sha256,
      }),
    );
  }
  for (const brief of data.deal.brief_files)
    actions.push(
      a("drive.copyFile", `Copy brief: ${brief.name}`, {
        file_id: brief.id,
        folder_action_id: folder.id,
      }),
    );
  for (const date of (data.deal.analysis as Analysis).dates) {
    actions.push(
      a(
        "calendar.createEvent",
        `${data.deal.brand}: ${date.label} — ${date.due_at}`,
        {
          title: `${data.deal.brand}: ${date.label}`,
          due_at: date.due_at,
          calendar_id: config.GOOGLE_CALENDAR_ID,
        },
      ),
    );
    actions.push(
      a("tasks.create", date.label, { title: date.label, due_at: date.due_at }),
    );
  }
  for (const deliverable of data.deal.deliverables)
    actions.push(
      a("tasks.create", deliverable, { title: deliverable, due_at: null }),
    );
  const connection = await one(
    "select connection_id,google_email from google_connections where user_id=$1",
    [ctx.userId],
  );
  for (const action of actions) {
    action.args.google_connection_id = connection.connection_id;
    action.args.google_account = connection.google_email;
  }
  return ManifestSchema.parse({
    task_id: ctx.taskId,
    deal_id: data.deal.id,
    actions,
  });
}
export async function requestApproval(ctx: RunContext) {
  const existing = (
    await query(
      "select * from approvals where task_id=$1 and user_id=$2 and status='pending'",
      [ctx.taskId, ctx.userId],
    )
  )[0];
  if (existing) return existing;
  const manifest = await buildManifest(ctx);
  return audit(ctx, "approvals.request", { manifest }, async () =>
    transaction(async (db) => {
      const t = (
        await db.query(
          "select * from tasks where id=$1 and user_id=$2 for no key update",
          [ctx.taskId, ctx.userId],
        )
      ).rows[0];
      if (t.state !== "analyzing")
        throw new AppError(
          409,
          "Approval can only be requested after analysis",
        );
      const old = (
        await db.query(
          "select * from approvals where task_id=$1 and status='pending'",
          [ctx.taskId],
        )
      ).rows[0];
      if (old) return old;
      const row = (
        await db.query(
          "insert into approvals(user_id,task_id,deal_id,requested_action,manifest_hash,expires_at) values($1,$2,$3,$4,$5,now()+$6*interval '1 hour') returning *",
          [
            ctx.userId,
            ctx.taskId,
            t.deal_id,
            JSON.stringify(manifest),
            hash(manifest),
            config.APPROVAL_TTL_HOURS,
          ],
        )
      ).rows[0];
      await transition(
        ctx.userId,
        ctx.taskId,
        "awaiting_approval",
        ctx.role,
        undefined,
        db,
      );
      return row;
    }),
  );
}
export async function decideApproval(
  uid: string,
  id: string,
  decision: "approved" | "rejected",
  source: "dashboard" | "slack",
  slackProof?: {
    workspaceId: string;
    channelId: string;
    messageTs: string;
    senderId: string;
  },
) {
  return transaction(async (db) => {
    const row = (
      await db.query(
        "select * from approvals where id=$1 and user_id=$2 for no key update",
        [id, uid],
      )
    ).rows[0];
    if (!row) throw new AppError(404, "Approval not found");
    if (row.status !== "pending")
      throw new AppError(409, "Approval already decided");
    if (new Date(row.expires_at).getTime() <= Date.now())
      throw new AppError(409, "Approval expired");
    if (hash(row.requested_action) !== row.manifest_hash)
      throw new AppError(403, "Approval manifest was modified");
    if (source === "slack") {
      const user = (await db.query("select * from users where id=$1", [uid]))
        .rows[0];
      if (
        !slackProof ||
        !user.identity_verified_at ||
        user.slack_user_id !== slackProof.senderId
      )
        throw new AppError(
          403,
          "Only the verified creator can approve in Slack",
        );
      await db.query(
        "insert into slack_decisions(workspace_id,channel_id,message_ts,user_id,approval_id) values($1,$2,$3,$4,$5)",
        [
          slackProof.workspaceId,
          slackProof.channelId,
          slackProof.messageTs,
          uid,
          id,
        ],
      );
    }
    const result = (
      await db.query(
        "update approvals set status=$1,decided_by=$2,decided_at=now(),source=$3,verified_identity=true where id=$4 returning *",
        [decision, uid, source, id],
      )
    ).rows[0];
    await transition(uid, row.task_id, decision, "creator", undefined, db);
    await db.query("update deals set status=$1 where id=$2", [
      decision,
      row.deal_id,
    ]);
    await activity(
      uid,
      row.task_id,
      "creator",
      "approval." + decision,
      { approval_id: id, source },
      db,
    );
    if (decision === "approved")
      await enqueue(
        db,
        uid,
        row.task_id,
        "brand-agent",
        "talent-manager",
        "execute",
        `Creator approval ${id} is recorded. Check the authoritative task and approval before requesting campaign execution.`,
      );
    return result;
  });
}
export function parseSlackDecision(text: string) {
  const stripped = text.trim().replace(/^<@[A-Z0-9]+>\s*/, "");
  const match =
    /^(approve|reject)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      stripped,
    );
  return match
    ? {
        id: match[2].toLowerCase(),
        decision:
          match[1].toLowerCase() === "approve"
            ? ("approved" as const)
            : ("rejected" as const),
      }
    : null;
}
export async function pollSlackApprovals(uid: string) {
  const pending = await query(
    "select id,created_at from approvals where user_id=$1 and status='pending' and expires_at>now() order by created_at limit 30",
    [uid],
  );
  if (!pending.length) return { checked: 0 };
  const conn = await slackConnection(uid);
  if (!conn.channel_id)
    throw new AppError(409, "Select a Slack channel in Profile");
  const oldest = String(new Date(pending[0].created_at).getTime() / 1000);
  const history = await slackApi(conn.access_token, "conversations.history", {
    channel: conn.channel_id,
    oldest,
    limit: "100",
  });
  const messages = [...(history.messages || [])];
  for (const root of (history.messages || [])
    .filter((m: any) => m.reply_count > 0)
    .slice(0, 10)) {
    const thread = await slackApi(conn.access_token, "conversations.replies", {
      channel: conn.channel_id,
      ts: root.ts,
      oldest,
      limit: "100",
    });
    messages.push(...(thread.messages || []));
  }
  let count = 0;
  for (const message of messages) {
    if (
      message.user !== conn.slack_user_id ||
      message.bot_id ||
      message.subtype
    )
      continue;
    const parsed = parseSlackDecision(message.text || "");
    if (!parsed || !pending.some((x) => x.id === parsed.id)) continue;
    const duplicate = await query(
      "select 1 from slack_decisions where workspace_id=$1 and channel_id=$2 and message_ts=$3",
      [conn.workspace_id, conn.channel_id, message.ts],
    );
    if (duplicate.length) continue;
    await decideApproval(uid, parsed.id, parsed.decision, "slack", {
      workspaceId: conn.workspace_id,
      channelId: conn.channel_id,
      messageTs: message.ts,
      senderId: message.user,
    });
    count++;
  }
  return { checked: messages.length, decisions: count };
}
export async function requestExecution(ctx: RunContext) {
  return audit(ctx, "workflow.requestExecution", {}, async () =>
    transaction(async (db) => {
      const row = (
        await db.query(
          "select * from tasks where id=$1 and user_id=$2 for no key update",
          [ctx.taskId, ctx.userId],
        )
      ).rows[0];
      if (row.state !== "approved")
        throw new AppError(409, "Creator approval is required");
      return enqueue(
        db,
        ctx.userId,
        ctx.taskId,
        ctx.role,
        "campaign-agent",
        "execute",
        `Execute the recorded approved action manifest for task ${ctx.taskId}.`,
      );
    }),
  );
}
async function parentFolder(
  ctx: RunContext,
  approvalId: string,
  action: Action,
) {
  const dependency = String(action.args.folder_action_id || "");
  const row = await one(
    "select result from approval_executions where approval_id=$1 and action_id=$2 and user_id=$3 and state='succeeded'",
    [approvalId, dependency, ctx.userId],
  );
  if (!row.result.id)
    throw new AppError(409, "Approved folder action has not completed");
  return String(row.result.id);
}
export async function executeAction(
  ctx: RunContext,
  approvalId: string,
  actionId: string,
) {
  let action!: Action;
  const claim = await transaction(async (db) => {
    const active = await db.query(
      "select id from agent_runs where id=$1 and user_id=$2 and task_id=$3 and agent=$4 and status='running'",
      [ctx.runId, ctx.userId, ctx.taskId, ctx.role],
    );
    if (!active.rows.length)
      throw new AppError(403, "The authorizing agent run is no longer active");
    const a = (
      await db.query(
        "select *,requested_action as manifest from approvals where id=$1 for no key update",
        [approvalId],
      )
    ).rows[0];
    const task = (
      await db.query(
        "select * from tasks where id=$1 and user_id=$2 for no key update",
        [ctx.taskId, ctx.userId],
      )
    ).rows[0];
    if (!task || !["approved", "executing"].includes(task.state))
      throw new AppError(409, "Task is not approved for execution");
    action = requireApproval(a, {
      userId: ctx.userId,
      dealId: task.deal_id,
      taskId: ctx.taskId,
      actionId,
      role: ctx.role,
    });
    const old = (
      await db.query(
        "select * from approval_executions where approval_id=$1 and action_id=$2",
        [approvalId, actionId],
      )
    ).rows[0];
    if (old) {
      if (old.state === "succeeded") return old;
      throw new AppError(
        409,
        "Action already attempted; reconcile its real provider result before retrying",
      );
    }
    return (
      await db.query(
        "insert into approval_executions(approval_id,action_id,user_id,state) values($1,$2,$3,'claimed') returning *",
        [approvalId, actionId, ctx.userId],
      )
    ).rows[0];
  });
  if (claim.state === "succeeded") return claim.result;
  return audit(
    ctx,
    action.tool,
    { action_id: action.id, approved_args: action.args },
    async () => {
      let resourceId: string | undefined;
      let expectedMd5: string | undefined;
      let expectedParent: string | undefined;
      try {
        const task = await one(
          "select * from tasks where id=$1 and user_id=$2",
          [ctx.taskId, ctx.userId],
        );
        let result: any;
        const args = action.args;
        const permit = {
          context: ctx,
          approvalId,
          actionId: action.id,
          tool: action.tool,
        };
        if (
          action.tool === "drive.createFolder" ||
          action.tool === "drive.uploadAttachment" ||
          action.tool === "drive.writeBrief"
        ) {
          resourceId = await google.generateId(ctx.userId);
          await query(
            "update approval_executions set resource_id=$1 where approval_id=$2 and action_id=$3",
            [resourceId, approvalId, action.id],
          );
          if (action.tool === "drive.createFolder")
            await google.createFolder(
              ctx.userId,
              resourceId,
              String(args.name),
              args.parent_id ? String(args.parent_id) : undefined,
              action.id,
              permit,
            );
          else {
            const folder = await parentFolder(ctx, approvalId, action);
            expectedParent = folder;
            let bytes: Buffer;
            let mime: string;
            let name: string;
            if (action.tool === "drive.writeBrief") {
              const email = await one(
                "select body from emails where id=$1 and user_id=$2",
                [args.email_id, ctx.userId],
              );
              bytes = Buffer.from(email.body);
              mime = "text/plain";
              name = String(args.name);
            } else {
              bytes = await google.attachmentBytes(ctx.userId, args as any);
              mime = String(args.mime_type);
              name = String(args.filename);
            }
            if (
              createHash("sha256").update(bytes).digest("hex") !== args.sha256
            )
              throw new AppError(403, "Approved source file contents changed");
            expectedMd5 = createHash("md5").update(bytes).digest("hex");
            await google.upload(
              ctx.userId,
              resourceId,
              name,
              folder,
              mime,
              bytes,
              action.id,
              permit,
            );
          }
          result = await google.file(ctx.userId, resourceId);
          if (
            result.appProperties?.creavate_action !== action.id ||
            result.id !== resourceId ||
            (expectedMd5 && result.md5Checksum !== expectedMd5) ||
            (expectedParent && !result.parents?.includes(expectedParent))
          )
            throw new AppError(
              502,
              "Google file readback did not match the approved action or contents",
            );
        } else if (action.tool === "drive.copyFile") {
          const parent = await parentFolder(ctx, approvalId, action);
          const copied = await google.copy(
            ctx.userId,
            String(args.file_id),
            parent,
            action.id,
            permit,
          );
          resourceId = copied.id;
          result = await google.file(ctx.userId, resourceId!);
          if (!result.parents?.includes(parent))
            throw new AppError(502, "Copied brief readback failed");
        } else if (action.tool === "drive.moveFile") {
          const parent = await parentFolder(ctx, approvalId, action);
          expectedParent = parent;
          resourceId = String(args.file_id);
          await google.move(ctx.userId, resourceId, parent, permit);
          result = await google.file(ctx.userId, resourceId);
          if (!result.parents?.includes(parent))
            throw new AppError(502, "Moved file readback failed");
        } else if (action.tool === "calendar.createEvent") {
          resourceId = action.id.replaceAll("-", "");
          await query(
            "update approval_executions set resource_id=$1 where approval_id=$2 and action_id=$3",
            [resourceId, approvalId, action.id],
          );
          await google.createEvent(
            ctx.userId,
            String(args.calendar_id),
            resourceId,
            String(args.title),
            String(args.due_at),
            action.id,
            permit,
          );
          result = await google.event(
            ctx.userId,
            String(args.calendar_id),
            resourceId,
          );
          if (
            result.extendedProperties?.private?.creavate_action !== action.id ||
            result.summary !== args.title ||
            new Date(result.start?.dateTime).getTime() !==
              new Date(String(args.due_at)).getTime()
          )
            throw new AppError(502, "Calendar event readback failed");
        } else {
          result = await one(
            `insert into campaign_tasks(id,user_id,deal_id,title,due_at,approval_id)
             select $1,$2,$3,$4,$5,$6 where exists(
               select 1 from agent_runs run join tasks task on task.id=run.task_id
               join approvals approval on approval.id=$6 and approval.task_id=task.id
               where run.id=$7 and run.user_id=$2 and run.agent='campaign-agent' and run.status='running'
                 and task.id=$8 and task.user_id=$2 and task.state='executing'
                 and approval.user_id=$2 and approval.deal_id=$3 and approval.status='approved'
                 and approval.verified_identity and approval.decided_by=$2 and approval.expires_at>now()
             ) returning *`,
            [
              action.id,
              ctx.userId,
              task.deal_id,
              args.title,
              args.due_at,
              approvalId,
              ctx.runId,
              ctx.taskId,
            ],
          );
        }
        await query(
          "update approval_executions set state='succeeded',result=$1,resource_id=$2,finished_at=now() where approval_id=$3 and action_id=$4",
          [JSON.stringify(result), resourceId || null, approvalId, action.id],
        );
        return result;
      } catch (e) {
        if (resourceId) {
          try {
            let actual: any;
            if (action.tool === "calendar.createEvent") {
              actual = await google.event(
                ctx.userId,
                String(action.args.calendar_id),
                resourceId,
              );
              if (
                actual.extendedProperties?.private?.creavate_action !==
                  action.id ||
                actual.summary !== action.args.title ||
                new Date(actual.start?.dateTime).getTime() !==
                  new Date(String(action.args.due_at)).getTime()
              )
                throw new Error("Readback mismatch");
            } else if (action.tool.startsWith("drive.")) {
              actual = await google.file(ctx.userId, resourceId);
              if (action.tool === "drive.moveFile") {
                if (!actual.parents?.includes(expectedParent))
                  throw new Error("Readback mismatch");
              } else if (
                actual.appProperties?.creavate_action !== action.id ||
                (expectedMd5 && actual.md5Checksum !== expectedMd5) ||
                (expectedParent && !actual.parents?.includes(expectedParent))
              )
                throw new Error("Readback mismatch");
            }
            if (actual) {
              await query(
                "update approval_executions set state='succeeded',result=$1,resource_id=$2,finished_at=now() where approval_id=$3 and action_id=$4",
                [JSON.stringify(actual), resourceId, approvalId, action.id],
              );
              return actual;
            }
          } catch {
            /* A readback failure remains uncertain; never repeat the write. */
          }
        }
        await query(
          "update approval_executions set state='uncertain',error=$1,finished_at=now() where approval_id=$2 and action_id=$3",
          [
            e instanceof Error ? e.message : "Provider result uncertain",
            approvalId,
            action.id,
          ],
        );
        throw e;
      }
    },
    approvalId,
  );
}
export async function executeCampaign(ctx: RunContext, approvalId: string) {
  if (ctx.role !== "campaign-agent")
    throw new AppError(403, "Campaign Agent role required");
  const a = await one(
    "select *,requested_action as manifest from approvals where id=$1 and user_id=$2 and task_id=$3",
    [approvalId, ctx.userId, ctx.taskId],
  );
  const manifest = ManifestSchema.parse(a.manifest);
  requireApproval(a, {
    userId: ctx.userId,
    taskId: ctx.taskId,
    dealId: manifest.deal_id,
    actionId: manifest.actions[0].id,
    role: ctx.role,
  });
  const task = await one("select * from tasks where id=$1 and user_id=$2", [
    ctx.taskId,
    ctx.userId,
  ]);
  if (task.state === "approved")
    await transition(ctx.userId, ctx.taskId, "executing", ctx.role);
  try {
    const results: { action_id: string; tool: string; result: any }[] = [];
    for (const action of manifest.actions)
      results.push({
        action_id: action.id,
        tool: action.tool,
        result: await executeAction(ctx, approvalId, action.id),
      });
    const folder = results.find((x) => x.tool === "drive.createFolder")
      ?.result as any;
    const events = results
      .filter((x) => x.tool === "calendar.createEvent")
      .map((x) => (x.result as any).id);
    const campaign = await one(
      "insert into campaigns(user_id,deal_id,drive_folder_id,calendar_event_ids) values($1,$2,$3,$4) on conflict(deal_id) do update set drive_folder_id=excluded.drive_folder_id,calendar_event_ids=excluded.calendar_event_ids returning *",
      [ctx.userId, manifest.deal_id, folder?.id || null, events],
    );
    await transaction(async (db) => {
      await transition(
        ctx.userId,
        ctx.taskId,
        "completed",
        ctx.role,
        undefined,
        db,
      );
      await db.query("update deals set status='completed' where id=$1", [
        manifest.deal_id,
      ]);
      await enqueue(
        db,
        ctx.userId,
        ctx.taskId,
        ctx.role,
        "talent-manager",
        "execution_ready",
        JSON.stringify({ campaign, results }),
      );
    });
    return { campaign, results };
  } catch (e) {
    await failTask(ctx.userId, ctx.taskId, ctx.role, e);
    throw e;
  }
}
