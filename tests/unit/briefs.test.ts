import { it, expect } from "vitest";
import { extractText } from "../../packages/google-mcp/src/index.js";
function pdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 500] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 12 Tf 30 400 Td (Fictitious test brief) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((x) => String(x).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
it("extracts a real test PDF in the bounded parser process", async () => {
  expect(await extractText(pdfFixture(), "application/pdf")).toContain(
    "Fictitious test brief",
  );
});
it("rejects malformed PDF data without fabricating text", async () => {
  await expect(
    extractText(Buffer.from("invalid PDF"), "application/pdf"),
  ).rejects.toThrow(/could not be parsed/);
});
it("returns plain untrusted text without executing HTML", async () => {
  expect(
    await extractText(
      Buffer.from("<script>bad()</script><p>Brief text</p>"),
      "text/html",
    ),
  ).toContain("Brief text");
  expect(
    await extractText(
      Buffer.from("<script>bad()</script><p>Brief text</p>"),
      "text/html",
    ),
  ).not.toContain("bad()");
});
