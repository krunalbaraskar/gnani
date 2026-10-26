/** First-run notice. Shown again when what Bolo sends out changes (see CONSENT_VERSION). */
export function ConsentNotice({ onAccept, sttName }: { onAccept: () => void; sttName: string }) {
  return (
    <div className="consent" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <h2 id="consent-title">Before you record a call</h2>
      <p>
        Bolo listens to <strong>both sides</strong> of your conversation. It sends the audio to
        {sttName} for speech-to-text, and the transcript to the AI model you configure, to suggest
        replies.
      </p>
      <p>
        The contents of your context folder are sent to that AI model to answer questions. A picture
        of your screen is sent to it each time you ask with the screen, and only then.
      </p>
      <p>
        <strong>
          Always tell the other person and get their consent before recording or transcribing a
          conversation.
        </strong>{' '}
        In many places this is required by law, and it is the right thing to do.
      </p>
      <p className="muted">
        Each meeting&apos;s transcript, notes and minutes are saved on this computer, in Bolo&apos;s
        meeting library, until you delete them. To write the minutes, the transcript is sent to your
        AI model once more after the meeting. Use synthetic or consented conversations for demos.
      </p>
      <button className="primary" onClick={onAccept} autoFocus>
        I understand — I will ask for consent
      </button>
    </div>
  );
}
