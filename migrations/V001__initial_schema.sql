-- Context Paging — initial schema
-- Three tables: sessions, messages, pages.

CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT        NOT NULL,
    provider    TEXT,
    model       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX sessions_updated_at_idx ON sessions (updated_at DESC);

-- Messages: ordered conversation history per session.
-- content is stored as JSONB because AI SDK ModelMessage.content
-- can be either a plain string or an array of parts (tool-call, tool-result, text).
CREATE TABLE messages (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ordinal     INTEGER     NOT NULL,
    role        TEXT        NOT NULL,
    content     JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, ordinal)
);

CREATE INDEX messages_session_ordinal_idx ON messages (session_id, ordinal);

-- Pages: the agent's swap-out store.
-- page_no is per-session (the agent says "page_in 7" meaning the 7th
-- page in this session), separate from the surrogate primary key id.
-- parent_id is self-referencing for the nested page hierarchy.
CREATE TABLE pages (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    page_no     INTEGER     NOT NULL,
    parent_id   BIGINT      REFERENCES pages(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    summary     TEXT        NOT NULL DEFAULT '',
    content     TEXT        NOT NULL DEFAULT '',
    is_resident BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, page_no)
);

CREATE INDEX pages_session_idx       ON pages (session_id);
CREATE INDEX pages_parent_idx        ON pages (parent_id);
CREATE INDEX pages_session_page_idx  ON pages (session_id, page_no);
