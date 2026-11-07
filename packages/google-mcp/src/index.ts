import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { AppError, hash, type RunContext, type Action } from "@creavate/shared";
export interface WritePermit {
  context: RunContext;
  approvalId: string;
  actionId: string;
  tool: Action["tool"];
}
export interface WriteIntent {
  resource_id?: string;
  name?: string;
  parent_id?: string | null;
  source_id?: string;
  calendar_id?: string;
  title?: string;
  due_at?: string;
  sha256?: string;
  mime_type?: string;
}
export function assertConnectionBinding(
  action: Action,
  connection: { connection_id: string; google_email: string },
) {
  if (
    action.args.google_connection_id !== connection.connection_id ||
    action.args.google_account !== connection.google_email
  )
    throw new AppError(
      403,
      "Google connection changed after approval; a new plan is required",
    );
}
export function assertWriteIntent(
  action: Action,
  intent: WriteIntent,
  parentId?: string,
  resourceId?: string,
) {
  const a = action.args;
  let expected: WriteIntent;
  if (action.tool === "drive.createFolder")
    expected = {
      resource_id: resourceId,
      name: String(a.name),
      parent_id: a.parent_id ? String(a.parent_id) : null,
    };
  else if (
    action.tool === "drive.uploadAttachment" ||
    action.tool === "drive.writeBrief"
  )
    expected = {
      resource_id: resourceId,
      name: String(a.filename || a.name),
      parent_id: parentId,
      sha256: String(a.sha256),
      mime_type: String(a.mime_type || "text/plain"),
    };
  else if (action.tool === "drive.copyFile" || action.tool === "drive.moveFile")
    expected = { source_id: String(a.file_id), parent_id: parentId };
  else if (action.tool === "calendar.createEvent")
    expected = {
      resource_id: action.id.replaceAll("-", ""),
      calendar_id: String(a.calendar_id),
      title: String(a.title),
      due_at: String(a.due_at),
    };
  else throw new AppError(403, "Not a Google write action");
  if (hash(intent) !== hash(expected))
    throw new AppError(
      403,
      "Actual Google write parameters differ from the approved action",
    );
}
export type WriteAuthorizer = (
  userId: string,
  tool: Action["tool"],
  permit: WritePermit,
  intent: WriteIntent,
) => Promise<void>;
export interface TokenSource {
  accessToken(userId: string): Promise<string>;
  invalidate(userId: string): Promise<void>;
}
export interface GmailAttachment {
  message_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
}
export class GoogleApi {
  constructor(
    private tokens: TokenSource,
    private maxBytes = 10000000,
    private authorizeWrite?: WriteAuthorizer,
  ) {}
  async #request(
    userId: string,
    url: string,
    options: {
      method?: string;
      body?: unknown;
      rawBody?: BodyInit;
      headers?: Record<string, string>;
      binary?: boolean;
      permit?: WritePermit;
      requiredTool?: Action["tool"];
      intent?: WriteIntent;
    } = {},
    refreshed = false,
    attempt = 0,
  ): Promise<any> {
    const parsed = new URL(url);
    if (
      ![
        "gmail.googleapis.com",
        "www.googleapis.com",
        "oauth2.googleapis.com",
      ].includes(parsed.hostname) ||
      parsed.protocol !== "https:"
    )
      throw new AppError(400, "Unsupported Google API origin");
    const method = (options.method || "GET").toUpperCase();
    const subscriptionRequest =
      parsed.hostname === "gmail.googleapis.com" &&
      /^\/gmail\/v1\/users\/me\/(watch|stop)$/.test(parsed.pathname) &&
      method === "POST";
    if (method !== "GET" && !subscriptionRequest) {
      if (
        !options.permit ||
        !options.requiredTool ||
        !options.intent ||
        !this.authorizeWrite
      )
        throw new AppError(
          403,
          "Google writes require an approved action capability",
        );
      await this.authorizeWrite(
        userId,
        options.requiredTool,
        options.permit,
        options.intent,
      );
    }
    const token = await this.tokens.accessToken(userId);
    if (
      options.permit &&
      options.requiredTool &&
      options.intent &&
      this.authorizeWrite
    )
      await this.authorizeWrite(
        userId,
        options.requiredTool,
        options.permit,
        options.intent,
      );
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.rawBody ? { body: options.rawBody } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 401 && !refreshed) {
      await this.tokens.invalidate(userId);
      return this.#request(userId, url, options, true, attempt);
    }
    if (
      method === "GET" &&
      attempt < 2 &&
      (res.status === 429 || res.status >= 500)
    ) {
      await res.arrayBuffer();
      const wait = Math.min(
        3000,
        Math.max(
          250,
          Number(res.headers.get("retry-after") || 0) * 1000 ||
            500 * (attempt + 1),
        ),
      );
      await new Promise((r) => setTimeout(r, wait));
      return this.#request(userId, url, options, refreshed, attempt + 1);
    }
    if (!res.ok)
      throw new AppError(
        502,
        `Google ${method} ${parsed.pathname} returned ${res.status}`,
      );
    if (res.status === 204) return { status: 204 };
    if (options.binary) {
      const size = Number(res.headers.get("content-length") || 0);
      if (size > this.maxBytes)
        throw new AppError(413, "Google file exceeds attachment limit");
      const reader = res.body!.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.maxBytes) {
          await reader.cancel();
          throw new AppError(413, "Google file exceeds attachment limit");
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
    return res.json();
  }
  async listMessages(uid: string, q: string, pageToken?: string) {
    const query = new URLSearchParams({
      q,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    return this.#request(
      uid,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?" + query,
    );
  }
  async getMessage(uid: string, id: string) {
    return this.#request(
      uid,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    );
  }
  async getThread(uid: string, id: string) {
    return this.#request(
      uid,
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`,
    );
  }
  async profile(uid: string) {
    return this.#request(
      uid,
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
  }
  async attachmentBytes(uid: string, a: GmailAttachment) {
    if (a.size > this.maxBytes)
      throw new AppError(413, "Attachment exceeds configured limit");
    const value = await this.#request(
      uid,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(a.message_id)}/attachments/${encodeURIComponent(a.attachment_id)}`,
    );
    const data = Buffer.from(value.data, "base64url");
    if (data.length > this.maxBytes)
      throw new AppError(413, "Attachment exceeds configured limit");
    return data;
  }
  async attachmentText(uid: string, a: GmailAttachment) {
    const data = await this.attachmentBytes(uid, a);
    return {
      filename: a.filename,
      mime_type: a.mime_type,
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      text: await extractText(data, a.mime_type),
    };
  }
  async search(uid: string, term: string) {
    const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return this.#request(
      uid,
      "https://www.googleapis.com/drive/v3/files?" +
        new URLSearchParams({
          q: `trashed = false and (name contains '${escaped}')`,
          pageSize: "30",
          fields: "files(id,name,mimeType,webViewLink)",
        }),
    );
  }
  async readFile(uid: string, id: string) {
    const meta = await this.file(uid, id);
    const native = String(meta.mimeType).startsWith(
      "application/vnd.google-apps.",
    );
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}` +
      (native ? "/export?mimeType=text%2Fplain" : "?alt=media");
    const bytes = await this.#request(uid, url, { binary: true });
    return {
      file: meta,
      text: await extractText(bytes, native ? "text/plain" : meta.mimeType),
    };
  }
  async file(uid: string, id: string) {
    return this.#request(
      uid,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,webViewLink,md5Checksum,appProperties`,
    );
  }
  async generateId(uid: string) {
    const value = await this.#request(
      uid,
      "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files",
    );
    if (!value.ids?.[0]) throw new Error("Google did not return a file ID");
    return String(value.ids[0]);
  }
  async createFolder(
    uid: string,
    id: string,
    name: string,
    parent: string | undefined,
    actionId: string,
    permit: WritePermit,
  ) {
    return this.#request(
      uid,
      "https://www.googleapis.com/drive/v3/files?fields=id,name,parents,webViewLink",
      {
        method: "POST",
        permit,
        requiredTool: "drive.createFolder",
        intent: { resource_id: id, name, parent_id: parent || null },
        body: {
          id,
          name,
          mimeType: "application/vnd.google-apps.folder",
          ...(parent ? { parents: [parent] } : {}),
          appProperties: { creavate_action: actionId },
        },
      },
    );
  }
  async upload(
    uid: string,
    id: string,
    name: string,
    parent: string,
    mime: string,
    data: Buffer,
    actionId: string,
    permit: WritePermit,
  ) {
    if (!/^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(mime))
      throw new AppError(400, "Invalid attachment MIME type");
    const boundary =
      "creavate_" + createHash("sha256").update(id).digest("hex");
    const metadata = JSON.stringify({
      id,
      name,
      parents: [parent],
      appProperties: { creavate_action: actionId },
    });
    const bytes = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return this.#request(
      uid,
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,webViewLink,md5Checksum",
      {
        method: "POST",
        permit,
        requiredTool:
          permit.tool === "drive.writeBrief"
            ? "drive.writeBrief"
            : "drive.uploadAttachment",
        intent: {
          resource_id: id,
          name,
          parent_id: parent,
          sha256: createHash("sha256").update(data).digest("hex"),
          mime_type: mime,
        },
        rawBody: bytes,
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      },
    );
  }
  async copy(
    uid: string,
    id: string,
    parent: string,
    actionId: string,
    permit: WritePermit,
  ) {
    return this.#request(
      uid,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/copy?fields=id,name,parents,webViewLink`,
      {
        method: "POST",
        permit,
        requiredTool: "drive.copyFile",
        intent: { source_id: id, parent_id: parent },
        body: {
          parents: [parent],
          appProperties: { creavate_action: actionId },
        },
      },
    );
  }
  async move(uid: string, id: string, parent: string, permit: WritePermit) {
    const original = await this.file(uid, id);
    const query = new URLSearchParams({
      addParents: parent,
      fields: "id,name,parents,webViewLink",
      ...(original.parents?.length
        ? {
            removeParents: original.parents
              .filter((p: string) => p !== parent)
              .join(","),
          }
        : {}),
    });
    return this.#request(
      uid,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?` +
        query,
      {
        method: "PATCH",
        permit,
        requiredTool: "drive.moveFile",
        intent: { source_id: id, parent_id: parent },
        body: {},
      },
    );
  }
  async event(uid: string, calendar: string, id: string) {
    return this.#request(
      uid,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events/${id}`,
    );
  }
  async createEvent(
    uid: string,
    calendar: string,
    id: string,
    title: string,
    dueAt: string,
    actionId: string,
    permit: WritePermit,
  ) {
    const end = new Date(new Date(dueAt).getTime() + 15 * 60000).toISOString();
    return this.#request(
      uid,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events`,
      {
        method: "POST",
        permit,
        requiredTool: "calendar.createEvent",
        intent: {
          resource_id: id,
          calendar_id: calendar,
          title,
          due_at: dueAt,
        },
        body: {
          id,
          summary: title,
          start: { dateTime: dueAt },
          end: { dateTime: end },
          reminders: {
            useDefault: false,
            overrides: [
              { method: "popup", minutes: 1440 },
              { method: "popup", minutes: 60 },
            ],
          },
          extendedProperties: { private: { creavate_action: actionId } },
        },
      },
    );
  }
  async watch(uid: string, topic: string) {
    return this.#request(
      uid,
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        body: {
          topicName: topic,
          labelIds: ["INBOX"],
          labelFilterBehavior: "include",
        },
      },
    );
  }
  async stopWatch(uid: string) {
    return this.#request(
      uid,
      "https://gmail.googleapis.com/gmail/v1/users/me/stop",
      { method: "POST" },
    );
  }
}
export async function extractText(data: Buffer, mime: string): Promise<string> {
  if (mime === "application/pdf") {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=128",
          fileURLToPath(new URL("./pdf-worker.mjs", import.meta.url)),
        ],
        { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "",
        settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new AppError(413, "PDF parsing exceeded the time limit"));
      }, 12000);
      function finish(error?: Error, text?: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(text || "");
      }
      child.on("error", () =>
        finish(new AppError(502, "PDF parser could not start")),
      );
      child.stdout.on("data", (b) => {
        output += b.toString();
        if (output.length > 1000000) {
          child.kill("SIGKILL");
          finish(new AppError(413, "PDF text exceeded limit"));
        }
      });
      child.stderr.resume();
      child.on("exit", (code) => {
        try {
          const result = JSON.parse(output);
          if (code !== 0 || result.error) throw new Error();
          finish(
            undefined,
            result.text +
              (result.truncated
                ? "\n[Text truncated at the configured limit]"
                : ""),
          );
        } catch {
          finish(
            new AppError(
              422,
              "PDF could not be parsed within the supported limits",
            ),
          );
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ data: data.toString("base64") }));
    });
  }
  if (mime.startsWith("text/") || mime === "application/json")
    return data
      .toString("utf8")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 150000);
  return `[Binary ${mime} attachment; ${data.length} bytes. No text was extracted.]`;
}
export function parseGmailMessage(raw: any) {
  const headers = raw.payload?.headers || [];
  const header = (name: string) =>
    headers.find((x: any) => x.name.toLowerCase() === name)?.value || "";
  const attachments: GmailAttachment[] = [];
  const texts: string[] = [];
  function walk(part: any) {
    if (part.filename && part.body?.attachmentId)
      attachments.push({
        message_id: raw.id,
        attachment_id: part.body.attachmentId,
        filename: part.filename,
        mime_type: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
      });
    if (part.body?.data && ["text/plain", "text/html"].includes(part.mimeType))
      texts.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    for (const p of part.parts || []) walk(p);
  }
  walk(raw.payload || {});
  return {
    gmail_id: String(raw.id),
    thread_id: String(raw.threadId),
    sender: header("from"),
    subject: header("subject"),
    body: texts
      .join("\n")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 300000),
    attachments,
    received_at: new Date(Number(raw.internalDate)).toISOString(),
  };
}
export interface ActionExecutor {
  execute(
    ctx: RunContext,
    approvalId: string,
    action: Action,
  ): Promise<unknown>;
}
