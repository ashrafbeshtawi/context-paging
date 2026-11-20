import {
  getSessionWithMessages,
  replaceMessages,
  sessionVersion,
  SessionConflictError,
} from "@/lib/sessions";
import type { SessionWithMessages } from "@agent/types";
import { runAgent } from "@agent/agent";
import { withSession } from "@agent/storage";
import { resolveModel } from "@agent/providers";
import { buildContextView } from "@/lib/context-view";
import { getPageTable } from "@/lib/page-table";

export const runtime = "nodejs";

const CONFLICT_MESSAGE =
  "This chat was changed by another turn. Reload the session to see the latest messages.";

// Session ids with a turn in progress in this server process.
const activeTurns = new Set<string>();

interface ChatRequest {
  sessionId: string;
  message: string;
  apiKey?: string;
  provider?: string;
  model?: string;
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return badRequest("invalid JSON body");
  }
  if (!body.sessionId || !body.message?.trim()) {
    return badRequest("sessionId and message are required");
  }

  // One turn per session at a time in this process. A second POST while a
  // turn is running (double submit, second tab, retry) gets a 409 up front
  // instead of running the agent and overwriting the first turn.
  if (activeTurns.has(body.sessionId)) {
    return badRequest(CONFLICT_MESSAGE, 409);
  }
  activeTurns.add(body.sessionId);
  let handedOff = false;

  try {
    const session = await getSessionWithMessages(body.sessionId);
    if (!session) return badRequest("session not found", 404);

    const response = streamTurn(body, session);
    handedOff = true;
    return response;
  } finally {
    if (!handedOff) activeTurns.delete(body.sessionId);
  }
}

function streamTurn(body: ChatRequest, session: SessionWithMessages): Response {
  const expected = sessionVersion(session);
  const userMessage = body.message.trim();
  const initialMessages = [...session.messages, { role: "user" as const, content: userMessage }];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const model = await resolveModel({
          provider: body.provider,
          model: body.model,
          apiKey: body.apiKey,
        });

        const finalMessages = await withSession(session.id, async () => {
          const result = await runAgent(initialMessages, {
            model,
            onText: (chunk) => send("text", { chunk }),
            onToolCall: (toolName, args) => send("tool-call", { toolName, args }),
            onToolResult: (toolName, output) => send("tool-result", { toolName, output }),
          });
          return result.messages;
        });

        // Refused if another writer (e.g. another server process) changed the
        // session since this turn read it. The stream is already open, so the
        // 409 travels in the error event rather than the HTTP status.
        await replaceMessages(session.id, finalMessages, { expected });

        const pageTable = await withSession(session.id, () => getPageTable());
        send("context", { context: buildContextView(finalMessages), pageTable });
        send("done", { ok: true });
      } catch (err) {
        if (err instanceof SessionConflictError) {
          send("error", { message: CONFLICT_MESSAGE, status: 409 });
        } else {
          send("error", { message: (err as Error).message });
        }
      } finally {
        activeTurns.delete(session.id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function badRequest(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
