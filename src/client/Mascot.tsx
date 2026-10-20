import { DOT_ICONS, type DotIcon } from '../shared/types';

/** Stable identity keeps each specialist recognizable across views and reloads. */
function characterFor(identity?: string) {
  if (!identity) return DOT_ICONS[0];
  let hash = 0;
  for (const character of identity)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return DOT_ICONS[hash % DOT_ICONS.length];
}

export function Mascot({
  state = 'idle',
  small = false,
  identity,
  icon,
  name = 'Dot',
  decorative = false,
}: {
  state?: string;
  small?: boolean;
  identity?: string;
  /** An explicitly assigned character; falls back to a hash of identity. */
  icon?: DotIcon | null;
  name?: string;
  decorative?: boolean;
}) {
  const character = icon ?? characterFor(identity);
  return (
    <span className={`mascot ${state} ${small ? 'small' : ''}`}>
      <img
        className="dot-body"
        src={`/dots/${character}.png`}
        alt={decorative ? '' : `${name} is ${state}`}
        width={512}
        height={512}
        draggable={false}
      />
    </span>
  );
}
