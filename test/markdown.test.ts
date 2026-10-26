import { describe, expect, it } from 'vitest';
import { markdownToHtml, markdownToPlainText } from '../src/shared/markdown.ts';

describe('markdownToHtml', () => {
  it('renders the minutes subset', () => {
    const html = markdownToHtml(
      [
        '# Title',
        '**Date:** today',
        '',
        '## Action items',
        '- [ ] **Asha** — send it',
        '- [x] done one',
        '- plain _note_ with `code`',
        '1. first',
        '---',
      ].join('\n'),
    );
    expect(html).toBe(
      [
        '<h1>Title</h1>',
        '<p><strong>Date:</strong> today</p>',
        '<h2>Action items</h2>',
        '<ul>',
        '<li class="task"><span class="box">☐</span> <strong>Asha</strong> — send it</li>',
        '<li class="task done"><span class="box">☑</span> done one</li>',
        '<li>plain <em>note</em> with <code>code</code></li>',
        '</ul>',
        '<ol>',
        '<li>first</li>',
        '</ol>',
        '<hr>',
      ].join('\n'),
    );
  });

  it('escapes everything, including markup inside formatting', () => {
    const html = markdownToHtml(
      '# <img src=x onerror=alert(1)>\n- **<script>x</script>**\n[a](javascript:alert(1)) "q" \'s\'',
    );
    expect(html).not.toMatch(/<(img|script)/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('<strong>&lt;script&gt;x&lt;/script&gt;</strong>');
    expect(html).not.toContain('href');
    expect(html).toContain('&quot;q&quot; &#39;s&#39;');
  });

  it('does not treat snake_case or 2*3*4 as emphasis', () => {
    expect(markdownToHtml('use my_var_name and 2*3*4')).toBe('<p>use my_var_name and 2*3*4</p>');
  });
});

describe('markdownToPlainText', () => {
  it('drops Markdown for an email', () => {
    expect(
      markdownToPlainText(
        '# Order review\n\n## Action items\n- [ ] **Asha** — send\n- [x] done\n- note',
      ),
    ).toBe('ORDER REVIEW\n\nACTION ITEMS\n☐ Asha — send\n☑ done\n• note');
  });
});
