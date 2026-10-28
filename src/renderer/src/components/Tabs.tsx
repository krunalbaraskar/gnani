import type { KeyboardEvent } from 'react';

/** Arrow keys move between tabs; Tab moves on to the panel's controls. */
export function moveTab(event: KeyboardEvent<HTMLElement>) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : event.key === 'ArrowRight'
          ? (at + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (at - 1 + tabs.length) % tabs.length
            : -1;
  if (next < 0) return;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}
