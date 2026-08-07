// tslint:disable
/**
 * Make `ipcRendererInternal` available as Electron uses it.
 * @see https://github.com/electron/electron/blob/81e9dab52f6f59a56c3f928156823dd482817539/lib/renderer/ipc-renderer-internal.ts
 * @see new version https://github.com/electron/electron/blob/fa3379a5d5cd6494c126be4d4d21a36c75f46554/lib/renderer/ipc-renderer-internal.ts
 */

import { EventEmitter } from 'events';

const { ipc } = (process as any)._linkedBinding('electron_renderer_ipc');
//const v8Util = (process as any)._linkedBinding('electron_browser_v8_util');
 
//export const ipcRendererInternal = v8Util.getHiddenValue(global, 'ipc-internal');
export const ipcRendererInternal = new EventEmitter() as any; // as ElectronInternal.IpcRendererInternal;

const internal = true;

ipcRendererInternal.send = function (channel: any, ...args: any[]) {
  return ipc.send(internal, channel, args);
};

ipcRendererInternal.sendSync = function (channel: any, ...args: any[]) {
  return ipc.sendSync(internal, channel, args)[0];
};

// `sendTo` and `sendToAll` are gone: the `sendTo` method of the `electron_renderer_ipc`
// binding has been removed in Electron 28, along with `ipcRenderer.sendTo`.
// Nothing here used them, see `common/send-to-webcontents.ts` for the replacement.
// @see https://www.electronjs.org/docs/latest/breaking-changes#removed-ipcrenderersendto

ipcRendererInternal.invoke = async function (channel: string, ...args: any[]) {
  const { error, result } = await ipc.invoke(internal, channel, args);
  if (error) {
    throw new Error(`Error invoking remote method '${channel}': ${error}`);
  }
  return result;
};
