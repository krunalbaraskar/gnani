import { useRef, useState } from 'react';
import { CONSENT_VERSION } from '../../../shared/settings.ts';
import { Icon } from '../components/Icon.tsx';
import type { SettingsProps } from './MainWindow.tsx';
import {
  CalendarAccounts,
  KeysStatus,
  KnowledgeFields,
  PrivacyText,
  ProfileFields,
} from './SettingsPage.tsx';

const STEPS = ['Welcome', 'Your name', 'Your calendar', 'Your knowledge', 'Ready'];

export function Onboarding(props: SettingsProps) {
  const { app, onChange } = props;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const consent =
    app.settings.consentAcknowledged && app.settings.consentVersion >= CONSENT_VERSION;
  const move = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => title.current?.focus());
  };
  const save = async (finish: boolean) => {
    setBusy(true);
    const result = await onChange(
      finish ? { onboarded: true } : { consentAcknowledged: true, consentVersion: CONSENT_VERSION },
    );
    setBusy(false);
    if (result && !finish && result.consentAcknowledged) move(1);
  };
  return (
    <main className="onboarding">
      <div className="onboarding-brand">
        <span className="brand-mark">
          <Icon name="sparkle" size={20} />
        </span>{' '}
        Bolo
      </div>
      <div className="onboarding-card">
        <header>
          <p className="eyebrow">Let’s make some room for conversation</p>
          <ol className="step-dots" aria-label="Setup progress">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? 'step' : undefined}>
                <span className={i <= step ? 'complete' : ''} aria-hidden />{' '}
                <span className="sr-only">
                  Step {i + 1}: {label}
                  {i < step ? ', completed' : ''}
                </span>
              </li>
            ))}
          </ol>
          <p className="muted small">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1 ref={title} tabIndex={-1}>
            {step === 0 ? 'Be here. Bolo remembers.' : STEPS[step]}
          </h1>
        </header>
        <div className="onboarding-body">
          {step === 0 && (
            <>
              <p>
                Bolo is your meeting buddy for conversations in Indian languages. Get a little help
                during the call, and clear minutes when it’s over.
              </p>
              <h2>Before you record a call</h2>
              <PrivacyText stt={app.stt.name} />
              <button className="primary" disabled={busy} onClick={() => void save(false)}>
                I understand — I will ask for consent
              </button>
            </>
          )}
          {step === 1 && <ProfileFields {...props} />}
          {step === 2 && <CalendarAccounts {...props} />}
          {step === 3 && <KnowledgeFields {...props} />}
          {step === 4 && (
            <>
              <p>A little preparation, a calmer meeting. You’re ready to go.</p>
              <KeysStatus app={app} />
              <ul className="hotkey-tips">
                <li>
                  <kbd>Ctrl+Shift+Space</kbd>
                  <span>Answer what they just asked</span>
                </li>
                <li>
                  <kbd>Ctrl+Shift+U</kbd>
                  <span>Catch up on the last 10 minutes</span>
                </li>
                <li>
                  <kbd>Ctrl+Alt+Space</kbd>
                  <span>Ask about what’s on your screen</span>
                </li>
              </ul>
              <p className="muted">
                Remember to tell everyone before recording. Your files and saved meetings can help
                Bolo answer with context.
              </p>
            </>
          )}
        </div>
        <footer className="onboarding-actions">
          {step > 0 && (
            <button disabled={busy} onClick={() => move(step - 1)}>
              Back
            </button>
          )}
          <button className="link" disabled={busy} onClick={() => void save(true)}>
            {step === 0 ? 'Skip setup' : 'Skip'}
          </button>
          <span className="spacer" />
          {step > 0 ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => (step === 4 ? void save(true) : move(step + 1))}
            >
              {step === 4 ? 'Let’s begin' : 'Next'}
              <Icon name="arrow" size={15} />
            </button>
          ) : (
            consent && (
              <button disabled={busy} onClick={() => move(1)}>
                Next <Icon name="arrow" size={15} />
              </button>
            )
          )}
        </footer>
      </div>
      <p className="muted small">Your setup can always be changed in Settings.</p>
    </main>
  );
}
