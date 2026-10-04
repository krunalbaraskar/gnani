import { desktopCapturer, session } from 'electron';

/**
 * System audio on Windows: when the renderer calls getDisplayMedia(), answer with the
 * primary screen as the (required) video source and audio: 'loopback', which captures
 * everything the PC is playing — the other side of a Zoom/Meet/Teams call. The renderer
 * stops the video track straight away. No picker is shown.
 */
export function installMediaHandlers(isOwnWebContents: (id: number) => boolean): void {
  const ses = session.defaultSession;

  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const screenSource = sources[0];
          if (!screenSource) return callback({});
          callback({ video: screenSource, audio: 'loopback' });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );

  // Only the media permission (mic / display capture) is granted; everything else is denied.
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(
      isOwnWebContents(wc.id) && (permission === 'media' || permission === 'display-capture'),
    );
  });
  ses.setPermissionCheckHandler((wc, permission) => {
    return (
      !!wc &&
      isOwnWebContents(wc.id) &&
      (permission === 'media' || permission === 'display-capture')
    );
  });
}
