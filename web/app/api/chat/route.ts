import { getSessionWithMessages, replaceMessages } from "@/lib/sessions";
import { runAgent } from "@agent/agent";
import { withSession } from "@agent/storage";
import { resolveModel } from "@agent/providers";
import { buildContextView } from "@/lib/context-view";
import { getPageTable } from "@/lib/page-table";

export const runtime = "nodejs";

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

  const session = await getSessionWithMessages(body.sessionId);
  if (!session) return badRequest("session not found", 404);

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

        await replaceMessages(session.id, finalMessages);

        const pageTable = await withSession(session.id, () => getPageTable());
        send("context", { context: buildContextView(finalMessages), pageTable });
        send("done", { ok: true });
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
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
