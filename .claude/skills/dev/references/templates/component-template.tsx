// Template: renderer/components/<ComponentName>.tsx
//
// A presentational or lightly stateful component. For a component wrapping a non-React
// resource (VexFlow, a canvas with a ResizeObserver, a timer, a push-channel listener) use
// canvas-component-template.tsx instead; the disposal pattern is different.
//
// Co-locate <ComponentName>.module.css. Co-locate <ComponentName>.test.tsx only when there is
// logic worth testing; pure presentation gets no snapshot test.

import { useState } from 'react'
import styles from './ComponentName.module.css'

interface Props {
  // Typed via an interface, never inline. Optional props carry `?` explicitly.
  label: string
  initialValue?: number
  onChange?: (value: number) => void
}

export function ComponentName({ label, initialValue = 0, onChange }: Props) {
  const [value, setValue] = useState(initialValue)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value)
    setValue(next)
    onChange?.(next)
  }

  return (
    <div className={styles.root}>
      <label className={styles.label}>
        {label}
        <input className={styles.input} type="number" value={value} onChange={handleChange} />
      </label>
    </div>
  )
}

// Notes:
// - Named export, never default.
// - Controlled input: `value` + `onChange`, never `defaultValue` + a ref.
// - The label wraps the input so a click on the text focuses it; if the design splits them,
//   use htmlFor + id.
// - No useCallback on handleChange: there is no React.memo child and no measured re-render cost.
