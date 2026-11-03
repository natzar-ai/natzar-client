// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
import {forwardRef, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import PhoneInputWithCountry, {getCountries, getCountryCallingCode, isSupportedCountry, type Country, type FlagProps} from 'react-phone-number-input';
import {COUNTRY_FLAG_ASSETS, COUNTRY_FLAG_BASE_URL} from './country-flag-assets';
import {revealWithin} from './form-focus';
import {historyCopy} from './history-copy';

type Option = {value?: Country; label: string; divider?: boolean};
type PickerProps = {
  value?: Country; options: Option[]; onChange(value?: Country): void;
  disabled?: boolean; readOnly?: boolean; tabIndex?: number; onFocus?(): void; onBlur?(): void;
  iconComponent: ComponentType<{country?: Country; label: string; 'aria-hidden'?: boolean}>;
  open: boolean; setOpen(value: boolean): void; locale: string;
  container(): HTMLElement | null; complete(): void;
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function CountryFlag({country, countryName}: FlagProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [country]);
  const asset = COUNTRY_FLAG_ASSETS[country];
  const fallback = String.fromCodePoint(...[...country].map(letter => 0x1f1e6 + letter.charCodeAt(0) - 65));
  return <span className="guest-phone-flag" aria-hidden="true">{asset && !failed
    ? <img src={`${COUNTRY_FLAG_BASE_URL}${asset}`} alt={countryName} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : fallback}</span>;
}

/** The form's country/search/calling-code pattern, contained in the chat card. */
function CountryPicker({value, options, onChange, disabled, readOnly, tabIndex, onFocus, onBlur, iconComponent: Icon, open, setOpen, locale, container, complete}: PickerProps) {
  const copy = historyCopy(locale), [search, setSearch] = useState('');
  const searchField = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const selected = options.find(option => !option.divider && option.value === value);
  const matches = useMemo(() => options.filter(option => !option.divider && normalize(`${option.label} ${option.value ?? ''} ${option.value ? '+' + getCountryCallingCode(option.value) : ''}`).includes(normalize(search.trim()))), [options, search]);
  useEffect(() => {if (open) {searchField.current?.focus({preventScroll: true});}}, [open]);
  useEffect(() => {if (open && !search) revealWithin(list.current, list.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null, 4);}, [open, search, value]);
  function close() {setOpen(false); onBlur?.(); requestAnimationFrame(complete);}
  function move(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    if (!items.length) return;
    const root = list.current?.getRootNode() as Document | ShadowRoot;
    const index = items.findIndex(item => item === root.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus({preventScroll: true}); revealWithin(list.current, items[next], 4);
  }
  const target = open ? container() : null;
  return <>
    <button type="button" className="guest-phone-country-trigger" disabled={disabled || readOnly} tabIndex={tabIndex} onFocus={onFocus}
      aria-label={copy.country + ': ' + (selected?.label ?? copy.international)} aria-haspopup="dialog" aria-expanded={open} onClick={() => {setSearch(''); setOpen(true);}}>
      <Icon country={value} label={selected?.label ?? ''} aria-hidden/><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {target && createPortal(<div className="guest-phone-country-picker" role="dialog" aria-label={copy.country}
      onClick={event => event.stopPropagation()} onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close();}}}>
      <div className="guest-phone-country-heading"><button type="button" aria-label={copy.back} onClick={close}>←</button><h3>{copy.country}</h3></div>
      <div className="guest-phone-country-search"><input ref={searchField} type="search" value={search} autoComplete="off" aria-label={copy.searchCountry} placeholder={copy.searchCountry}
        onChange={event => setSearch(event.target.value)} onKeyDown={event => {if (event.key === 'ArrowDown') move(event);}}/></div>
      <div ref={list} className="guest-phone-country-list" role="listbox" aria-label={copy.country} onKeyDown={move}>
        {!matches.length && <p role="status">{copy.noCountry}</p>}
        {matches.map((option, index) => <button key={option.value ?? 'ZZ'} type="button" role="option" aria-selected={option.value === value} tabIndex={option.value === value || !matches.some(item => item.value === value) && index === 0 ? 0 : -1}
          onClick={() => {onChange(option.value); close();}}><Icon country={option.value} label={option.label} aria-hidden/><span>{option.label}</span><small>{option.value ? '+' + getCountryCallingCode(option.value) : ''}</small><span aria-hidden="true">{option.value === value ? '✓' : ''}</span></button>)}
      </div>
    </div>, target)}
  </>;
}

export const GuestPhoneInput = forwardRef<HTMLInputElement, {
  id: string; value: string; onChange(value: string): void; locale: string; disabled: boolean; invalid: boolean; describedBy?: string; readOnly?: boolean;
  pickerOpen: boolean; onPickerOpen(value: boolean): void; container(): HTMLElement | null;
}>(function GuestPhoneInput({id, value, onChange, locale, disabled, invalid, describedBy, pickerOpen, onPickerOpen, container, readOnly}, ref) {
  const copy = historyCopy(locale), input = useRef<HTMLInputElement | null>(null);
  const [defaultCountry] = useState<Country>(() => {
    const languages = typeof navigator === 'undefined' ? [] : [...navigator.languages, navigator.language];
    for (const language of languages) {
      try {const region = new Intl.Locale(language).maximize().region; if (region && isSupportedCountry(region)) return region as Country;} catch { /* Try the next browser locale. */ }
    }
    return 'US';
  });
  const labels = useMemo(() => {
    let names: Intl.DisplayNames;
    try {names = new Intl.DisplayNames([locale.replace('_', '-')], {type: 'region'});} catch {names = new Intl.DisplayNames(['en'], {type: 'region'});}
    return {...Object.fromEntries(getCountries().map(country => [country, names.of(country) ?? country])), country: copy.country, phone: copy.phone, ZZ: copy.international};
  }, [locale, copy.country, copy.phone, copy.international]);
  return <PhoneInputWithCountry id={id} name="phone" className="guest-phone-input" international defaultCountry={defaultCountry}
    value={value || undefined} onChange={next => onChange(next ?? '')} disabled={disabled} readOnly={readOnly} autoComplete="tel" labels={labels}
    flagComponent={CountryFlag} countrySelectComponent={CountryPicker} smartCaret={false} limitMaxLength focusInputOnCountrySelection={false}
    // The library forwards its DOM input at runtime; its public type names the internal class.
    ref={element => {const field = element as unknown as HTMLInputElement | null; input.current = field; if (typeof ref === 'function') ref(field); else if (ref) ref.current = field;}}
    countrySelectProps={{locale, readOnly, open: pickerOpen, setOpen: onPickerOpen, container, complete: () => {const field = input.current; if (!field) return; const root = field.getRootNode() as Document | ShadowRoot; if (root.activeElement === field) return; field.focus({preventScroll: true}); field.setSelectionRange(field.value.length, field.value.length);}}}
    numberInputProps={{name: 'phone', 'aria-label': copy.phone, inputMode: 'tel', required: true, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy}}/>;
});
