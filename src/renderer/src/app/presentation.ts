/** A readable channel name without changing the meeting's saved title. */
export function meetingSlug(title: string) {
  return (
    title
      .toLocaleLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'meeting'
  );
}
