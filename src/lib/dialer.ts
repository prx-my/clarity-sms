export function openDialer(number = '') {
  window.dispatchEvent(new CustomEvent<string>('clarity:dial', { detail: number }));
}
