import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface SignaturePadHandle {
  /** PNG der Unterschrift oder null, wenn nichts gezeichnet wurde. */
  toPng: () => Promise<Uint8Array | null>
  clear: () => void
}

interface SignaturePadProps {
  onChange?: (isEmpty: boolean) => void
}

/**
 * Unterschriftsfeld für Finger oder Stift (Tablet, Handy) und Maus.
 *
 * Pointer-Events decken alle Eingabearten ab; `touch-action: none` verhindert,
 * dass der Browser beim Unterschreiben die Seite scrollt. Die Zeichenfläche
 * wird in Geräte-Pixeln angelegt, damit die Linie auch auf Retina-Displays
 * scharf bleibt.
 */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(({ onChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)

  const setEmpty = (value: boolean) => {
    setIsEmpty(value)
    onChange?.(value)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
    // Einzelner Tipp = Punkt
    const ctx = e.currentTarget.getContext('2d')
    if (ctx && last.current) {
      ctx.beginPath()
      ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
      ctx.fillStyle = '#111827'
      ctx.fill()
    }
    if (isEmpty) setEmpty(false)
  }

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  const handleUp = () => {
    drawing.current = false
    last.current = null
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setEmpty(true)
  }

  useImperativeHandle(ref, () => ({
    clear,
    toPng: async () => {
      const canvas = canvasRef.current
      if (!canvas || isEmpty) return null
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null
    }
  }))

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        className="signature-pad-canvas"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleUp}
        aria-label="Unterschriftsfeld"
      />
      <div className="signature-pad-footer">
        <span className="signature-pad-hint">{isEmpty ? 'Hier unterschreiben' : 'Unterschrift erfasst'}</span>
        <button type="button" className="btn secondary-btn" onClick={clear} disabled={isEmpty}>
          Löschen
        </button>
      </div>
    </div>
  )
})

SignaturePad.displayName = 'SignaturePad'

export default SignaturePad
