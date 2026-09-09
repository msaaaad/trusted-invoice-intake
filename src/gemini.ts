import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";

export interface ExtractedLine {
  description: string;
  quantity: number | null;
  unit: string;
  unitPrice: number | null;
  amount: number;
  taxRatePercent: number;
}

export interface ExtractionResult {
  partnerNameRaw: string;
  invoiceNumber: string;
  issueDateRaw: string;
  dueDateRaw: string;
  currency: string;
  lines: ExtractedLine[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  extractionNotes: string[];
}

const responseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    partnerNameRaw: { type: SchemaType.STRING },
    invoiceNumber: { type: SchemaType.STRING },
    issueDateRaw: { type: SchemaType.STRING },
    dueDateRaw: { type: SchemaType.STRING },
    currency: { type: SchemaType.STRING },
    lines: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING },
          quantity: { type: SchemaType.NUMBER, nullable: true },
          unit: { type: SchemaType.STRING },
          unitPrice: { type: SchemaType.NUMBER, nullable: true },
          amount: { type: SchemaType.NUMBER },
          taxRatePercent: { type: SchemaType.NUMBER },
        },
        required: ["description", "unit", "amount", "taxRatePercent"],
      },
    },
    subtotal: { type: SchemaType.NUMBER },
    taxAmount: { type: SchemaType.NUMBER },
    totalAmount: { type: SchemaType.NUMBER },
    extractionNotes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: [
    "partnerNameRaw",
    "invoiceNumber",
    "issueDateRaw",
    "dueDateRaw",
    "currency",
    "lines",
    "subtotal",
    "taxAmount",
    "totalAmount",
    "extractionNotes",
  ],
};

const PROMPT = `You are extracting structured data from a Japanese business invoice (請求書 / 御請求書).

Read the attached document (it may be a native PDF, a scanned PDF, or a photographed/scanned image, and may include handwritten annotations, stamps, or corrections) and return the invoice's data as JSON matching the given schema.

Rules:
- Extract values exactly as printed. Do not calculate, round, or "correct" anything yourself.
- Dates: return them exactly as printed, in whatever format and calendar system is used (Western format like "2026年1月7日" or "2026/01/07", or Japanese era format like "令和8年2月5日"). Do not convert eras or reformat dates yourself.
- Supplier name (partnerNameRaw): the issuing company's name exactly as printed on the invoice. It may be a full legal name or an abbreviated/alias name - do not expand, translate, or normalize it.
- Line items: extract every line in the itemized table, including fees, shipping, and non-product charges.
  - quantity and unitPrice are often absent for lump-sum or service lines - use null rather than guessing a value.
  - If a line represents a discount or deduction (often marked with a triangle "△" before the amount, or otherwise shown as a subtraction), output its amount as a NEGATIVE number.
  - taxRatePercent is the consumption tax rate that applies to that line (10 or 8). If the invoice states one tax rate for the whole invoice rather than per line, apply that same rate to every line. If different lines are taxed at different rates, assign each line its correct rate.
- subtotal, taxAmount, and totalAmount are the invoice's own printed summary figures - report them as printed, even if they look inconsistent with the line items (a downstream step checks that separately).
- extractionNotes: flag anything you are not fully confident about - handwriting, a crossed-out or corrected value, a stamp overlapping text, a smudged or ambiguous figure, or any field you could not read with certainty. If everything is clear, return an empty array.

Return ONLY the JSON object described by the schema, no extra commentary.`;

export async function extractInvoice(fileBuffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const result = await model.generateContent([
    { inlineData: { data: fileBuffer.toString("base64"), mimeType } },
    { text: PROMPT },
  ]);

  return JSON.parse(result.response.text()) as ExtractionResult;
}
