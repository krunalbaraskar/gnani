import type { BoloApi } from '../../preload/api.ts';

declare global {
  interface Window {
    bolo: BoloApi;
  }
}
