import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '../src/core/llm/types.ts';
import { MeetingService, type MeetingEvent } from '../src/core/meetings/service.ts';
import {
  MeetingStore,
  newMeeting,
  parseStoredMeeting,
  searchMeetings,
  type StoredMeeting,
} from '../src/core/meetings/store.ts';
import type { SessionRecord } from '../src/core/session/types.ts';
import { waitFor } from './helpers/wait.ts';

function record(startedAt: number, lines: string[]): SessionRecord {
  return {
    startedAt,
    endedAt: startedAt + 60_000,
    sttLanguage: 'hi-IN',
    outputLanguage: 'same',
    contextNote: '',
    audioMode: 'live',
    echoesRemoved: 0,
    suggestions: [],
    mode: 'assist',
    segments: lines.map((text, i) => ({
      id: `them:${i}`,
      speaker: 'them' as const,
      text,
      at: startedAt + i * 1000,
    })),
  };
}

const T0 = 1_790_000_000_000;
const tempDir = () => mkdtempSync(join(tmpdir(), 'echo-meetings-'));

const MINUTES =
  '# Pricing review\n## Summary\nWe agreed on the price.\n## Action items\n- [ ] **Me** — send the quote';

function llm(reply = MINUTES, delayMs = 0): LlmProvider & { calls: number } {
  const p = {
    name: 'fake',
    calls: 0,
    async *streamChat(req: { signal?: AbortSignal }) {
      p.calls++;
      for (const w of reply.match(/\S+\s*/g) ?? []) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield w;
      }
    },
  };
  return p;
}

describe('MeetingStore', () => {
  it('saves, reloads from disk, and deletes meetings', async () => {
    const dir = tempDir();
    const store = new MeetingStore(dir);
    const m = newMeeting(record(T0, ['hello']));
    await store.save(m);
    expect(readdirSync(dir)).toEqual([`${m.id}.json`]);

    const again = new MeetingStore(dir);
    expect((await again.get(m.id))?.record.segments[0]?.text).toBe('hello');
    expect(await again.delete(m.id)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(await again.get(m.id)).toBeNull();
  });

  it('skips files that are not valid meetings and rejects bad ids', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'm123.json'), '{not json');
    writeFileSync(join(dir, 'm1790000000000.json'), JSON.stringify({ version: 2 }));
    writeFileSync(join(dir, 'notes.txt'), 'hi');
    const store = new MeetingStore(dir);
    expect(await store.all()).toEqual([]);
    expect(await store.get('../settings')).toBeNull();
    expect(parseStoredMeeting({ ...newMeeting(record(T0, [])), id: '../x' })).toBeNull();
  });
});

describe('searchMeetings', () => {
  const a: StoredMeeting = {
    ...newMeeting(record(T0, ['the price of paint'])),
    title: 'Paint call',
  };
  const b: StoredMeeting = {
    ...newMeeting(record(T0 + 1000, ['we spoke about delivery'])),
    notes: 'paint shade',
  };
  const c = newMeeting(record(T0 + 2000, ['nothing here']));

  it('lists newest first with no query', () => {
    expect(searchMeetings([a, b, c], '').map((m) => m.id)).toEqual([c.id, b.id, a.id]);
  });

  it('needs every word, matches prefixes, ranks title hits first', () => {
    expect(searchMeetings([a, b, c], 'pain').map((m) => m.id)).toEqual([a.id, b.id]);
    expect(searchMeetings([a, b, c], 'paint delivery').map((m) => m.id)).toEqual([b.id]);
    expect(searchMeetings([a, b, c], 'zebra')).toEqual([]);
  });
});

