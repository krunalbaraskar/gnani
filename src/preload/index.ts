import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('bolo', { version: '0.1.0' });
