import { randomBytes, createHash } from "node:crypto";
import type { Request, Response } from "express";
import { AppError, encrypt, decrypt, requireApproval } from "@creavate/shared";
import { config, required, googleScopes } from "./config.js";
import { one, query, transaction, activity } from "./db.js";
import {
  GoogleApi,
  assertConnectionBinding,
  assertWriteIntent,
  type TokenSource,
} from "@creavate/google-mcp";
import { SwitchGateway } from "@creavate/switch-adapter";
import { readFile } from "node:fs/promises";
export class GoogleTokens implements TokenSource {
  async accessToken(userId: string): Promise<string> {
    return transaction(async (db) => {
      const row = (
        await db.query(
          "select * from google_connections where user_id=$1 for no key update",
          [userId],
        )
      ).rows[0];
      if (!row)
        throw new AppError(409, "Connect Google from Profile → Connections");
      const token = decrypt(
        row.encrypted_tokens,
        required("TOKEN_ENCRYPTION_KEY"),
        userId + ":google",
      ) as any;
      if (token.access_token && token.expires_at > Date.now() + 60000)
        return token.access_token;
      if (!token.refresh_token)
        throw new AppError(
          401,
          "Google authorization expired; reconnect Google",
        );
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: required("GOOGLE_CLIENT_ID"),
          client_secret: required("GOOGLE_CLIENT_SECRET"),
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok)
        throw new AppError(
          401,
          "Google refresh failed; reconnect from Profile",
        );
      const refreshed = await res.json();
      const next = {
        ...token,
        ...refreshed,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };
      await db.query(
        "update google_connections set encrypted_tokens=$1,updated_at=now() where user_id=$2",
        [
          encrypt(next, required("TOKEN_ENCRYPTION_KEY"), userId + ":google"),
          userId,
        ],
      );
      return next.access_token;
    });
  }
  async invalidate(userId: string) {
    await transaction(async (db) => {
      const row = (
        await db.query(
          "select encrypted_tokens from google_connections where user_id=$1 for no key update",
          [userId],
        )
      ).rows[0];
      if (!row) return;
      const token = decrypt(
        row.encrypted_tokens,
        required("TOKEN_ENCRYPTION_KEY"),
        userId + ":google",
      ) as any;
      token.expires_at = 0;
      await db.query(
        "update google_connections set encrypted_tokens=$1 where user_id=$2",
        [
          encrypt(token, required("TOKEN_ENCRYPTION_KEY"), userId + ":google"),
          userId,
        ],
      );
    });
  }
}
export const googleTokens = new GoogleTokens();
export const google = new GoogleApi(
  googleTokens,
  config.MAX_ATTACHMENT_BYTES,
  async (uid, tool, permit, intent) => {
    if (uid !== permit.context.userId)
      throw new AppError(403, "Wrong tool owner");
    const active = await query(
      "select id from agent_runs where id=$1 and user_id=$2 and task_id=$3 and agent=$4 and status='running'",
      [permit.context.runId, uid, permit.context.taskId, permit.context.role],
    );
    if (!active.length)
      throw new AppError(403, "The authorizing agent run is no longer active");
    const a = await one(
      "select *,requested_action as manifest from approvals where id=$1 and user_id=$2",
      [permit.approvalId, uid],
    );
    const t = await one("select * from tasks where id=$1 and user_id=$2", [
      permit.context.taskId,
      uid,
    ]);
    if (t.state !== "executing")
      throw new AppError(403, "Task is not executing");
    const action = requireApproval(a, {
      userId: uid,
      dealId: t.deal_id,
      taskId: t.id,
      actionId: permit.actionId,
      role: permit.context.role,
    });
    if (action.tool !== tool)
      throw new AppError(403, "Approval does not permit this tool");
    const connection = await one(
      "select connection_id,google_email from google_connections where user_id=$1",
      [uid],
    );
    assertConnectionBinding(action, connection);
    const claim = await one(
      "select state,resource_id from approval_executions where approval_id=$1 and action_id=$2",
      [permit.approvalId, permit.actionId],
    );
    if (claim.state !== "claimed")
      throw new AppError(403, "Write attempt was not exclusively claimed");
    let parent: string | undefined;
    if (action.args.folder_action_id) {
      const folder = await one(
        "select result from approval_executions where approval_id=$1 and action_id=$2 and user_id=$3 and state='succeeded'",
        [permit.approvalId, action.args.folder_action_id, uid],
      );
      parent = folder.result.id;
    }
    assertWriteIntent(action, intent, parent, claim.resource_id);
  },
);
function cookie(req: Request, name: string) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export async function beginOAuth(
  provider: "google" | "slack",
  userId: string,
  res: Response,
) {
  const id = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await query(
    "insert into oauth_states(id,user_id,provider,verifier,expires_at) values($1,$2,$3,$4,now()+interval '10 minutes')",
    [id, userId, provider, verifier],
  );
  res.cookie("creavate_" + provider + "_state", id, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600000,
    path: "/oauth/" + provider,
  });
  let url: URL;
  if (provider === "google") {
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: googleScopes.join(" "),
      state: id,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
  } else {
    const manifest = JSON.parse(
      await readFile("docs/phase0/slack-app-manifest.json", "utf8"),
    );
    url = new URL("https://slack.com/oauth/v2/authorize");
    url.search = new URLSearchParams({
      client_id: required("SLACK_CLIENT_ID"),
      scope: manifest.oauth_config.scopes.bot.join(","),
      redirect_uri: config.SLACK_REDIRECT_URI,
      state: id,
    }).toString();
  }
  return { url: url.toString() };
}
export async function finishOAuth(
  provider: "google" | "slack",
  req: Request,
  res: Response,
) {
  const state = String(req.query.state || "");
  if (!state || cookie(req, "creavate_" + provider + "_state") !== state)
    throw new AppError(403, "OAuth state does not match this browser");
  if (req.query.error) throw new AppError(400, "Authorization was not granted");
  const code = String(req.query.code || "");
  if (!code) throw new AppError(400, "Authorization code is missing");
  const row = await transaction(async (db) => {
    const r = (
      await db.query(
        "delete from oauth_states where id=$1 and provider=$2 and expires_at>now() returning *",
        [state, provider],
      )
    ).rows[0];
    if (!r)
      throw new AppError(403, "Authorization request expired or already used");
    return r;
  });
  if (provider === "google") {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: required("GOOGLE_CLIENT_ID"),
        client_secret: required("GOOGLE_CLIENT_SECRET"),
        redirect_uri: config.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: row.verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new AppError(502, "Google authorization exchange failed");
    const tokens = await response.json();
    const scopes = String(tokens.scope || "").split(" ");
    if (!googleScopes.every((s) => scopes.includes(s)))
      throw new AppError(403, "Required Google permissions were not granted");
    const profile = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: "Bearer " + tokens.access_token },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!profile.ok)
      throw new AppError(502, "Google account verification failed");
    const info = await profile.json();
    if (!tokens.refresh_token) {
      const old = (
        await query(
          "select encrypted_tokens,google_email from google_connections where user_id=$1",
          [row.user_id],
        )
      )[0];
      if (old?.google_email === info.emailAddress)
        tokens.refresh_token = (
          decrypt(
            old.encrypted_tokens,
            required("TOKEN_ENCRYPTION_KEY"),
            row.user_id + ":google",
          ) as any
        ).refresh_token;
    }
    if (!tokens.refresh_token)
      throw new AppError(
        400,
        "Google did not grant offline access; reconnect with consent",
      );
    tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    await query(
      "insert into google_connections(user_id,encrypted_tokens,scopes,google_email) values($1,$2,$3,$4) on conflict(user_id) do update set encrypted_tokens=excluded.encrypted_tokens,scopes=excluded.scopes,google_email=excluded.google_email,connection_id=gen_random_uuid(),updated_at=now()",
      [
        row.user_id,
        encrypt(
          tokens,
          required("TOKEN_ENCRYPTION_KEY"),
          row.user_id + ":google",
        ),
        scopes,
        info.emailAddress,
      ],
    );
    await activity(row.user_id, null, "creator", "google.connected", {
      email: info.emailAddress,
      scopes,
    });
  } else {
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            required("SLACK_CLIENT_ID") + ":" + required("SLACK_CLIENT_SECRET"),
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        redirect_uri: config.SLACK_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (
      !response.ok ||
      !data.ok ||
      !data.access_token ||
      !data.authed_user?.id ||
      !data.team?.id
    )
      throw new AppError(502, "Slack authorization exchange failed");
    const person = await slackApi(data.access_token, "users.info", {
      user: data.authed_user.id,
    });
    if (
      person.user.is_bot ||
      person.user.deleted ||
      person.user.id !== data.authed_user.id
    )
      throw new AppError(403, "A human Slack identity is required");
    await transaction(async (db) => {
      await db.query(
        "insert into slack_connections(user_id,encrypted_tokens,workspace_id,slack_user_id) values($1,$2,$3,$4) on conflict(user_id) do update set encrypted_tokens=excluded.encrypted_tokens,channel_id=case when slack_connections.workspace_id=excluded.workspace_id then slack_connections.channel_id else null end,bridge_id=case when slack_connections.workspace_id=excluded.workspace_id then slack_connections.bridge_id else null end,workspace_id=excluded.workspace_id,slack_user_id=excluded.slack_user_id,updated_at=now()",
        [
          row.user_id,
          encrypt(
            { access_token: data.access_token },
            required("TOKEN_ENCRYPTION_KEY"),
            row.user_id + ":slack",
          ),
          data.team.id,
          data.authed_user.id,
        ],
      );
      await db.query(
        "update users set slack_user_id=$1,identity_verified_at=now() where id=$2",
        [data.authed_user.id, row.user_id],
      );
    });
    if (
      config.SWITCH_GATEWAY_EMAIL &&
      config.SWITCH_GATEWAY_PASSWORD &&
      config.SLACK_APP_TOKEN
    ) {
      const bridge = await new SwitchGateway(
        config.SWITCH_BASE_URL,
        config.SWITCH_GATEWAY_EMAIL,
        config.SWITCH_GATEWAY_PASSWORD,
      ).createSlackBridge({
        workspaceId: data.team.id,
        workspaceName: data.team.name,
        botToken: data.access_token,
        appToken: config.SLACK_APP_TOKEN,
      });
      await query(
        "update slack_connections set bridge_id=$1 where user_id=$2",
        [bridge.bridge_id, row.user_id],
      );
    }
    await activity(row.user_id, null, "creator", "slack.connected", {
      workspace: data.team.id,
      verified_user: data.authed_user.id,
    });
  }
  res.clearCookie("creavate_" + provider + "_state", {
    path: "/oauth/" + provider,
  });
  res.redirect(
    new URL("/?view=profile&connected=" + provider, config.WEB_URL).toString(),
  );
}
export async function slackApi(
  token: string,
  method: string,
  args: Record<string, string> = {},
) {
  const response = await fetch("https://slack.com/api/" + method, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(args),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok)
    throw new AppError(
      502,
      `Slack ${method} failed: ${body.error || response.status}`,
    );
  return body;
}
export async function slackConnection(uid: string) {
  const row = (
    await query("select * from slack_connections where user_id=$1", [uid])
  )[0];
  if (row)
    return {
      ...row,
      access_token: (
        decrypt(
          row.encrypted_tokens,
          required("TOKEN_ENCRYPTION_KEY"),
          uid + ":slack",
        ) as any
      ).access_token,
    };
  if (
    config.SLACK_BOT_TOKEN &&
    config.SLACK_WORKSPACE_ID &&
    config.SLACK_CHANNEL_ID &&
    config.CREATOR_SLACK_USER_ID
  ) {
    const user = await one("select * from users where id=$1", [uid]);
    if (
      !user.identity_verified_at ||
      user.slack_user_id !== config.CREATOR_SLACK_USER_ID
    )
      throw new AppError(409, "Link Slack in Profile before chat approvals");
    return {
      access_token: config.SLACK_BOT_TOKEN,
      workspace_id: config.SLACK_WORKSPACE_ID,
      channel_id: config.SLACK_CHANNEL_ID,
      slack_user_id: user.slack_user_id,
    };
  }
  throw new AppError(409, "Connect Slack from Profile → Connections");
}
export async function disconnectGoogle(uid: string) {
  const row = (
    await query(
      "select encrypted_tokens from google_connections where user_id=$1",
      [uid],
    )
  )[0];
  if (row) {
    const tokens = decrypt(
      row.encrypted_tokens,
      required("TOKEN_ENCRYPTION_KEY"),
      uid + ":google",
    ) as any;
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: tokens.refresh_token || tokens.access_token,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok && response.status !== 400)
      throw new AppError(502, "Google revocation could not be confirmed");
    await query("delete from google_connections where user_id=$1", [uid]);
    await activity(uid, null, "creator", "google.disconnected", {});
  }
  return { connected: false };
}
