// J1.8/J1.9 — the value matrix both the round-trip test (parse.test.ts) and the cross-emitter byte
// comparison (emitters.test.ts) share. A FIXTURE, not shipped behaviour: lifted from the reference's
// own emitter test plus the locale case this plan found.
//
// The non-ASCII half needs three values, not one: İ (U+0130) and ā (U+0101) both render BARE under
// bash's en_US.UTF-8 collation and QUOTED on the TypeScript side — the divergence J1.9 exists to
// catch. é does NOT fire (QUOTED everywhere) and is kept for plain coverage. ŉ (U+0149) does NOT
// fire either, despite sitting inside the same Unicode block as İ/ā — a negative control, so the fix
// is never generalised into a block range and the bug reintroduced from the other side.
export const VALUE_MATRIX: readonly string[] = [
  "plain",
  "a-b_c.d/e:f@g#h+i",
  "",
  "has space",
  'has "quote"',
  "back\\slash",
  "comma,list",
  "star*",
  "tilde~",
  "50%",
  "a=b",
  "100%%",
  "%s",
  "café",
  "İ",
  "ā",
  "ŉ",
  "→",
  "😀",
  "3",
  "-",
  "_",
  "tab\there",
  "cr\rhere",
  "two\nlines",
];
