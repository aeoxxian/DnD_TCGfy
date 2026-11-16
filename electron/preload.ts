import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DesktopBridge, type Settings } from '../src/shared/contracts';

const bridge: DesktopBridge = Object.freeze({
  getBootstrap: () => ipcRenderer.invoke(IPC.getBootstrap),
  saveSettings: (settings: Settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
});
contextBridge.exposeInMainWorld('desktop', bridge);
