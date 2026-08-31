import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly content?: ReactNode
  readonly disabled?: boolean
}

export interface SelectClassNames {
  readonly root?: string
  readonly trigger?: string
  readonly layer?: string
  readonly listbox?: string
  readonly option?: string
  readonly empty?: string
}

export interface SelectProps<Value extends string> {
  readonly ariaLabel: string
  readonly value: Value | ''
  readonly options: readonly SelectOption<Value>[]
  readonly onChange: (value: Value) => void
  readonly disabled?: boolean
  readonly placeholder?: ReactNode
  readonly emptyLabel?: ReactNode
  readonly selectedIndicator?: ReactNode
  readonly triggerIndicator?: ReactNode
  readonly classNames?: SelectClassNames
  readonly portalContainer?: Element
  readonly positionVariables?: {
    readonly left: string
    readonly top: string
    readonly width: string
    readonly maxHeight: string
  }
}

export function Select<Value extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = null,
  emptyLabel = null,
  selectedIndicator = null,
  triggerIndicator = null,
  classNames = {},
  portalContainer,
  positionVariables,
}: SelectProps<Value>) {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef('')
  const typeaheadTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex))
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const enabledIndexes = useMemo(
    () => options.flatMap((option, index) => (option.disabled ? [] : [index])),
    [options],
  )

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const moveActive = (direction: 1 | -1): void => {
    if (enabledIndexes.length === 0) return
    const currentPosition = enabledIndexes.indexOf(activeIndex)
    const start = currentPosition >= 0 ? currentPosition : direction > 0 ? -1 : 0
    const nextPosition = (start + direction + enabledIndexes.length) % enabledIndexes.length
    setActiveIndex(enabledIndexes[nextPosition]!)
  }

  const selectIndex = (index: number): void => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    close()
  }

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const listbox = listboxRef.current
    if (!trigger || !listbox) return
    const rect = trigger.getBoundingClientRect()
    const viewportPadding = 12
    const gap = 7
    const maxHeight = Math.min(360, window.innerHeight - viewportPadding * 2)
    const expectedHeight = Math.min(maxHeight, Math.max(72, options.length * 44 + 12))
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding
    const openBelow = availableBelow >= Math.min(expectedHeight, 220)
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportPadding * 2)
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    )
    const top = openBelow
      ? Math.min(rect.bottom + gap, window.innerHeight - expectedHeight - viewportPadding)
      : Math.max(viewportPadding, rect.top - expectedHeight - gap)
    Object.assign(listbox.style, {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
    })
    if (positionVariables) {
      listbox.style.setProperty(positionVariables.left, `${left}px`)
      listbox.style.setProperty(positionVariables.top, `${top}px`)
      listbox.style.setProperty(positionVariables.width, `${width}px`)
      listbox.style.setProperty(positionVariables.maxHeight, `${maxHeight}px`)
    }
  }, [options.length, positionVariables])

  useLayoutEffect(() => {
    if (!open) return undefined
    const nextIndex = selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? 0)
    setActiveIndex(nextIndex)
    updatePosition()
    const frame = window.requestAnimationFrame(() => {
      updatePosition()
      listboxRef.current?.focus()
      listboxRef.current
        ?.querySelector<HTMLElement>(`[data-arena-option-index="${nextIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    const onLayoutChange = (): void => updatePosition()
    window.addEventListener('resize', onLayoutChange)
    document.addEventListener('scroll', onLayoutChange, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', onLayoutChange)
      document.removeEventListener('scroll', onLayoutChange, true)
    }
  }, [enabledIndexes, open, selectedIndex, updatePosition])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [close, open])

  useEffect(() => {
    if (!open) return
    listboxRef.current
      ?.querySelector<HTMLElement>(`[data-arena-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  useEffect(
    () => () => {
      if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current)
    },
    [],
  )

  const handleTypeahead = (key: string): void => {
    if (key.length !== 1 || key.trim().length === 0) return
    typeahead.current += key.toLocaleLowerCase()
    if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current)
    typeaheadTimer.current = window.setTimeout(() => {
      typeahead.current = ''
    }, 650)
    const match = options.findIndex(
      (option) => !option.disabled && option.label.toLocaleLowerCase().includes(typeahead.current),
    )
    if (match >= 0) setActiveIndex(match)
  }

  const handleKey = (event: React.KeyboardEvent, listbox: boolean): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else moveActive(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(enabledIndexes[0] ?? 0)
    } else if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(enabledIndexes.at(-1) ?? 0)
    } else if (listbox && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      selectIndex(activeIndex)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    } else if (listbox && event.key === 'Tab') {
      close(false)
    } else {
      handleTypeahead(event.key)
    }
  }

  const portal = portalContainer ?? (typeof document === 'undefined' ? null : document.body)
  return (
    <div className={classNames.root} data-disabled={disabled} data-open={open}>
      <button
        ref={triggerRef}
        className={classNames.trigger}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        data-value={value}
        disabled={disabled}
        role="combobox"
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => handleKey(event, false)}
      >
        <span data-placeholder={!selected}>
          {selected?.content ?? selected?.label ?? placeholder}
        </span>
        {triggerIndicator}
      </button>
      {open && portal
        ? createPortal(
            <div className={classNames.layer}>
              <div
                ref={listboxRef}
                className={classNames.listbox}
                id={listboxId}
                aria-label={ariaLabel}
                aria-activedescendant={`${listboxId}-option-${activeIndex}`}
                role="listbox"
                tabIndex={-1}
                onKeyDown={(event) => handleKey(event, true)}
              >
                {options.length === 0 ? (
                  <div className={classNames.empty}>{emptyLabel}</div>
                ) : (
                  options.map((option, index) => (
                    <div
                      className={classNames.option}
                      id={`${listboxId}-option-${index}`}
                      aria-disabled={option.disabled}
                      aria-selected={option.value === value}
                      data-active={index === activeIndex}
                      data-arena-option-index={index}
                      data-disabled={option.disabled}
                      key={option.value}
                      role="option"
                      onClick={() => selectIndex(index)}
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerEnter={() => {
                        if (!option.disabled) setActiveIndex(index)
                      }}
                    >
                      <span>{option.content ?? option.label}</span>
                      {option.value === value ? selectedIndicator : null}
                    </div>
                  ))
                )}
              </div>
            </div>,
            portal,
          )
        : null}
    </div>
  )
}
