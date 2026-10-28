/**
 * "Is another app in a call?" On Windows, the privacy settings record which apps use the
 * microphone (the mic icon in the taskbar): under
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone
 * an app whose LastUsedTimeStop is 0 is using it right now. This reads that registry
 * dump; it never touches audio. Pure, so it is tested with captured output.
 */

export const MIC_CONSENT_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

/** Friendly names, and how likely each app is to be the meeting (lower = more). */
const KNOWN: { match: RegExp; app: string; rank: number }[] = [
  { match: /(^|[\\#])zoom\.exe$|zoom/i, app: 'Zoom', rank: 0 },
  { match: /ms-teams\.exe$|teams\.exe$|MSTeams/i, app: 'Microsoft Teams', rank: 0 },
  { match: /webex|ciscocollab/i, app: 'Webex', rank: 0 },
  { match: /slack\.exe$/i, app: 'Slack', rank: 1 },
  { match: /discord\.exe$/i, app: 'Discord', rank: 1 },
  { match: /whatsapp/i, app: 'WhatsApp', rank: 1 },
  { match: /skype/i, app: 'Skype', rank: 1 },
  { match: /chrome\.exe$/i, app: 'Google Chrome', rank: 2 },
  { match: /msedge\.exe$/i, app: 'Microsoft Edge', rank: 2 },
  { match: /firefox\.exe$/i, app: 'Firefox', rank: 2 },
  { match: /brave\.exe$/i, app: 'Brave', rank: 2 },
  { match: /arc\.exe$|TheBrowserCompany/i, app: 'Arc', rank: 2 },
];

/** Not calls: Windows' own voice features. */
const IGNORED = /SoundRecorder|VoiceAccess|Cortana|SpeechRuntime|narrator/i;

export interface MicUser {
  /** Registry key name: an executable path with # for \, or a packaged app id. */
  id: string;
  app: string;
  rank: number;
}

function friendly(id: string): { app: string; rank: number } {
  const known = KNOWN.find((k) => k.match.test(id));
  if (known) return { app: known.app, rank: known.rank };
  const exe = id.split(/[#\\]/).pop() ?? id;
  const name =
    exe
      .replace(/\.exe$/i, '')
      .replace(/_[a-z0-9]{13}$/i, '')
      .split('.')
      .pop() ?? exe;
  return { app: name.charAt(0).toUpperCase() + name.slice(1), rank: 3 };
}

/**
 * Apps using the microphone now, most meeting-like first, from `reg query <key> /s`.
 * `selfPaths`: our own executable(s), never reported.
 */
export function parseMicUsage(regOutput: string, selfPaths: readonly string[] = []): MicUser[] {
  const self = selfPaths.map((p) => p.replace(/\\/g, '#').toLowerCase());
  const users: MicUser[] = [];
  let key = '';
  let start = '';
  let stop = '';
  const flush = () => {
    if (!key) return;
    const id = key.split('\\').pop() ?? '';
    const isApp = !/^(microphone|NonPackaged)$/i.test(id);
    const inUse = /^0x0+$/i.test(stop) && !!start && !/^0x0+$/i.test(start);
    if (isApp && inUse && !IGNORED.test(id) && !self.includes(id.toLowerCase())) {
      users.push({ id, ...friendly(id) });
    }
    key = start = stop = '';
  };
  for (const raw of regOutput.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) {
      flush();
      key = line;
      continue;
    }
    const m = /^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+(0x[0-9a-f]+)$/i.exec(line);
    if (m) {
      if (m[1]!.toLowerCase() === 'lastusedtimestart') start = m[2]!;
      else stop = m[2]!;
    }
  }
  flush();
  return users.sort((a, b) => a.rank - b.rank || a.app.localeCompare(b.app));
}
