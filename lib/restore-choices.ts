// React 19 resets a form after its action runs. Controlled text fields get their
// values back, but a <select>, radio or checkbox falls back to how the page first
// rendered while React still holds the newer choice, so the screen shows the old
// one and the next submit sends it. Each form calls this after every submit to put
// those fields back from its state.
export function restoreChoices(form: HTMLFormElement | null, values: Record<string, unknown>): void {
  if (!form) return;
  const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'select, input[type="radio"], input[type="checkbox"]',
  );
  for (const field of fields) {
    if (!(field.name in values)) continue;
    const value = values[field.name];
    if (field instanceof HTMLSelectElement) field.value = String(value);
    else if (field.type === "radio") field.checked = field.value === String(value);
    else field.checked = Boolean(value);
  }
}
