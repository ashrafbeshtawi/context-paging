import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Home from "@/app/page";
import type { ContextView } from "@/lib/context-view";
import type { PageTableEntry } from "@/lib/page-table";

const sessions = [
  { id: "a", title: "Alpha", provider: null, model: null, createdAt: 1, updatedAt: 2, messageCount: 0 },
  { id: "b", title: "Beta", provider: null, model: null, createdAt: 1, updatedAt: 3, messageCount: 0 },
];

function ctx(chars: number): ContextView {
  return { totals: { messages: 1, chars, pageRefs: 0 }, messages: [] };
}

function page(id: number, title: string): PageTableEntry {
  return { id, title, summary: "", isResident: false, depth: 0, children: [] };
}

const sessionData: Record<string, { context: ContextView; pageTable: PageTableEntry[] }> = {
  a: { context: ctx(111), pageTable: [page(1, "Alpha page")] },
  b: { context: ctx(222), pageTable: [page(2, "Beta page")] },
};

const encoder = new TextEncoder();
let chat: ReadableStreamDefaultController<Uint8Array>;
let fetchMock: ReturnType<typeof vi.fn>;

function emit(event: string, data: unknown) {
  chat.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function json(data: unknown) {
  return { ok: true, json: async () => data };
}

function sessionListCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/sessions").length;
}

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/sessions") return json({ sessions });
    if (url === "/api/chat") {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          chat = c;
        },
      });
      return { ok: true, body };
    }
    const id = url.replace("/api/sessions/", "");
    return json(sessionData[id]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSession(id: string, expectedChars: number) {
  fireEvent.click(await screen.findByTestId(`session-${id}`));
  await screen.findByText(String(expectedChars));
}

async function sendMessage(text: string) {
  const input = screen.getByTestId("chat-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.getByTestId("chat-input")).toBeDisabled());
}

describe("Home page streaming", () => {
  it("applies a running turn's events to the session it was sent from", async () => {
    render(<Home />);
    await openSession("a", 111);
    await sendMessage("hello");

    const before = sessionListCalls();
    await act(async () => {
      emit("text", { chunk: "fresh reply" });
      emit("context", { context: ctx(999), pageTable: [page(9, "New page")] });
      emit("done", { ok: true });
      chat.close();
    });

    await screen.findByText("999");
    expect(screen.getByText("fresh reply")).toBeInTheDocument();
    expect(screen.getByText(/Page 9: New page/)).toBeInTheDocument();
    await waitFor(() => expect(sessionListCalls()).toBeGreaterThan(before));
    expect(screen.getByTestId("chat-input")).not.toBeDisabled();
  });

  it("ignores a stale stream after switching sessions and unlocks the new session", async () => {
    render(<Home />);
    await openSession("a", 111);
    await sendMessage("hello");

    await openSession("b", 222);
    // The old turn is still running, but the new session's input is usable.
    expect(screen.getByTestId("chat-input")).not.toBeDisabled();

    const before = sessionListCalls();
    await act(async () => {
      emit("text", { chunk: "stale reply" });
      emit("tool-call", { toolName: "page_table", args: {} });
      emit("context", { context: ctx(999), pageTable: [page(9, "Stale page")] });
      emit("done", { ok: true });
      chat.close();
    });
    // The stream has been fully consumed once the session list is refreshed.
    await waitFor(() => expect(sessionListCalls()).toBeGreaterThan(before));

    expect(screen.getByText("222")).toBeInTheDocument();
    expect(screen.getByText(/Page 2: Beta page/)).toBeInTheDocument();
    expect(screen.queryByText("999")).toBeNull();
    expect(screen.queryByText(/Stale page/)).toBeNull();
    expect(screen.queryByText("stale reply")).toBeNull();
    expect(screen.queryByText(/tool call/)).toBeNull();
    expect(screen.getByTestId("chat-input")).not.toBeDisabled();
  });

  it("keeps the input locked when switching back to the session that is still streaming", async () => {
    render(<Home />);
    await openSession("a", 111);
    await sendMessage("hello");

    await openSession("b", 222);
    expect(screen.getByTestId("chat-input")).not.toBeDisabled();
    await openSession("a", 111);
    expect(screen.getByTestId("chat-input")).toBeDisabled();

    await act(async () => {
      emit("done", { ok: true });
      chat.close();
    });
    await waitFor(() => expect(screen.getByTestId("chat-input")).not.toBeDisabled());
  });
});
