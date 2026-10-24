import { parsePhoneNumberFromString } from 'libphonenumber-js';
export function normalizePhone(value: string): string | null {
  const phone = parsePhoneNumberFromString(value, 'US');
  return phone?.isValid() ? phone.number : null;
}
export function displayPhone(value: string): string {
  return parsePhoneNumberFromString(value)?.formatInternational() ?? value;
}
