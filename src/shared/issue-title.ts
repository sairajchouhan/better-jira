/**
 * An issue's title limit, one rule for every place a title is typed, pasted or made (the issue's title, both composers,
 * pending sub-issue rows, Create issue from selection) and for the server before it writes. Linear's issue model stops
 * titles at its `maxTitleLength` (startup-entry `ad.maxTitleLength=512`) through the title editor's `nativeInputBehavior`
 * (startup-root `eZe.filterTransaction`): typing past it is refused, a paste is cut to fit, and a title already longer may
 * only get shorter. Jira's summary stops at 255 (Java string length: UTF-16 units, as JavaScript's), so that is the limit here.
 */
export const TITLE_MAX = 255;
/** Linear's wording (`uQ`: `${propertyName} cannot be longer than ${maxLength} characters.`), with Jira's limit. */
export const TITLE_TOO_LONG = `Title cannot be longer than ${TITLE_MAX} characters.`;

/** A title made from other text (a selection, a comment), cut to the limit without splitting a surrogate pair. */
export function fitTitle(text: string): string {
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Whether inserting `inserted` over the field's selection would take the title past the limit (and so is cut or refused). */
export function passesTitleLimit(field: { length: number; start: number; end: number }, inserted: string): boolean {
  return field.length - Math.abs(field.end - field.start) + inserted.length > TITLE_MAX;
}
