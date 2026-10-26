/**
 * The small Markdown subset the minutes use: headings, bullets, task boxes, bold, italic,
 * inline code, rules and paragraphs. Everything is HTML-escaped first, so model output
 * or a user's edit can never inject markup into the library view or the PDF.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const openList = (kind: 'ul' | 'ol') => {
    flushPara();
    if (list === kind) return;
    closeList();
    out.push(`<${kind}>`);
    list = kind;
  };

  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if (heading) {
      flushPara();
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr>');
    } else if (bullet) {
      openList('ul');
      const task = TASK.exec(bullet[1]!);
      out.push(
        task
          ? `<li class="task${task[1] === ' ' ? '' : ' done'}"><span class="box">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2]!)}</li>`
          : `<li>${inline(bullet[1]!)}</li>`,
      );
    } else if (numbered) {
      openList('ol');
      out.push(`<li>${inline(numbered[1]!)}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return out.join('\n');
}

/** For pasting into an email or chat: no Markdown syntax, task boxes as ☐ / ☑. */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const heading = /^#{1,4}\s+(.*)$/.exec(line);
      if (heading) return heading[1]!.replace(/\*\*/g, '').toUpperCase();
      return line
        .replace(/^(\s*)[-*]\s+\[( |x|X)\]\s+/, (_m, sp: string, x: string) =>
          x === ' ' ? `${sp}☐ ` : `${sp}☑ `,
        )
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/(^|[\s(])_(.+?)_(?=[\s).,;:!?]|$)/g, '$1$2');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
