import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC, type DesktopBridge, type Settings } from '../src/shared/contracts';

const bridge: DesktopBridge = {
  getBootstrap: () => ipcRenderer.invoke(IPC.getBootstrap),
  saveSettings: (settings: Settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  saveLibraryState: state => ipcRenderer.invoke(IPC.saveLibraryState, state),
  importImages: async files => {
    try {
      if (!Array.isArray(files) || files.length < 1 || files.length > 100) return { ok: false, error: '이미지를 1~100장 선택해 주세요.' };
      return await ipcRenderer.invoke(IPC.importImages, files.map(file => webUtils.getPathForFile(file)));
    } catch { return { ok: false, error: '로컬 이미지 파일을 선택해 주세요.' }; }
  },
  saveCards: input => ipcRenderer.invoke(IPC.saveCards, input),
  archiveCard: id => ipcRenderer.invoke(IPC.archiveCard, id),
  saveTag: input => ipcRenderer.invoke(IPC.saveTag, input),
  deleteTag: id => ipcRenderer.invoke(IPC.deleteTag, id),
  createProfile: input => ipcRenderer.invoke(IPC.createProfile, input),
  createDeck: input => ipcRenderer.invoke(IPC.createDeck, input),
  selectDeck: input => ipcRenderer.invoke(IPC.selectDeck, input),
  setDeckCards: input => ipcRenderer.invoke(IPC.setDeckCards, input),
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(bridge));
