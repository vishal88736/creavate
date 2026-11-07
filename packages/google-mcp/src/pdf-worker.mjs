// Parse untrusted PDFs in a short-lived process with a bounded JS heap.
// This process inherits no application credentials and never evaluates PDF JavaScript.
console.log = (...args) => console.error(...args);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 35000000) process.exit(2);
});
process.stdin.on("end", async () => {
  let doc;
  try {
    const { data: encoded } = JSON.parse(input);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    doc = await getDocument({
      data: new Uint8Array(Buffer.from(encoded, "base64")),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    if (doc.numPages > 30) throw new Error("Page limit exceeded");
    const pages = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const text = content.items
        .map((x) => ("str" in x ? x.str : ""))
        .join(" ");
      pages.push(text);
      chars += text.length;
      if (chars > 150000) break;
    }
    process.stdout.write(
      JSON.stringify({
        text: pages.join("\n").slice(0, 150000),
        truncated: chars > 150000,
      }),
    );
  } catch {
    process.stdout.write(
      JSON.stringify({
        error: "PDF could not be parsed within the supported limits",
      }),
    );
    process.exitCode = 1;
  } finally {
    await doc?.destroy();
  }
});
