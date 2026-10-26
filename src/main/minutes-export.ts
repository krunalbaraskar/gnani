import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { minutesDocument } from '../core/minutes/document.ts';

/** File-name-safe version of a meeting title. */
export function fileStem(title: string): string {
  return (
    title
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'meeting'
  );
}

/** Renders the minutes in a hidden window with JavaScript off and prints it to PDF. */
export async function writeMinutesPdf(path: string, title: string, markdown: string) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
  });
  try {
    const html = minutesDocument(title, markdown);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    await writeFile(path, pdf);
  } finally {
    win.destroy();
  }
}
