// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import Datepicker from 'flowbite-datepicker/Datepicker';
import {BIRTHDATE_NEXT_ARROW, BIRTHDATE_PREV_ARROW, ISO_FORMAT, OLDEST, registerLocale} from './birthdate-calendar';
import {historyCopy} from './history-copy';

const YEARS_PER_PAGE = 20;
const DEFAULT_LAST_YEAR = 2009;

/** The patient interface's Flowbite calendar and locale rules, contained in the chat dialog. */
export function BirthdateInput({id, value, onChange, disabled, locale, label, invalid, describedBy, container, onOpenChange}: {
  id: string; value: string; onChange(value: string): void; disabled: boolean; locale: string; label: string;
  invalid?: boolean; describedBy?: string; container(): HTMLElement | null; onOpenChange(value: boolean): void;
}) {
  const [open, setOpen] = useState(false), input = useRef<HTMLInputElement>(null), host = useRef<HTMLDivElement>(null);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number | null>(null), [lastYear, setLastYear] = useState(DEFAULT_LAST_YEAR);
  const firstYear = lastYear - YEARS_PER_PAGE + 1;
  const showYears = (selectedYear: number) => {
    setLastYear(DEFAULT_LAST_YEAR + Math.ceil((selectedYear - DEFAULT_LAST_YEAR) / YEARS_PER_PAGE) * YEARS_PER_PAGE);
    setYear(null);
  };
  const openCalendar = () => {showYears(value ? Number(value.slice(0, 4)) : DEFAULT_LAST_YEAR); setOpen(true); onOpenChange(true);};
  const change = useRef(onChange); useEffect(() => {change.current = onChange;}, [onChange]);
  const copy = historyCopy(locale), tag = locale.replace('_', '-');
  const close = () => {setOpen(false); onOpenChange(false); requestAnimationFrame(() => input.current?.focus({preventScroll: true}));};
  useEffect(() => {
    if (!open || year === null || !host.current) return;
    const picker = new Datepicker(host.current, {language: registerLocale(tag), startView: 1, autohide: false, todayBtn: false, clearBtn: false,
      prevArrow: BIRTHDATE_PREV_ARROW, nextArrow: BIRTHDATE_NEXT_ARROW,
      minDate: OLDEST, maxDate: new Date(), defaultViewDate: new Date(year, 0, 1)});
    if (value) picker.setDate(new Date(value + 'T12:00:00'), {render: false});
    const picked = () => {change.current(String(picker.getDate(ISO_FORMAT) ?? '')); setOpen(false); onOpenChange(false); requestAnimationFrame(() => input.current?.focus({preventScroll: true}));};
    const node = host.current;
    const viewChanged = (event: Event) => {
      const {viewId, viewDate} = (event as CustomEvent<{viewId: number; viewDate: Date}>).detail;
      if (viewId === 2) showYears(viewDate.getFullYear());
    };
    node.addEventListener('changeDate', picked);
    node.addEventListener('changeView', viewChanged);
    const enhance = () => node.querySelectorAll<HTMLElement>('.datepicker-cell').forEach(cell => {cell.tabIndex = cell.classList.contains('disabled') ? -1 : 0; cell.setAttribute('role', 'button'); cell.setAttribute('aria-disabled', String(cell.classList.contains('disabled')));});
    enhance(); const observer = new MutationObserver(enhance); observer.observe(node, {childList: true, subtree: true});
    return () => {observer.disconnect(); node.removeEventListener('changeDate', picked); node.removeEventListener('changeView', viewChanged); picker.destroy();};
    // Rebuilding while the parent timer ticks would discard the current year/month view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tag, year]);
  const target = open ? container() : null;
  const shown = value ? new Intl.DateTimeFormat(tag, {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value + 'T12:00:00')) : '';
  return <>
    <div className="guest-birthdate-input"><input ref={input} id={id} name="birthdate" aria-label={label} type="text" readOnly required autoComplete="bday" value={shown} placeholder={label}
      disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-haspopup="dialog" aria-expanded={open}
      onClick={openCalendar} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {event.preventDefault(); openCalendar();}}}/>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg></div>
    {target && createPortal(<section className="guest-calendar-layer" role="dialog" aria-label={label} onClick={event => event.stopPropagation()}
      onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();} else if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).classList.contains('datepicker-cell')) {event.preventDefault(); (event.target as HTMLElement).click();}}}>
      <header><button type="button" aria-label={copy.back} onClick={close}>←</button><h3>{label}</h3></header>
      <div className="guest-birthdate-calendar">
        {year === null ? <div className="datepicker">
          <div className="datepicker-controls">
            <button type="button" className="prev-btn" aria-label={`${firstYear - YEARS_PER_PAGE}–${lastYear - YEARS_PER_PAGE}`} disabled={firstYear <= OLDEST.getFullYear()} onClick={() => setLastYear(lastYear - YEARS_PER_PAGE)} dangerouslySetInnerHTML={{__html: BIRTHDATE_PREV_ARROW}}/>
            <span className="view-switch" style={{textAlign: 'center'}} aria-live="polite">{firstYear}–{lastYear}</span>
            <button type="button" className="next-btn" aria-label={`${firstYear + YEARS_PER_PAGE}–${lastYear + YEARS_PER_PAGE}`} disabled={lastYear >= currentYear} onClick={() => setLastYear(lastYear + YEARS_PER_PAGE)} dangerouslySetInnerHTML={{__html: BIRTHDATE_NEXT_ARROW}}/>
          </div>
          <div className="years datepicker-grid">{Array.from({length: YEARS_PER_PAGE}, (_, index) => firstYear + index).map(option => <button type="button" key={option} data-year={option}
            className={`datepicker-cell year${value.startsWith(String(option)) ? ' selected' : ''}${option < OLDEST.getFullYear() || option > currentYear ? ' disabled' : ''}`} disabled={option < OLDEST.getFullYear() || option > currentYear} onClick={() => setYear(option)}>{option}</button>)}</div>
        </div> : <div ref={host}/>}
      </div>
    </section>, target)}
  </>;
}
