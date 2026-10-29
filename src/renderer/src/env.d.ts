import type { EchoApi } from '../../preload/api.ts';

declare global {
  interface Window {
    echo: EchoApi;
  }
}
