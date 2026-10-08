/** A screen asks the Search tab to focus its field; the tab takes the request when it next gains focus. */
let pending = false;

export function requestSearchFocus(): void {
  pending = true;
}

export function takeSearchFocusRequest(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}
