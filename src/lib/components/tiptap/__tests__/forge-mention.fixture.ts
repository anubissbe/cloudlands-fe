import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';

export function installForgeMentionFixture(onOpen: (url: string) => void): () => void {
  const previous = window.electronAPI;
  installMockElectronBridge({});
  registerMockIpcHandler('shell:openExternal', (input: unknown) => {
    onOpen((input as { url: string }).url);
    return { success: true };
  });
  return () => {
    unregisterMockIpcHandler('shell:openExternal');
    window.electronAPI = previous;
  };
}
