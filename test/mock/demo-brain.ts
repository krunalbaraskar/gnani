/**
 * Scripted replies for the offline demo: what a sensible model would say for the
 * paint-distributor call in test/fixtures/script.ts and the files in demo-context/.
 * Used by `npm run mock-llm` and the Electron end-to-end test. No model is involved.
 */
import type { RecordedRequest } from './mock-llm-server.ts';

type Body = RecordedRequest['body'];

function textOf(content: Body['messages'][number]['content']): string {
  return typeof content === 'string' ? content : content.map((p) => p.text ?? '').join('\n');
}

const MEANINGS: [RegExp, string][] = [
  [/kitna stock/i, 'How much stock of the blue 5-litre is there, and what is the wholesale rate?'],
  [/order ke baare/i, 'Hello, this is Mehta Hardware. I wanted to talk about an order.'],
  [/quotation whatsapp/i, 'Okay, please send the quotation on WhatsApp.'],
];

export function demoReply(body: Body): string {
  const system = textOf(body.messages[0]?.content ?? '');
  const user = textOf(body.messages.at(-1)?.content ?? '');
  const hasImage = body.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  );

  // Meaning of one line (see src/core/gloss/engine.ts).
  if (system.includes('follow a live call')) {
    return MEANINGS.find(([re]) => re.test(user))?.[1] ?? '-';
  }
  if (hasImage)
    return [
      'Count stock per item in one pass, then return the item with the most.',
      '```python',
      'def most_stocked(rows):',
      '    return max(rows, key=lambda r: r["stock"])["item"]',
      '```',
      'Time O(n), space O(1).',
      '[source: screen]',
    ].join('\n');

  const asked = /My own question to you[^"]*"([^"]*)"/.exec(user)?.[1];
  if (asked) {
    if (/deliver/i.test(asked)) {
      return 'Delivery within 7 working days, free above ₹50,000. Agreed on the 12 September call.\n[source: project-notes.md]';
    }
    return 'That is not in my files. Let me confirm and message you right after this call.\n[source: missing]';
  }
  // Without the files in the prompt there is nothing to ground a figure in.
  if (!user.includes('--- inventory.csv ---'))
    return 'Ji bilkul, main abhi check karke batata hoon.';
  if (/kitna stock/i.test(user)) {
    return 'Blue 5 litre ke 142 units Pune godown mein hain. Thok rate ₹1,180 per unit hai, 50 ya zyada par.\n[source: inventory.csv, price-list.md]';
  }
  return 'Ji bilkul.\n[source: none]';
}
