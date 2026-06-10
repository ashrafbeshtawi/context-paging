import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionsSidebar from "@/components/SessionsSidebar";
import ContextSidebar from "@/components/ContextSidebar";
import ChatPanel from "@/components/ChatPanel";
import SettingsModal from "@/components/SettingsModal";

const sampleSessions = [
  { id: "a", title: "First", provider: null, model: null, createdAt: new Date(1), updatedAt: new Date(2), messageCount: 3 },
  { id: "b", title: "Second", provider: null, model: null, createdAt: new Date(1), updatedAt: new Date(3), messageCount: 0 },
];

describe("SessionsSidebar", () => {
  it("renders the empty state when no sessions exist", () => {
    render(<SessionsSidebar sessions={[]} activeId={null} onSelect={() => {}} onCreate={() => {}} />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });

  it("renders sessions and fires onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(
      <SessionsSidebar sessions={sampleSessions} activeId="a" onSelect={onSelect} onCreate={() => {}} />
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("session-b"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("fires onCreate when the new-session button is clicked", () => {
    const onCreate = vi.fn();
    render(<SessionsSidebar sessions={[]} activeId={null} onSelect={() => {}} onCreate={onCreate} />);
    fireEvent.click(screen.getByTestId("new-session"));
    expect(onCreate).toHaveBeenCalled();
  });

  it("renders the settings button when onOpenSettings is provided", () => {
    const onOpenSettings = vi.fn();
    render(
      <SessionsSidebar
        sessions={[]}
        activeId={null}
        onSelect={() => {}}
        onCreate={() => {}}
        onOpenSettings={onOpenSettings}
        settingsBadge="env"
      />
    );
    const btn = screen.getByTestId("open-settings");
    fireEvent.click(btn);
    expect(onOpenSettings).toHaveBeenCalled();
    expect(btn.textContent).toContain("env");
  });

  it("hides the settings button when onOpenSettings is not provided", () => {
    render(<SessionsSidebar sessions={[]} activeId={null} onSelect={() => {}} onCreate={() => {}} />);
    expect(screen.queryByTestId("open-settings")).toBeNull();
  });
});

describe("ContextSidebar", () => {
  it("renders an empty state when no context is present", () => {
    render(<ContextSidebar context={null} pageTable={[]} />);
    expect(screen.getByText("No active session")).toBeInTheDocument();
    expect(screen.getByText("No pages stored")).toBeInTheDocument();
  });

  it("renders stats and message previews", () => {
    render(
      <ContextSidebar
        context={{
          totals: { messages: 2, chars: 42, pageRefs: 1 },
          messages: [
            { index: 0, role: "user", kind: "text", preview: "hi", chars: 2 },
            {
              index: 1,
              role: "assistant",
              kind: "paged-out-ref",
              preview: '[Paged out → Page 1: "x" — y]',
              chars: 30,
              pageRef: { id: 1, title: "x", summary: "y" },
            },
          ],
        }}
        pageTable={[
          { id: 1, title: "Auth", summary: "JWT bug", isResident: false, depth: 0, children: [] },
        ]}
      />
    );
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/Page 1: Auth/)).toBeInTheDocument();
    expect(screen.getByText("JWT bug")).toBeInTheDocument();
    expect(screen.getByTestId("page-1").className).toMatch(/swapped/);
  });

  it("marks resident pages distinctly", () => {
    render(
      <ContextSidebar
        context={null}
        pageTable={[
          { id: 4, title: "Loaded", summary: "", isResident: true, depth: 0, children: [] },
        ]}
      />
    );
    expect(screen.getByTestId("page-4").className).toMatch(/resident/);
  });
});

describe("ChatPanel", () => {
  it("disables send when input is empty", () => {
    render(<ChatPanel turns={[]} onSend={() => {}} disabled={false} />);
    expect(screen.getByTestId("send")).toBeDisabled();
  });

  it("calls onSend with the trimmed message on Enter", () => {
    const onSend = vi.fn();
    render(<ChatPanel turns={[]} onSend={onSend} disabled={false} />);
    const input = screen.getByTestId("chat-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "  hello  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<ChatPanel turns={[]} onSend={onSend} disabled={false} />);
    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders user message, tool events, and assistant text for a turn", () => {
    render(
      <ChatPanel
        turns={[
          {
            id: "t1",
            user: "Hi there",
            assistant: "Hello back",
            events: [
              { kind: "call", name: "page_table", payload: {} },
              { kind: "result", name: "page_table", payload: { result: "empty" } },
            ],
            pending: false,
          },
        ]}
        onSend={() => {}}
        disabled={false}
      />
    );
    expect(screen.getByText("Hi there")).toBeInTheDocument();
    expect(screen.getByText("Hello back")).toBeInTheDocument();
    expect(screen.getByText(/→ tool call/)).toBeInTheDocument();
    expect(screen.getByText(/← tool result/)).toBeInTheDocument();
  });
});

describe("SettingsModal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <SettingsModal open={false} onClose={() => {}} onChange={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("save persists to localStorage and calls onChange + onClose", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal open onClose={onClose} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("settings-apikey"), { target: { value: "sk-abc" } });
    fireEvent.change(screen.getByTestId("settings-provider"), { target: { value: "openai" } });
    fireEvent.change(screen.getByTestId("settings-model"), { target: { value: "gpt-4o-mini" } });
    fireEvent.click(screen.getByTestId("settings-save"));

    expect(onChange).toHaveBeenCalledWith({
      apiKey: "sk-abc",
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(onClose).toHaveBeenCalled();
    expect(window.localStorage.getItem("context-paging.llm-config")).toBeTruthy();
  });

  it("clear button wipes localStorage and resets the form", () => {
    window.localStorage.setItem(
      "context-paging.llm-config",
      JSON.stringify({ apiKey: "k", provider: "openai", model: "gpt-4o" })
    );
    const onChange = vi.fn();
    render(<SettingsModal open onClose={() => {}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("settings-reset"));
    expect(window.localStorage.getItem("context-paging.llm-config")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ apiKey: "", provider: "", model: "" });
  });
});
