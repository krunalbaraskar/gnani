export function Avatars({ people }: { people: readonly string[] }) {
  if (!people.length) return null;
  return (
    <span className="people" aria-label={people.join(', ')}>
      {people.slice(0, 4).map((name, i) => (
        <span key={`${name}-${i}`} className={`avatar avatar-${i}`} title={name} aria-hidden>
          {name
            .split(/[\s@._-]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0])
            .join('')
            .toLocaleUpperCase()}
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
