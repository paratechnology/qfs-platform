/** Normalize decimal digits used by the published scripts without numeric coercion. */
export function normalizeDecimalDigits(input: string): string {
  const zeroes = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0e50, 0xff10];
  return input.replace(/[٠-٩۰-۹०-९০-৯๐-๙０-９]/g, digit => {
    const point = digit.codePointAt(0)!;
    return String(point - zeroes.find(zero => point >= zero && point <= zero + 9)!);
  });
}

/** Parse the selected language's decimal notation without guessing ambiguous separators. */
export function parseDecimal(input: string, locale: string, maxFractionDigits = 2): number | null {
  const formatter = new Intl.NumberFormat(locale, {useGrouping:"always"});
  const parts = formatter.formatToParts(1000000.5);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const group = parts.find((part) => part.type === "group")?.value;
  let value = input.trim().replace(/[\u061c\u200e\u200f]/g, "");
  const normalizeDigits = normalizeDecimalDigits;
  value = normalizeDigits(value);
  if (["ar", "ur", "fa"].includes(locale.split("-")[0])) {
    value = value.replace(/٫/g, decimal).replace(/٬/g, group ?? ",");
  }
  if (group === "\u00a0" || group === "\u202f") value = value.replace(/[ \u00a0\u202f]/g, group);
  if (decimal !== "." && group !== ".") value = value.replace(/\./g, decimal);
  const sign = value.startsWith("-") ? -1 : 1;
  const unsigned = value.replace(/^[+-]/, "");
  const segments = unsigned.split(decimal);
  if (segments.length > 2) return null;
  let integer = segments[0];
  if (group && integer.includes(group)) {
    const digits = integer.split(group).join("");
    if (!/^\d{1,16}$/.test(digits)) return null;
    const canonical = formatter.formatToParts(BigInt(digits)).filter((part) => part.type === "integer" || part.type === "group").map((part) => part.value).join("");
    const normalized = normalizeDigits(canonical);
    if (integer !== normalized) return null;
    integer = digits;
  }
  if (!/^\d{1,16}$/.test(integer)) return null;
  const fraction = segments[1];
  if (fraction !== undefined && (!/^\d+$/.test(fraction) || fraction.length > maxFractionDigits)) return null;
  const result = sign * Number(`${integer}${fraction !== undefined ? `.${fraction}` : ""}`);
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
}

/** Preserve the value of an entered amount when its display language changes. */
export function reformatDecimal(input: string, from: string, to: string, maxFractionDigits = 2): string {
  const amount = parseDecimal(input, from, maxFractionDigits);
  return amount === null ? input : new Intl.NumberFormat(to, {useGrouping:false, maximumFractionDigits:maxFractionDigits}).format(amount);
}
