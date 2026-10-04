export function ConsentNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="modal">
        <h2 id="consent-title">Before you record a call</h2>
        <p>
          Bolo listens to <strong>both sides</strong> of your conversation. It sends the audio to
          Gnani for speech-to-text, and the transcript to the AI model you configure, to suggest
          replies.
        </p>
        <p>
          <strong>
            Always tell the other person and get their consent before recording or transcribing a
            conversation.
          </strong>{' '}
          In many places this is required by law, and it is the right thing to do.
        </p>
        <p className="muted">
          Transcripts are saved only to the folder you choose. Use synthetic or consented
          conversations for demos.
        </p>
        <button className="primary" onClick={onAccept} autoFocus>
          I understand — I will ask for consent
        </button>
      </div>
    </div>
  );
}
