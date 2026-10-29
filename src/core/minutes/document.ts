/** The minutes as a standalone, printable HTML page (for PDF export). */
import { escapeHtml, markdownToHtml } from '../../shared/markdown.ts';

export function minutesDocument(title: string, markdown: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font: 11pt/1.5 "Segoe UI", "Nirmala UI", system-ui, sans-serif; color: #1b1d22; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 12.5pt; margin: 16pt 0 4pt; padding-bottom: 2pt; border-bottom: 1px solid #d9dce3; }
  h3 { font-size: 11pt; margin: 12pt 0 2pt; }
  p { margin: 4pt 0; }
  ul, ol { margin: 4pt 0; padding-left: 18pt; }
  li { margin: 2pt 0; }
  li.task { list-style: none; margin-left: -14pt; }
  li.task.done { color: #6b7080; text-decoration: line-through; }
  .box { display: inline-block; width: 12pt; }
  code { font-family: Consolas, monospace; background: #f1f2f5; padding: 0 2pt; }
  footer { margin-top: 24pt; color: #8a8f9c; font-size: 8.5pt; }
</style></head>
<body>
${markdownToHtml(markdown)}
<footer>Minutes written by Echo from the meeting transcript. Check before sharing.</footer>
</body></html>`;
}
