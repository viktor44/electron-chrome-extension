import { ipcMain, ipcRenderer, webContents } from 'electron';

/** renderer -> main: forward a message to every frame of another webContents */
const RELAY = 'ecx-relay-to-webcontents';

/**
 * Renderer to renderer messaging.
 *
 * `ipcRenderer.sendTo` / `ipcRenderer.sendToAll` have been removed in Electron 28,
 * so the main process relays those messages.
 * @see https://www.electronjs.org/docs/latest/breaking-changes#removed-ipcrenderersendto
 */

/**
 * Starts the relay. Must be called once from the main process, before any renderer
 * uses `sendToWebContents`.
 */
export const startSendToWebContentsRelay = () => {
  ipcMain.on(
    RELAY,
    (_event: Electron.IpcMainEvent, targetWebContentsId: number, channel: string, args: any[]) => {
      const target = webContents.fromId(targetWebContentsId);
      if (!target || target.isDestroyed()) return;

      // `sendToAll` used to deliver to every frame of the webContents, and content
      // scripts do run in sub frames, so keep that behaviour.
      const frames = target.mainFrame ? target.mainFrame.framesInSubtree : [];

      if (frames.length === 0) {
        target.send(channel, ...args);
        return;
      }

      frames.forEach((frame) => {
        try {
          frame.send(channel, ...args);
        } catch (e) {
          // frame has been detached in between, nothing to deliver to
        }
      });
    }
  );
};

/**
 * From a renderer process, send a message to every frame of another webContents.
 * Replacement for `ipcRenderer.sendToAll`, the receiver signature is unchanged.
 */
export const sendToWebContents = (targetWebContentsId: number, channel: string, ...args: any[]) => {
  ipcRenderer.send(RELAY, targetWebContentsId, channel, args);
};
