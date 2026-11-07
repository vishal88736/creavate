// Wire contract verified against sandbox-quantum/switch 0d2a57ce643a57a56cd955f6a80324327558f0dd.
// This module is the sole boundary for Switch protocol and Gateway details.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@creavate/shared";
const ConnectionStateSchema = z.object({
  connection_id: z.string(),
  agent_id: z.string(),
  generation: z.number().int().nonnegative(),
  rooms: z.array(z.string()),
});
const EventSchema = z.object({
  type: z.literal("message"),
  room_id: z.string(),
  payload: z.object({
    addressed: z.boolean(),
    sender: z.string(),
    sender_kind: z.string().nullable().optional(),
    message_id: z.string(),
    body: z.string(),
    timestamp: z.number(),
  }),
});
export type RoomMessage = z.infer<typeof EventSchema>;
export interface Participant {
  id: string;
  name: string;
  type: "agent" | "user";
}
export interface SwitchClient {
  registerAgent(
    name: string,
    registrationKey: string,
  ): Promise<{ id: string; api_key: string }>;
  joinRoom(roomId: string): Promise<unknown>;
  postMessage(
    roomId: string,
    content: string,
  ): Promise<{ ok: boolean; event_id: string }>;
  mention(names: string[], body: string): Promise<any>;
  onMessage(
    roomId: string,
    handler: (event: RoomMessage) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  readHistory(roomId: string): Promise<{
    events: {
      sender: string;
      sender_name: string;
      body: string;
      timestamp: string;
    }[];
    has_more: boolean;
  }>;
  participants(): Promise<Participant[]>;
}
export async function* decodeSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    event = "message",
    data: string[] = [],
    id: string | undefined,
    frameSize = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 1048576)
        throw new Error("Switch event exceeded limit");
      let n: number;
      while ((n = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, n).replace(/\r$/, "");
        buffer = buffer.slice(n + 1);
        frameSize += line.length;
        if (frameSize > 1048576) throw new Error("Switch event exceeded limit");
        if (line === "") {
          if (data.length)
            yield { event, id, data: JSON.parse(data.join("\n")) };
          event = "message";
          data = [];
          id = undefined;
          frameSize = 0;
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export class HttpSwitchClient implements SwitchClient {
  readonly connectionId: string;
  private generation: number | undefined;
  private roomId?: string;
  private connected = false;
  constructor(
    private baseUrl: string,
    readonly agentId: string,
    private key: string,
    private options: {
      connectionId?: string;
      cursor?: string;
      saveCursor?: (cursor: string) => Promise<void>;
      onReady?: (participants: Participant[]) => Promise<void> | void;
    } = {},
  ) {
    this.connectionId = options.connectionId || randomUUID();
    const u = new URL(baseUrl);
    if (
      u.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
      throw new AppError(400, "Switch requires HTTPS or loopback");
  }
  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    key = this.key,
  ) {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Switch-Connection-Id": this.connectionId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok)
      throw new AppError(
        502,
        `Switch ${method} ${path.split("?")[0]} returned ${res.status}`,
      );
    return res.json();
  }
  async registerAgent(name: string, registrationKey: string) {
    return z.object({ id: z.string(), api_key: z.string() }).parse(
      await this.request(
        "/agents",
        "POST",
        {
          name,
          description: "Creavate " + name,
          connector_type: "creavate-opencode",
          integration_profile: {
            connection_model: "always_on",
            message_exchange: true,
            pre_invocation_mediation: [],
            post_invocation_mediation: [],
            event_reporting: [],
          },
          tools: [],
          models: [],
          metadata: {},
          overwrite: false,
        },
        registrationKey,
      ),
    );
  }
  async operation(name: string, args: unknown) {
    const catalog = await this.request(`/agents/${this.agentId}/ops`);
    if (!catalog.operations?.[name])
      throw new AppError(
        502,
        `Deployed Switch does not expose ${name}; review its protocol`,
      );
    const result = await this.request(
      `/agents/${this.agentId}/ops/${name}`,
      "POST",
      args,
    );
    return result.result;
  }
  async joinRoom(roomId: string) {
    this.roomId = roomId;
    return this.operation("connect_to_room", {
      room_id: roomId,
      include_general_instructions: false,
    });
  }
  async postMessage(roomId: string, content: string) {
    return z.object({ ok: z.literal(true), event_id: z.string() }).parse(
      await this.request(`/agents/${this.agentId}/message`, "POST", {
        room_id: roomId,
        content,
      }),
    );
  }
  async mention(names: string[], body: string) {
    if (!this.connected)
      throw new AppError(503, "Switch connection is not ready");
    return this.operation("send_targeted_message", {
      body,
      target_names: names,
    });
  }
  async participants(): Promise<Participant[]> {
    return z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum(["agent", "user"]),
        }),
      )
      .parse(await this.operation("list_participants", {}));
  }
  async readHistory(roomId: string) {
    return z
      .object({
        events: z.array(
          z.object({
            sender: z.string(),
            sender_name: z.string(),
            body: z.string(),
            timestamp: z.string(),
          }),
        ),
        has_more: z.boolean(),
      })
      .parse(
        await this.request(
          `/agents/${this.agentId}/rooms/${roomId}/history?limit=100`,
        ),
      );
  }
  async onMessage(
    roomId: string,
    handler: (event: RoomMessage) => Promise<void>,
    signal: AbortSignal,
  ) {
    this.roomId = roomId;
    const u = new URL(`/agents/${this.agentId}/events`, this.baseUrl);
    u.search = new URLSearchParams({
      connection_id: this.connectionId,
      scope: "single",
      filter: "all",
      start_from: "head",
      rooms: roomId,
    }).toString();
    const res = await fetch(u, {
      headers: {
        Authorization: `Bearer ${this.key}`,
        Accept: "text/event-stream",
        ...(this.options.cursor
          ? { "Last-Event-ID": this.options.cursor }
          : {}),
      },
      signal,
    });
    if (!res.ok || !res.body)
      throw new AppError(502, `Switch SSE returned ${res.status}`);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let beatError: Error | undefined;
    try {
      for await (const frame of decodeSSE(res.body)) {
        if (signal.aborted) break;
        if (beatError) throw beatError;
        if (["gap", "evicted", "room_released"].includes(frame.event))
          throw new AppError(
            502,
            `Switch connection ${frame.event}; stop and reconcile history before restart`,
          );
        if (frame.event === "connection_state") {
          const state = ConnectionStateSchema.parse(frame.data);
          if (
            state.connection_id !== this.connectionId ||
            state.agent_id !== this.agentId
          )
            throw new Error("Switch returned a different connection identity");
          if (!state.rooms.includes(roomId))
            throw new Error("Switch did not claim the configured room");
          this.generation = state.generation;
          await this.request(
            `/agents/${this.agentId}/connection/beat`,
            "POST",
            { connection_id: this.connectionId, generation: this.generation },
          );
          heartbeat = setInterval(() => {
            void this.request(
              `/agents/${this.agentId}/connection/beat`,
              "POST",
              { connection_id: this.connectionId, generation: this.generation },
            ).catch((e) => {
              beatError = e;
            });
          }, 2000);
          await this.joinRoom(roomId);
          await this.options.onReady?.(await this.participants());
          this.connected = true;
        }
        if (frame.event === "message") {
          const event = EventSchema.parse(frame.data);
          if (event.room_id === roomId) await handler(event);
          if (frame.id) await this.options.saveCursor?.(frame.id);
        }
      }
      if (!signal.aborted)
        throw new AppError(
          502,
          "Switch stream ended; restart requires history reconciliation",
        );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.connected = false;
    }
  }
  get ready() {
    return this.connected;
  }
}
async function gatewayRequest(
  base: string,
  email: string,
  password: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const auth = await fetch(new URL("/gateway/auth/login", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10000),
  });
  if (!auth.ok) throw new AppError(502, "Switch Gateway authentication failed");
  const cookie = auth.headers.get("set-cookie")?.split(";")[0];
  if (!cookie)
    throw new AppError(502, "Switch Gateway did not issue a session");
  const res = await fetch(new URL("/gateway" + path, base), {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new AppError(502, `Switch Gateway ${path} returned ${res.status}`);
  return res.json();
}

/** Gateway request shapes verified against the pinned Gateway schemas/routes. */
export class SwitchGateway {
  constructor(
    private base: string,
    private email: string,
    private password: string,
  ) {}
  private request(path: string, method = "GET", body?: unknown) {
    return gatewayRequest(
      this.base,
      this.email,
      this.password,
      path,
      method,
      body,
    );
  }
  listRooms(): Promise<
    { id: string; external_channel_id: string; bridge_id: string }[]
  > {
    return this.request("/rooms");
  }
  getRoom(
    id: string,
  ): Promise<{ id: string; external_channel_id: string; bridge_id: string }> {
    return this.request("/rooms/" + encodeURIComponent(id));
  }
  adoptChannel(input: {
    name: string;
    description: string;
    bridgeId: string;
    channelId: string;
    agentIds: string[];
  }): Promise<{ id: string }> {
    return this.request("/rooms", "POST", {
      name: input.name,
      description: input.description,
      bridge_id: input.bridgeId,
      external_channel_id: input.channelId,
      agent_ids: input.agentIds,
    });
  }
  addRoomAgents(roomId: string, agentIds: string[]) {
    return this.request(
      "/rooms/" + encodeURIComponent(roomId) + "/agents",
      "POST",
      { agent_ids: agentIds },
    );
  }
  createSlackBridge(input: {
    workspaceId: string;
    workspaceName: string;
    botToken: string;
    appToken: string;
  }): Promise<{ bridge_id: string }> {
    return this.request("/collaborations", "POST", {
      bridge_type: "slack",
      display_name: "Creavate " + input.workspaceName,
      connection_config: {
        bot_token: input.botToken,
        app_token: input.appToken,
        workspace_id: input.workspaceId,
        agent_usergroups: false,
      },
      channel_creation_enabled: false,
    });
  }
}
