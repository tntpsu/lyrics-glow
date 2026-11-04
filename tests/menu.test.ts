// @vitest-environment jsdom
// A malformed menu makes the firmware reject the whole page, so the menu
// spec is checked against the SDK's own validator before it can ship.

import { describe, expect, it } from 'vitest'
import {
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
  isMenuNameWithinLimit,
  isValidMenuItemID,
  validateEvenHubPageContainerMenu,
} from '@evenrealities/even_hub_sdk'
import { LYRICS_MENU, OFFSET_MAX_MS, OFFSET_MIN_MS, OFFSET_STEP_MS, stepOffset } from '../src/menu'

describe('LYRICS_MENU', () => {
  it('passes the SDK page-menu validator', () => {
    const page = {
      containerTotalNum: 1,
      textObject: [new TextContainerProperty({ containerID: 1, containerName: 'x', content: '' })],
      menuObject: new MenuContainerProperty({
        menuItems: LYRICS_MENU.map(m => new MenuItemProperty({ itemName: m.label, itemID: m.id })),
      }),
    }
    expect(validateEvenHubPageContainerMenu(page)).toEqual({ valid: true })
  })

  it('keeps every item within firmware limits', () => {
    expect(LYRICS_MENU.length).toBeLessThanOrEqual(10)
    const ids = new Set<number>()
    for (const m of LYRICS_MENU) {
      expect(isValidMenuItemID(m.id)).toBe(true)
      expect(isMenuNameWithinLimit(m.label)).toBe(true)
      expect(ids.has(m.id)).toBe(false)
      ids.add(m.id)
    }
  })

  it('has no exit or close item, which store submission forbids', () => {
    for (const m of LYRICS_MENU) expect(m.label).not.toMatch(/exit|close|quit/i)
  })
})

describe('stepOffset', () => {
  it('moves by one step and clamps to the slider range', () => {
    expect(stepOffset(0, OFFSET_STEP_MS)).toBe(500)
    expect(stepOffset(0, -OFFSET_STEP_MS)).toBe(-500)
    expect(stepOffset(OFFSET_MAX_MS, OFFSET_STEP_MS)).toBe(OFFSET_MAX_MS)
    expect(stepOffset(OFFSET_MIN_MS, -OFFSET_STEP_MS)).toBe(OFFSET_MIN_MS)
    expect(stepOffset(2800, OFFSET_STEP_MS)).toBe(OFFSET_MAX_MS)
  })
})