describe('MeetingService', () => {
  function setup(provider: LlmProvider) {
    const events: MeetingEvent[] = [];
    const service = new MeetingService({
      store: new MeetingStore(tempDir()),
      llm: () => provider,
      writer: () => ({ myName: 'Asha', language: 'English' }),
      emit: (e) => events.push(e),
      now: () => T0 + 99,
    });
    return { service, events };
  }

  it('saves a meeting and writes its minutes, taking the title from them', async () => {
    const { service, events } = setup(llm());
    const m = await service.saveRecord(record(T0, ['We agreed on the price.']));
    await service.writeMinutes(m.id);
    const d = (await service.detail(m.id))!;
    expect(d.title).toBe('Pricing review');
    expect(d.minutes).toBe('ready');
    expect(d.actionItems).toBe(1);
    expect(d.minutesView?.markdown).toContain('**With:** Asha, Them');
    expect(events.map((e) => e.type)).toContain('minutes-progress');
    const states = events.flatMap((e) => (e.type === 'meeting-updated' ? [e.summary.minutes] : []));
    expect(states).toEqual(['none', 'writing', 'ready']);
  });

  it('keeps a title the user set and notes added while writing', async () => {
    const { service } = setup(llm(MINUTES, 5));
    const m = await service.saveRecord(record(T0, ['We agreed on the price.']));
    await service.update(m.id, { title: 'Mehta pricing' });
    const writing = service.writeMinutes(m.id);
    await service.update(m.id, { notes: 'added later' });
    await writing;
    const d = (await service.detail(m.id))!;
    expect(d.title).toBe('Mehta pricing');
    expect(d.notes).toBe('added later');
    expect(d.minutesView?.markdown).toMatch(/^# Mehta pricing/);
  });

  it('records a failure and a cancel instead of throwing', async () => {
    const failing: LlmProvider = {
      name: 'down',
      // eslint-disable-next-line require-yield -- fails before the first token
      async *streamChat() {
        throw new Error('LLM did not respond');
      },
    };
    const { service } = setup(failing);
    const m = await service.saveRecord(record(T0, ['hi']));
    await service.writeMinutes(m.id);
    expect((await service.detail(m.id))?.minutesError).toBe('LLM did not respond');

    const slow = setup(llm(MINUTES, 20));
    const m2 = await slow.service.saveRecord(record(T0 + 5, ['hi']));
    const writing = slow.service.writeMinutes(m2.id);
    await waitFor(
      () => slow.events.some((e) => e.type === 'minutes-progress'),
      1000,
      'writing started',
    );
    slow.service.cancelMinutes(m2.id);
    await writing;
    const d = (await slow.service.detail(m2.id))!;
    expect(d.minutes).toBe('failed');
    expect(d.minutesError).toBe('Cancelled.');
  });

  it('marks edited minutes and clears figure warnings', async () => {
    const { service } = setup(llm(MINUTES.replace('the price', 'the price of 900')));
    const m = await service.saveRecord(record(T0, ['We agreed on the price.']));
    await service.writeMinutes(m.id);
    expect((await service.detail(m.id))?.minutesView?.unverifiedFigures).toEqual(['900']);
    const d = await service.update(m.id, { minutes: '# Fixed\nprice is 800' });
    expect(d?.minutesView).toMatchObject({ edited: true, unverifiedFigures: [] });
  });

  it('deletes a meeting while its minutes are being written', async () => {
    const { service, events } = setup(llm(MINUTES, 10));
    const m = await service.saveRecord(record(T0, ['hi']));
    const writing = service.writeMinutes(m.id);
    expect(await service.delete(m.id)).toBe(true);
    await writing;
    expect(await service.detail(m.id)).toBeNull();
    expect(events).toContainEqual({ type: 'meeting-deleted', id: m.id });
    await waitFor(() => events.at(-1)?.type === 'memory-updated', 500, 'memory rebuilt');
    expect(service.memory).toEqual([]);
    expect(await service.list()).toEqual([]);
  });
});

describe('MeetingService memory', () => {
  it('keeps past minutes ready for answers and reports how many meetings it holds', async () => {
    const events: MeetingEvent[] = [];
    const service = new MeetingService({
      store: new MeetingStore(tempDir()),
      llm: () => llm(),
      writer: () => ({ myName: '', language: 'English' }),
      emit: (e) => events.push(e),
    });
    const m = await service.saveRecord(record(T0, ['We agreed on the price.']));
    await service.writeMinutes(m.id);
    await waitFor(() => service.memory.length > 0, 500, 'memory');
    expect(service.memory[0]!.file).toMatch(/^meeting \d{4}-\d\d-\d\d Pricing review$/);
    expect(events.filter((e) => e.type === 'memory-updated').at(-1)).toEqual({
      type: 'memory-updated',
      meetings: 1,
    });
  });
});

describe('meeting previews', () => {
  it('show minutes as prose, without list markers or task boxes', async () => {
    const service = new MeetingService({
      store: new MeetingStore(tempDir()),
      llm: () =>
        llm(
          '# Sync\n## Summary\nThe van is late.\n## Action items\n- [x] **Me** — call the transporter',
        ),
      writer: () => ({ myName: '', language: 'English' }),
      emit: () => {},
    });
    const m = await service.saveRecord(record(T0, ['The van is late.']));
    await service.writeMinutes(m.id);
    const [summary] = await service.list();
    expect(summary!.snippet).toBe('The van is late. Me — call the transporter');
    expect(summary!.snippet).not.toMatch(/\[x\]|^-|\*\*/);
  });
});
