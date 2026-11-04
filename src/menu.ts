// Contextual menu (tap-and-hold on the glasses). Every entry is a one-shot
// verb; main.ts applies it to the karaoke clock. No exit item: the glasses
// double-tap stays the only way out, as store submission requires.

export interface MenuSpec {
  id: number
  label: string
}

export const MENU_RESTART = 1
export const MENU_EARLIER = 2
export const MENU_LATER = 3
export const MENU_CENTER = 4
export const MENU_RESYNC = 5

// One menu step on the phone slider's -3000..3000 ms range.
export const OFFSET_STEP_MS = 500
export const OFFSET_MIN_MS = -3000
export const OFFSET_MAX_MS = 3000

export const LYRICS_MENU: readonly MenuSpec[] = [
  { id: MENU_RESTART, label: 'Restart song' },
  { id: MENU_EARLIER, label: 'Lyrics earlier 500ms' },
  { id: MENU_LATER, label: 'Lyrics later 500ms' },
  { id: MENU_CENTER, label: 'Center on clock' },
  { id: MENU_RESYNC, label: 'Re-sync to player' },
]

export function stepOffset(current: number, delta: number): number {
  return Math.max(OFFSET_MIN_MS, Math.min(OFFSET_MAX_MS, current + delta))
}
