// ============================================================================
// Keyboard Insets (Mobile Virtual Keyboard Viewport Handling)
// ============================================================================

const KEYBOARD_HEIGHT_VAR = '--keyboard-height'

type VirtualKeyboard = {
  overlaysContent?: boolean
  boundingRect?: { height: number }
  addEventListener: (type: 'geometrychange', listener: () => void) => void
  removeEventListener: (type: 'geometrychange', listener: () => void) => void
}

type NavigatorWithKeyboard = Navigator & { virtualKeyboard?: VirtualKeyboard }

export function initKeyboardInsets() {
  if (typeof document === 'undefined') return () => {}
  const root = document.documentElement
  if (!root) return () => {}

  let viewportInset = 0
  let virtualKeyboardInset = 0

  const applyInset = () => {
    const inset = Math.max(0, viewportInset, virtualKeyboardInset)
    root.style.setProperty(KEYBOARD_HEIGHT_VAR, `${Math.round(inset)}px`)
  }

  const cleanup: Array<() => void> = []
  const viewport = window.visualViewport
  if (viewport) {
    const handleViewportChange = () => {
      viewportInset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      )
      applyInset()
    }

    viewport.addEventListener('resize', handleViewportChange)
    viewport.addEventListener('scroll', handleViewportChange)
    window.addEventListener('focus', handleViewportChange, true)

    cleanup.push(() => {
      viewport.removeEventListener('resize', handleViewportChange)
    })
    cleanup.push(() => {
      viewport.removeEventListener('scroll', handleViewportChange)
    })
    cleanup.push(() => {
      window.removeEventListener('focus', handleViewportChange, true)
    })

    handleViewportChange()
  }

  const virtualKeyboard = (navigator as NavigatorWithKeyboard).virtualKeyboard
  if (virtualKeyboard) {
    try {
      virtualKeyboard.overlaysContent = true
    } catch {
      // ignore
    }

    const handleGeometryChange = () => {
      const rect = virtualKeyboard.boundingRect
      virtualKeyboardInset = rect ? rect.height : 0
      applyInset()
    }

    virtualKeyboard.addEventListener('geometrychange', handleGeometryChange)
    cleanup.push(() => {
      virtualKeyboard.removeEventListener(
        'geometrychange',
        handleGeometryChange,
      )
    })

    handleGeometryChange()
  }

  const resetInset = () => {
    viewportInset = 0
    virtualKeyboardInset = 0
    applyInset()
  }

  window.addEventListener('pagehide', resetInset)
  cleanup.push(() => {
    window.removeEventListener('pagehide', resetInset)
  })

  applyInset()

  return () => {
    cleanup.forEach(fn => {
      try {
        fn()
      } catch {
        // ignore teardown errors
      }
    })
  }
}
