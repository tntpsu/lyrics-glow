// Glasses bridge wrapper for Lyrics Glow. Single full-screen text container.
// Mirrors the Cue/Glance pattern: serialize all BLE writes through a mutex,
// dedupe identical paints, expose tap/swipe/double-tap handlers, persist
// state via the SDK localStorage.
//
// Why a mutex: the SDK docs warn that concurrent textContainerUpgrade
// calls can crash the BLE connection. We render at 250ms so it's
// especially important here.

import {
  CreateStartUpPageContainer,
  EventSourceType,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  isMenuNameWithinLimit,
  isValidMenuItemID,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { MenuSpec } from './menu'

const MAIN_ID = 1
const MAIN_NAME = 'main'
const BRIDGE_TIMEOUT_MS = 4000
const WIDTH = 576
const HEIGHT = 288

export type InputSource = 'glasses' | 'ring' | 'unknown'
export type SwipeDir = 'up' | 'down'

export interface EvenRuntime {
  render: (text: string) => Promise<void>
  onTap: (handler: (source: InputSource) => void) => void
  onSwipe: (handler: (dir: SwipeDir, source: InputSource) => void) => void
  onDoubleTap: (handler: (source: InputSource) => void) => void
  onForeground: (handler: () => void) => void
  // Contextual menu (tap-and-hold) selection, by the MenuSpec id passed to
  // connectEvenRuntime. Unsupported firmware never fires it.
  onMenuSelect: (handler: (itemID: number) => void) => void
  exitApp: () => Promise<void>
  getStorage: (key: string) => Promise<string>
  setStorage: (key: string, value: string) => Promise<boolean>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for the Even bridge')),
      timeoutMs,
    )
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export async function connectEvenRuntime(
  initial: string,
  menu: readonly MenuSpec[] = [],
): Promise<EvenRuntime | null> {
  let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>
  try {
    bridge = await withTimeout(waitForEvenAppBridge(), BRIDGE_TIMEOUT_MS)
  } catch {
    return null
  }

  // A malformed menu makes the firmware reject the whole page, so entries
  // are filtered with the SDK's predicates before the page is built.
  const seen = new Set<number>()
  const menuItems = menu.filter(m => {
    const ok = isValidMenuItemID(m.id) && isMenuNameWithinLimit(m.label) && !seen.has(m.id)
    if (ok) seen.add(m.id)
    return ok
  }).slice(0, 10)
  const menuObject = menuItems.length > 0
    ? new MenuContainerProperty({
      menuItems: menuItems.map(m => new MenuItemProperty({ itemName: m.label, itemID: m.id })),
    })
    : undefined

  const main = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: WIDTH,
    height: HEIGHT,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 6,
    containerID: MAIN_ID,
    containerName: MAIN_NAME,
    content: initial,
    isEventCapture: 1,
  })

  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [main], menuObject }),
  )
  if (created !== 0) return null

  let lastSent = initial
  let lastLen = initial.length

  let busy: Promise<unknown> = Promise.resolve()
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = busy.then(work, work) as Promise<T>
    busy = next.then(() => undefined, () => undefined)
    return next
  }

  let tapHandler: ((source: InputSource) => void) | null = null
  let swipeHandler: ((dir: SwipeDir, source: InputSource) => void) | null = null
  let doubleTapHandler: ((source: InputSource) => void) | null = null
  let foregroundHandler: (() => void) | null = null
  let menuHandler: ((itemID: number) => void) | null = null

  function classifySource(src: number | undefined): InputSource {
    if (src === EventSourceType.TOUCH_EVENT_FROM_RING) return 'ring'
    if (
      src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_L ||
      src === EventSourceType.TOUCH_EVENT_FROM_GLASSES_R
    ) {
      return 'glasses'
    }
    return 'unknown'
  }

  bridge.onEvenHubEvent(event => {
    if (event.menuItemClickEvent) {
      const id = event.menuItemClickEvent.itemID
      if (typeof id === 'number') menuHandler?.(id)
      return
    }
    if (event.textEvent) {
      const t = event.textEvent.eventType ?? 0
      if (t === OsEventTypeList.SCROLL_TOP_EVENT) swipeHandler?.('up', 'unknown')
      else if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) swipeHandler?.('down', 'unknown')
      return
    }
    if (event.sysEvent) {
      const t = event.sysEvent.eventType ?? 0
      const src = classifySource(event.sysEvent.eventSource)
      if (t === 0) { tapHandler?.(src); return }
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) { doubleTapHandler?.(src); return }
      if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) { foregroundHandler?.(); return }
    }
  })

  return {
    async render(text: string): Promise<void> {
      if (text === lastSent) return
      await enqueue(async () => {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: MAIN_ID,
            containerName: MAIN_NAME,
            contentOffset: 0,
            contentLength: Math.max(lastLen, text.length),
            content: text,
          }),
        )
        lastSent = text
        lastLen = text.length
      })
    },
    onTap(h) { tapHandler = h },
    onSwipe(h) { swipeHandler = h },
    onDoubleTap(h) { doubleTapHandler = h },
    onForeground(h) { foregroundHandler = h },
    onMenuSelect(h) { menuHandler = h },
    async exitApp(): Promise<void> { await bridge.shutDownPageContainer(1) },
    async getStorage(key) {
      try { return await bridge.getLocalStorage(key) } catch { return '' }
    },
    async setStorage(key, value) {
      try { return await bridge.setLocalStorage(key, value) } catch { return false }
    },
  }
}
