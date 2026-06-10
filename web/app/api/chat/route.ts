import { getSession, pagesRootFor, updateMessages } from "@/lib/sessions";
import { runAgent } from "@agent/agent";
import { withPagesRoot } from "@agent/storage";
import { resolveModel } from "@agent/providers";
import { buildContextView } from "@/lib/context-view";
import { getPageTable } from "@/lib/page-table";

export const runtime = "nodejs";

interface ChatRequest {
  sessionId: string;
  message: string;
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

  const session = getSession(body.sessionId);
  if (!session) return badRequest("session not found", 404);

  const pagesRoot = pagesRootFor(session.id);
  const userMessage = body.message.trim();
  const initialMessages = [...session.messages, { role: "user" as const, content: userMessage }];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const model = await resolveModel();

        const finalMessages = await withPagesRoot(pagesRoot, async () => {
          const result = await runAgent(initialMessages, {
            model,
            onText: (chunk) => send("text", { chunk }),
            onToolCall: (toolName, args) => send("tool-call", { toolName, args }),
            onToolResult: (toolName, output) => send("tool-result", { toolName, output }),
          });
          return result.messages;
        });

        updateMessages(session.id, finalMessages);

        const pageTable = await withPagesRoot(pagesRoot, () => getPageTable());
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
