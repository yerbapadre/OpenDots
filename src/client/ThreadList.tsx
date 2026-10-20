import { useThreads } from '@copilotkit/react-core/v2';
import { MessageCircle, Plus, Pencil, Trash2 } from 'lucide-react';
import type { Conversation, Dot } from '../shared/types';
export function ThreadList({
  dots,
  dotId,
  local,
  selected,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  dots: Dot[];
  dotId: string;
  local: Conversation[];
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename?: (id: string, currentTitle: string) => void;
  onDelete?: (id: string, currentTitle: string) => void;
}) {
  const threads = useThreads({
    agentId: dotId,
    enabled: true,
    includeArchived: false,
    limit: 20,
  });
  return (
    <section className="thread-list">
      <div className="nav-label">
        RECENT CHATS
        <button
          className="icon-button"
          onClick={onNew}
          aria-label="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>
      {threads.error && (
        <p className="sidebar-error">
          Conversation sync unavailable. Check your runtime connection.
        </p>
      )}
      {local.map((thread) => {
        const remote = threads.threads.find((item) => item.id === thread.id);
        const title = remote?.name || thread.title;
        const dotName = dots.find((dot) => dot.id === thread.dotId)?.name;
        return (
          <div
            key={thread.id}
            className={`nav-item thread-row ${selected === thread.id ? 'active' : ''}`}
          >
            <button
              className="thread-open"
              onClick={() => onSelect(thread.id)}
            >
              <MessageCircle size={15} />
              <span className="thread-summary">
                <span>{title}</span>
                <small>{dotName}</small>
              </span>
            </button>
            <span className="thread-actions">
              {onRename && (
                <button
                  className="icon-button"
                  aria-label="Rename conversation"
                  title="Rename"
                  onClick={() => onRename(thread.id, title)}
                >
                  <Pencil size={13} />
                </button>
              )}
              {onDelete && (
                <button
                  className="icon-button"
                  aria-label="Delete conversation"
                  title="Delete"
                  onClick={() => onDelete(thread.id, title)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
          </div>
        );
      })}
      {!local.length && (
        <p className="sidebar-empty">Your first conversation will live here.</p>
      )}
      {threads.hasMoreThreads && (
        <button
          className="text-button"
          disabled={threads.isFetchingMoreThreads}
          onClick={() => void threads.fetchMoreThreads()}
        >
          Load more conversations
        </button>
      )}
    </section>
  );
}
