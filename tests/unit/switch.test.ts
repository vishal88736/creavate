import { it, expect, vi, afterEach } from "vitest";
import {
  decodeSSE,
  HttpSwitchClient,
} from "../../packages/switch-adapter/src/index.js";
afterEach(() => vi.unstubAllGlobals());
it("decodes fragmented UTF-8 SSE and ignores incomplete frames", async () => {
  const bytes = new TextEncoder().encode(
    'event: message\r\nid: 7\r\ndata: {"body":"✦"}\r\n\r\ndata: {"incomplete":true}',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 2)
        c.enqueue(bytes.slice(i, i + 2));
      c.close();
    },
  });
  const frames = [];
  for await (const f of decodeSSE(stream)) frames.push(f);
  expect(frames).toEqual([{ event: "message", id: "7", data: { body: "✦" } }]);
});
it("never invents an unavailable deployed operation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ operations: {} }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  const c = new HttpSwitchClient("http://127.0.0.1:18000", "a", "TEST_KEY");
  await expect(c.operation("invented_operation", {})).rejects.toThrow(
    /does not expose/,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not publish a targeted message before a real connection is ready", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const c = new HttpSwitchClient("http://127.0.0.1:18000", "a", "TEST_KEY");
  await expect(c.mention(["other"], "request")).rejects.toThrow(/not ready/);
  expect(fetch).not.toHaveBeenCalled();
});

// These frames are isolated test fixtures for the sourced compatibility contract.
it("rejects an SSE frame whose multiline data exceeds the limit", async () => {
  const line = "data: " + "x".repeat(300000) + "\n";
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < 4; i++) c.enqueue(new TextEncoder().encode(line));
      c.close();
    },
  });
  await expect(async () => {
    for await (const _frame of decodeSSE(stream)) {
      /* no complete frame */
    }
  }).rejects.toThrow(/exceeded limit/);
});
it("establishes the sourced connection and roster before replaying a message", async () => {
  const abort = new AbortController();
  const order: string[] = [];
  const frames = [
    {
      event: "connection_state",
      data: {
        connection_id: "connection-test",
        agent_id: "agent-test",
        generation: 7,
        rooms: ["room-test"],
      },
    },
    {
      event: "message",
      id: "cursor-test",
      data: {
        type: "message",
        room_id: "room-test",
        payload: {
          addressed: true,
          sender: "opaque-transport-user",
          sender_kind: null,
          message_id: "message-test",
          body: "test",
          timestamp: 1,
        },
      },
    },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames)
        c.enqueue(
          new TextEncoder().encode(
            `event: ${f.event}\n${f.id ? "id: " + f.id + "\n" : ""}data: ${JSON.stringify(f.data)}\n\n`,
          ),
        );
      c.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/events")) return new Response(stream);
      if (path.endsWith("/ops"))
        return Response.json({
          operations: { connect_to_room: {}, list_participants: {} },
        });
      if (path.endsWith("/ops/list_participants"))
        return Response.json({
          result: [{ id: "agent-test", name: "test-agent", type: "agent" }],
        });
      return Response.json({ result: {} });
    }),
  );
  const client = new HttpSwitchClient(
    "http://127.0.0.1:18000",
    "agent-test",
    "TEST_KEY",
    {
      connectionId: "connection-test",
      onReady(participants) {
        expect(participants[0].id).toBe("agent-test");
        order.push("ready");
      },
      async saveCursor(cursor) {
        expect(cursor).toBe("cursor-test");
        order.push("cursor");
      },
    },
  );
  await client.onMessage(
    "room-test",
    async (event) => {
      expect(client.ready).toBe(true);
      expect(event.payload.sender_kind).toBeNull();
      order.push("message");
      abort.abort();
    },
    abort.signal,
  );
  expect(order).toEqual(["ready", "message", "cursor"]);
  expect(client.ready).toBe(false);
});
it("fails closed if Switch opens another connection identity", async () => {
  const state = {
    connection_id: "other-connection",
    agent_id: "agent-test",
    generation: 7,
    rooms: ["room-test"],
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        `event: connection_state\ndata: ${JSON.stringify(state)}\n\n`,
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const client = new HttpSwitchClient(
    "http://127.0.0.1:18000",
    "agent-test",
    "TEST_KEY",
    { connectionId: "expected-connection" },
  );
  await expect(
    client.onMessage("room-test", async () => {}, new AbortController().signal),
  ).rejects.toThrow(/different connection identity/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
