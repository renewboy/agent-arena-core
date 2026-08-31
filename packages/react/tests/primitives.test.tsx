// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog, Dialog, Select } from '../src/index.js'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => cleanup())

describe('Select', () => {
  it('supports keyboard navigation, disabled options, selection, and focus restore', async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    render(
      <Select
        ariaLabel="Game"
        emptyLabel="No options"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two', disabled: true },
          { value: 'three', label: 'Three', content: <strong>Third</strong> },
        ]}
        placeholder="Choose"
        selectedIndicator="selected"
        triggerIndicator="open"
        value=""
        onChange={change}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Game' })
    await user.click(trigger)
    const listbox = screen.getByRole('listbox', { name: 'Game' })
    expect(listbox.style.position).toBe('fixed')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(change).toHaveBeenCalledWith('three')
    expect(trigger).toHaveFocus()
  })

  it('supports Home, End, typeahead, Escape, Tab, outside click, and empty state', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Select
        ariaLabel="Choice"
        emptyLabel="Nothing"
        options={[
          { value: 'alpha', label: 'Alpha' },
          { value: 'beta', label: 'Beta' },
        ]}
        value="alpha"
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Choice' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'End' })
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-1'))
    fireEvent.keyDown(listbox, { key: 'Home' })
    fireEvent.keyDown(listbox, { key: 'b' })
    expect(listbox).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-1'))
    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    await user.click(trigger)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull()
    await user.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()

    rerender(
      <Select ariaLabel="Choice" emptyLabel="Nothing" options={[]} value="" onChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Choice' }))
    expect(screen.getByText('Nothing')).toBeInTheDocument()
  })

  it('does not open or select while disabled', async () => {
    const user = userEvent.setup()
    const change = vi.fn()
    render(
      <Select
        ariaLabel="Disabled"
        disabled
        options={[{ value: 'one', label: 'One' }]}
        value=""
        onChange={change}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Disabled' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(change).not.toHaveBeenCalled()
  })
})

describe('Dialog', () => {
  it('traps focus, closes by Escape/backdrop, marks background inert, and restores focus', async () => {
    const close = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'outside'
    document.body.append(trigger)
    trigger.focus()
    const root = document.createElement('div')
    document.body.append(root)
    const view = render(
      <Dialog labelledBy="title" open inertTarget={root} onClose={close}>
        <h2 id="title">Dialog</h2>
        <button data-arena-dialog-action>First</button>
        <button data-arena-dialog-action>Last</button>
      </Dialog>,
    )
    await waitFor(() => expect(screen.getByText('First')).toHaveFocus())
    expect(root.inert).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Last')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(screen.getByText('First')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!)
    expect(close).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(root.inert).toBe(false)
    expect(trigger).toHaveFocus()
    trigger.remove()
    root.remove()
  })

  it('keeps a busy dialog open and handles a panel without focusable controls', () => {
    const close = vi.fn()
    render(
      <Dialog busy labelledBy="busy-title" open onClose={close}>
        <h2 id="busy-title">Busy</h2>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.keyDown(dialog, { key: 'Tab' })
    fireEvent.pointerDown(dialog.parentElement!)
    expect(close).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog', () => {
  it('injects copy/icon/classes and invokes cancel and confirm actions', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    const cancel = vi.fn()
    const { rerender } = render(
      <ConfirmDialog
        cancelLabel="Keep"
        classNames={{ panel: 'panel', confirmButton: 'confirm' }}
        confirmLabel="Delete"
        description="Permanent"
        icon="!"
        open
        title="Delete item"
        onCancel={cancel}
        onConfirm={confirm}
      />,
    )
    expect(screen.getByRole('alertdialog')).toHaveClass('panel')
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()

    rerender(
      <ConfirmDialog
        busy
        cancelLabel="Keep"
        confirmLabel="Delete"
        description="Permanent"
        open
        title="Delete item"
        onCancel={cancel}
        onConfirm={confirm}
      />,
    )
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(
      true,
    )
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
