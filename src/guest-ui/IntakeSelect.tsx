// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';
import {addOther, addOtherState, listChoices, removeValue, selectionLabel, toggleChoice} from './searchable-selection';
import {OTHER_MAX_ENTRIES, OTHER_MAX_LENGTH} from './signup-catalogue';
import type {GuestCopy} from './copy';
import {focusFormField, revealWithin, visibleFormBounds} from './form-focus';

type Option = {value: string; label: string};
/** Renderer-independent version of the signup's searchable selection control. */
export function IntakeSelect({name, label, options, values, exclusive = [], multiple = true, allowOther = false, otherValues, invalid = false, locale, copy, onChange}: {
  name: string; label: string; options: readonly Option[]; values: string[]; exclusive?: readonly string[]; multiple?: boolean; allowOther?: boolean; otherValues?: readonly string[]; invalid?: boolean; locale?: string; copy: GuestCopy; onChange(values: string[]): void;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(-1);
  const listing = listChoices(options, exclusive, query, locale, otherValues);
  const addState = allowOther ? addOtherState(options, values, query) : 'hidden';
  const limitError = addState === 'tooLong' ? copy.entryTooLong.replace('{{max}}', String(OTHER_MAX_LENGTH))
    : addState === 'tooMany' ? copy.tooManyEntries.replace('{{max}}', String(OTHER_MAX_ENTRIES)) : '';
  const rows = [...listing.pinned, ...listing.listed].map(option => ({...option, add: false}));
  if (addState === 'available') rows.push({value: '__add__', label: copy.addOption.replace('{{item}}', query.trim()), add: true});
  useLayoutEffect(() => {
    if (!open) return;
    const field = root.current, panel = popup.current, choices = list.current;
    const doc = field?.ownerDocument, win = doc?.defaultView;
    const body = field?.closest<HTMLElement>('.guest-overlay-body');
    if (!field || !panel || !choices || !doc || !win || !body) return;
    let scheduled = 0;
    const previousRoom = body.style.getPropertyValue('--guest-picker-scroll-room');
    // Inline expansion follows the existing embedded form. Fit and reveal the
    // whole picker, including Done, within the chat and the visible keyboard area.
    const fit = () => {
      scheduled = 0;
      if (!panel.isConnected || !field.getClientRects().length) return;
      const box = visibleFormBounds(body, 12), available = box.bottom - box.top;
      if (available <= 0) return; // The host website may have scrolled the whole widget off-screen.
      // Filtering must not remove scroll room when only part of the chat is on-screen.
      const hiddenBottom = Math.max(0, body.getBoundingClientRect().bottom - box.bottom);
      body.style.setProperty('--guest-picker-scroll-room', Math.ceil(hiddenBottom) + 'px');
      const chrome = panel.offsetHeight - choices.offsetHeight;
      const prefix = (trigger.current?.offsetHeight ?? 44) + 8;
      const maximum = Math.max(44, Math.min(win.matchMedia('(max-width:640px)').matches ? 200 : 240, available - chrome - prefix));
      choices.style.maxHeight = `${maximum}px`;
      revealWithin(body, panel, 12);
      const button = trigger.current?.getBoundingClientRect(), rect = panel.getBoundingClientRect();
      if (button && rect.bottom - button.top <= available && button.top < box.top) body.scrollTop += button.top - box.top;
    };
    const schedule = () => {if (!scheduled) scheduled = win.requestAnimationFrame(fit);};
    search.current?.focus({preventScroll: true});
    fit();
    const observer = new ResizeObserver(schedule); observer.observe(body); observer.observe(panel); observer.observe(field);
    win.addEventListener('resize', schedule); win.addEventListener('scroll', schedule, {passive: true}); win.visualViewport?.addEventListener('resize', schedule); win.visualViewport?.addEventListener('scroll', schedule);
    const close = (event: PointerEvent) => {if (root.current && !event.composedPath().includes(root.current)) setOpen(false);};
    doc.addEventListener('pointerdown', close);
    return () => {
      observer.disconnect(); if (scheduled) win.cancelAnimationFrame(scheduled);
      if (previousRoom) body.style.setProperty('--guest-picker-scroll-room', previousRoom);
      else body.style.removeProperty('--guest-picker-scroll-room');
      win.removeEventListener('resize', schedule); win.removeEventListener('scroll', schedule); win.visualViewport?.removeEventListener('resize', schedule); win.visualViewport?.removeEventListener('scroll', schedule);
      doc.removeEventListener('pointerdown', close);
    };
  }, [open]);
  useLayoutEffect(() => {if (list.current) list.current.scrollTop = 0;}, [query]);
  function close() {
    setOpen(false);
    root.current?.ownerDocument.defaultView?.requestAnimationFrame(() => focusFormField(trigger.current));
  }
  function choose(value: string) {
    const selected = value === '__add__' ? addOther(values, query, options, exclusive) : multiple ? toggleChoice(values, value, exclusive) : [value];
    onChange(selected); setActive(-1);
    if (value === '__add__') setQuery('');
    if (!multiple) close(); else search.current?.focus({preventScroll: true});
  }
  function keys(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!open) {
      if (event.target === trigger.current && ['ArrowDown', 'ArrowUp'].includes(event.key)) {event.preventDefault(); setOpen(true); setQuery(''); setActive(-1);}
      return;
    }
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(); return;}
    if (event.key === 'Tab') {
      const done = popup.current?.querySelector<HTMLButtonElement>('.guest-select-done button');
      if (event.target === search.current || event.target === done) {
        event.preventDefault();
        if (event.target === search.current && !event.shiftKey) {done?.focus({preventScroll: true}); return;}
        if (event.target === done && event.shiftKey) {search.current?.focus({preventScroll: true}); return;}
        if (event.shiftKey) {close(); return;}
        const scope = root.current?.closest('.guest-overlay');
        const controls = Array.from(scope?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]') ?? [])
          .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length && !popup.current?.contains(element));
        const next = controls[controls.indexOf(trigger.current!) + 1];
        setOpen(false);
        root.current?.ownerDocument.defaultView?.requestAnimationFrame(() => focusFormField(next ?? trigger.current));
        return;
      }
    }
    if (event.target !== search.current) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const next = !rows.length ? -1 : active < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      setActive(next);
      if (next >= 0) revealWithin(list.current, list.current?.querySelectorAll<HTMLElement>('[role="option"]')[next] ?? null);
    }
    if (event.key === 'Enter') {event.preventDefault(); if (rows[active >= 0 ? active : 0]) choose(rows[active >= 0 ? active : 0].value);}
  }
  return <div className="guest-select" data-guest-select={name} ref={root} onKeyDown={keys}
    onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);}}>
    <span className="guest-select-label" id={`${id}-label`}>{label}</span>
    {multiple && values.length > 0 && <ul className="guest-select-chips" aria-label={`${label}: ${copy.selectedOptions}`}>{values.map(value => <li className="guest-select-chip" key={value}><span>{selectionLabel(value, options)}</span><button type="button" aria-label={copy.removeOption.replace('{{item}}', selectionLabel(value, options))} onClick={() => {
      onChange(removeValue(values, value));
      root.current?.ownerDocument.defaultView?.requestAnimationFrame(() => focusFormField(open ? search.current : trigger.current));
    }}>×</button></li>)}</ul>}
    <button ref={trigger} className="guest-select-trigger" type="button" data-has-value={!multiple && !!values[0]} aria-labelledby={`${id}-label${!multiple && values[0] ? ` ${id}-value` : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} aria-controls={open ? `${id}-list` : undefined} onClick={() => {if (open) close(); else {setOpen(true); setQuery(''); setActive(-1);}}}><span id={`${id}-value`}>{!multiple && values[0] ? selectionLabel(values[0], options) : copy.choose}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="guest-select-popup" ref={popup}>
      <div className="guest-select-search"><input ref={search} role="combobox" aria-labelledby={`${id}-label`} aria-invalid={!!limitError || undefined} aria-describedby={limitError ? id + "-limit" : undefined} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={active >= 0 && rows[active] ? `${id}-option-${active}` : undefined} autoComplete="off" placeholder={allowOther ? copy.searchOrAddOptions : copy.searchOptions} value={query} onChange={event => {setQuery(event.target.value); setActive(-1);}}/></div>
      <div className="guest-select-options" ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} aria-multiselectable={multiple || undefined}>{rows.map((row, index) => <button type="button" className="guest-select-option" id={`${id}-option-${index}`} key={row.value} role="option" aria-selected={values.includes(row.value)} tabIndex={-1} data-value={row.value} data-active={active === index} onPointerMove={event => {if (event.pointerType === 'mouse') setActive(index);}} onMouseDown={event => event.preventDefault()} onClick={() => choose(row.value)}><span>{row.label}</span><span aria-hidden="true">{row.add ? '+' : values.includes(row.value) ? '✓' : ''}</span></button>)}</div>
      {!rows.length && !limitError && <p className="guest-hint" role="status">{copy.noOptions}</p>}
      {limitError && <p className="guest-field-error" role="status" id={id + '-limit'}>{limitError}</p>}
      <div className="guest-select-done"><button type="button" onClick={close}>{copy.doneSelecting}</button></div>
    </div>}
    {invalid && <p className="guest-field-error" id={`${id}-error`}>{copy.choose}</p>}
  </div>;
}
