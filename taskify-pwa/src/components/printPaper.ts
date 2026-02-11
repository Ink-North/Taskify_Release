export type PrintPaperSize = "letter" | "a6";

export const PRINT_PAPER_OPTIONS: Array<{
  value: PrintPaperSize;
  label: string;
  shortLabel: string;
  widthMm: number;
  heightMm: number;
}> = [
  {
    value: "letter",
    label: "Letter (8.5 x 11 in)",
    shortLabel: "Letter",
    widthMm: 215.9,
    heightMm: 279.4,
  },
  {
    value: "a6",
    label: "A6 (105 x 148 mm)",
    shortLabel: "A6",
    widthMm: 105,
    heightMm: 148,
  },
];

const PRINT_PAPER_LOOKUP = PRINT_PAPER_OPTIONS.reduce<Record<PrintPaperSize, typeof PRINT_PAPER_OPTIONS[number]>>(
  (acc, option) => {
    acc[option.value] = option;
    return acc;
  },
  {} as Record<PrintPaperSize, typeof PRINT_PAPER_OPTIONS[number]>,
);

export function getPaperDefinition(paperSize: PrintPaperSize) {
  return PRINT_PAPER_LOOKUP[paperSize];
}

export function isPrintPaperSize(value: unknown): value is PrintPaperSize {
  return value === "letter" || value === "a6";
}
