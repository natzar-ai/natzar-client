// GENERATED FILE — edit frontend/guest or shared/jurisdictions.ts, then run sync-contract.
// flowbite-datepicker ships no types. Only the surface DateOfBirthPicker uses
// is declared here — the full option set lives in the package's docs
// (https://flowbite.com/docs/components/datepicker/).
declare module "flowbite-datepicker/Datepicker" {
  export interface DatepickerLocale {
    days: string[];
    daysShort: string[];
    daysMin: string[];
    months: string[];
    monthsShort: string[];
    today: string;
    clear: string;
    weekStart: number;
    format: string;
  }

  export interface DatepickerOptions {
    language?: string;
    format?: string;
    autohide?: boolean;
    todayBtn?: boolean;
    clearBtn?: boolean;
    maxDate?: Date;
    minDate?: Date;
    defaultViewDate?: Date;
    // 0: days, 1: months, 2: years, 3: decades.
    startView?: 0 | 1 | 2 | 3;
    orientation?: string;
    prevArrow?: string;
    nextArrow?: string;
  }

  export default class Datepicker {
    static locales: Record<string, DatepickerLocale>;
    constructor(element: HTMLElement, options?: DatepickerOptions);
    // The calendar itself, which the picker appends to `document.body`. Not part
    // of the documented API, but the only handle on the element — and the touch
    // placement has to move it, which no option can express.
    picker: {element: HTMLElement};
    getDate(format?: string): string | Date | undefined;
    setDate(date: Date | string, options?: {render?: boolean}): void;
    destroy(): void;
  }
}
