"use client";

import { useEffect, useState } from "react";
import {
  EMPTY_CONFIG,
  PROVIDER_OPTIONS,
  type LlmConfig,
  loadConfig,
  saveConfig,
  clearConfig,
} from "@/lib/llm-config";

interface Props {
  open: boolean;
  onClose: () => void;
  onChange: (config: LlmConfig) => void;
}

export default function SettingsModal({ open, onClose, onChange }: Props) {
  const [draft, setDraft] = useState<LlmConfig>(EMPTY_CONFIG);

  useEffect(() => {
    if (open) setDraft(loadConfig());
  }, [open]);

  if (!open) return null;

  function save() {
    saveConfig(draft);
    onChange(draft);
    onClose();
  }

  function reset() {
    clearConfig();
    setDraft(EMPTY_CONFIG);
    onChange(EMPTY_CONFIG);
  }

  return (
    <div className="modal-backdrop" data-testid="settings-modal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>LLM settings</h2>
        <p className="help">
          Stored in this browser only (localStorage). Sent with every chat request. Leave blank to
          use the server&apos;s <code>.env</code> values.
        </p>

        <label>
          Provider
          <select
            value={draft.provider}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
            data-testid="settings-provider"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Model
          <input
            type="text"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="(provider default)"
            data-testid="settings-model"
          />
        </label>

        <label>
          API key
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="(use server env)"
            autoComplete="off"
            spellCheck={false}
            data-testid="settings-apikey"
          />
        </label>

        <div className="actions">
          <button onClick={reset} className="ghost" data-testid="settings-reset">
            Clear
          </button>
          <button onClick={onClose} className="ghost">
            Cancel
          </button>
          <button onClick={save} className="primary" data-testid="settings-save">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
