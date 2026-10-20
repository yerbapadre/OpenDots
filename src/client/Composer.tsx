import type { ReactNode } from 'react';
import { ArrowUp, Link2, Square, X } from 'lucide-react';
import { submitComposerOnEnter } from './chat-composer';

export interface ComposerSource {
  open: boolean;
  onToggle: () => void;
  value: string;
  onChange: (value: string) => void;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Accessible label for the textarea. */
  textareaLabel: string;
  /** Whether a submit is currently allowed — gates Enter-to-send and the send button. */
  canSubmit: boolean;
  /** Disables the textarea itself (e.g. before setup is complete). */
  disabled?: boolean;
  /** Accessible label for the send button. */
  sendLabel: string;
  /** Helper caption shown at the bottom-left. */
  note?: ReactNode;
  /** Optional leading icon for the caption. */
  noteIcon?: ReactNode;
  /** When true, the send button becomes a Stop button wired to onStop. */
  running?: boolean;
  onStop?: () => void;
  /** Enables the source-page-link toggle + URL input (live chat only). */
  source?: ComposerSource;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  textareaLabel,
  canSubmit,
  disabled = false,
  sendLabel,
  note,
  noteIcon,
  running = false,
  onStop,
  source,
}: ComposerProps) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {source?.open && (
        <div className="source-input">
          <Link2 size={15} />
          <input
            aria-label="Source page URL"
            type="url"
            value={source.value}
            onChange={(e) => source.onChange(e.target.value)}
            placeholder="https://example.com/page"
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Remove source"
            onClick={() => {
              source.onToggle();
              source.onChange('');
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <textarea
        aria-label={textareaLabel}
        placeholder={placeholder}
        value={value}
        maxLength={4000}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => submitComposerOnEnter(e, canSubmit)}
      />
      <div className="composer-bottom">
        <span>
          {source && (
            <button
              type="button"
              className="icon-button"
              aria-label="Add source page link"
              onClick={source.onToggle}
            >
              <Link2 size={15} />
            </button>
          )}
          {noteIcon}
          {note}
        </span>
        {running ? (
          <button
            type="button"
            className="send-button"
            aria-label="Stop response"
            onClick={onStop}
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className="send-button"
            aria-label={sendLabel}
            disabled={!canSubmit}
          >
            <ArrowUp size={19} />
          </button>
        )}
      </div>
    </form>
  );
}
