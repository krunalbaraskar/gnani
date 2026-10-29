export function Avatars({ people }: { people: readonly string[] }) {
  if (!people.length) return null;
  return (
    <span className="people" aria-label={people.join(', ')}>
      {people.slice(0, 4).map((name, i) => (
        <span key={`${name}-${i}`} className={`avatar avatar-${i}`} title={name} aria-hidden>
          {initials(name)}
        </span>
      ))}
      {people.length > 4 && (
        <span className="avatar avatar-more" aria-hidden>
          +{people.length - 4}
        </span>
      )}
    </span>
  );
}
/** Up to two initials; whole characters, so an emoji or accented letter never splits. */
export function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => Array.from(s)[0])
    .join('')
    .toLocaleUpperCase();
}

/** A stable colour for a speaker, including when their position in a list changes. */
export function Avatar({ name }: { name: string }) {
  const tone = Array.from(name).reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 3;
  return (
    <span className={`avatar avatar-${tone}`} aria-hidden>
      {initials(name)}
    </span>
  );
}
