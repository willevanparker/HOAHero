const pdfParse = require("pdf-parse");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkText(text, maxChars = 20000) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars));
    start += maxChars;
  }

  return chunks;
}

function cleanJsonString(output) {
  let cleaned = (output || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start !== -1 && end !== -1) {
    cleaned = cleaned.slice(start, end + 1);
  }

  return cleaned;
}

function safeJsonOutput(summary, type, text) {
  return JSON.stringify({
    summary,
    items: [{ type, text }]
  });
}

async function callOpenAI(input) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input,
      temperature: 0
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed.");
  }

  if (data.output_text) return data.output_text;

  const textParts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) textParts.push(content.text);
    }
  }

  return textParts.join("\n").trim();
}

async function runOCR(buffer) {
  if (!process.env.OCR_SPACE_API_KEY) return "";

  const base64Image = `data:application/pdf;base64,${buffer.toString("base64")}`;

  const params = new URLSearchParams();
  params.append("apikey", process.env.OCR_SPACE_API_KEY);
  params.append("language", "eng");
  params.append("isOverlayRequired", "false");
  params.append("scale", "true");
  params.append("OCREngine", "2");
  params.append("base64Image", base64Image);

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const data = await response.json();

  if (data.IsErroredOnProcessing) {
    console.log("OCR failed:", data.ErrorMessage);
    return "";
  }

  if (!data.ParsedResults || !data.ParsedResults.length) return "";

  return data.ParsedResults
    .map(r => r.ParsedText || "")
    .join("\n")
    .trim();
}

async function analyzePdfAsFile(buffer, filename, question) {
  const base64 = buffer.toString("base64");

  const prompt = `
You are HOA Hero.

This PDF could not be reliably read as text. Analyze the uploaded HOA document visually/from the file itself.

Focus on:
${question}

Return ONLY valid JSON. No markdown. No commentary.

Use exactly this structure:

{
  "summary": "Short headline",
  "items": [
    { "type": "risk", "text": "One clear sentence." },
    { "type": "warning", "text": "One clear sentence." },
    { "type": "positive", "text": "One clear sentence." }
  ]
}

Rules:
- Return 4 to 7 total items.
- type must be only: risk, warning, or positive.
- Use plain English.
- Prioritize buyer concerns.
- Do not provide legal, financial, or real estate advice.
`;

  return await callOpenAI([
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        {
          type: "input_file",
          filename: filename || "hoa-document.pdf",
          file_data: `data:application/pdf;base64,${base64}`
        }
      ]
    }
  ]);
}

exports.handler = async function(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const files = body.files || [];
    const question = body.question || "Analyze this HOA document.";

    if (!files.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: safeJsonOutput(
            "No documents provided",
            "warning",
            "Upload a document or skip this step."
          )
        })
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET || "hoa-docs";

    let combinedText = "";

    for (const file of files) {
      const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");

      const fileResponse = await fetch(
        `${supabaseUrl}/storage/v1/object/${bucket}/${encodedPath}`,
        {
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey
          }
        }
      );

      if (!fileResponse.ok) {
        const errorText = await fileResponse.text();
        throw new Error(`Could not retrieve file. ${errorText}`);
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = file.name || file.path.split("/").pop() || "hoa-document.pdf";

      let extractedText = "";
      const isPdf = (file.type || "").includes("pdf") || file.path.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || "";

        if (!extractedText || extractedText.trim().length < 300) {
          console.log("PDF text weak. Trying OCR fallback...");
          const ocrText = await runOCR(buffer);

          if (ocrText && ocrText.trim().length >= 300) {
            extractedText = ocrText;
          }
        }

        if (!extractedText || extractedText.trim().length < 300) {
          console.log("Text and OCR failed. Trying OpenAI PDF file fallback...");
          const fileAnalysis = await analyzePdfAsFile(buffer, filename, question);
          const cleaned = cleanJsonString(fileAnalysis);

          try {
            const parsed = JSON.parse(cleaned);
            return {
              statusCode: 200,
              body: JSON.stringify({ output: JSON.stringify(parsed) })
            };
          } catch (e) {
            return {
              statusCode: 200,
              body: JSON.stringify({
                output: safeJsonOutput(
                  "Document analyzed with limited confidence",
                  "warning",
                  "HOA Hero reviewed the file, but the output could not be cleanly formatted."
                )
              })
            };
          }
        }
      } else {
        extractedText = buffer.toString("utf8");
      }

      combinedText += `\n\nDOCUMENT: ${filename}\n\n${extractedText}`;
    }

    if (!combinedText.trim()) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: safeJsonOutput(
            "Document could not be read",
            "warning",
            "This document format was difficult to read automatically."
          )
        })
      };
    }

    const chunks = chunkText(combinedText, 20000).slice(0, 3);
    const chunkResults = [];

    for (let i = 0; i < chunks.length; i++) {
      const prompt = `
You are HOA Hero.

Task:
${question}

Analyze this section of an HOA document.

Return ONLY valid JSON:

{
  "summary": "Short headline",
  "items": [
    { "type": "risk", "text": "..." },
    { "type": "warning", "text": "..." },
    { "type": "positive", "text": "..." }
  ]
}

Rules:
- type must be only: risk, warning, or positive.
- Use plain English.
- Focus only on the buyer's question.
- Do not provide legal, financial, or real estate advice.

SECTION ${i + 1}:
${chunks[i]}
`;

      const result = await callOpenAI(prompt);
      chunkResults.push(result);
      await sleep(1500);
    }

    const finalPrompt = `
You are HOA Hero.

Combine the following HOA findings into one clean JSON response.

Return JSON only. No markdown. No commentary.

Use exactly this structure:

{
  "summary": "Short headline",
  "items": [
    { "type": "risk", "text": "One clear sentence." },
    { "type": "warning", "text": "One clear sentence." },
    { "type": "positive", "text": "One clear sentence." }
  ]
}

Rules:
- Return 4 to 7 total items.
- type must be only: risk, warning, or positive.
- Remove duplicates.
- Use plain English.
- Focus on the buyer's question: ${question}

Findings to combine:
${chunkResults.join("\\n\\n")}
`;

    const finalOutput = await callOpenAI(finalPrompt);
    const cleaned = cleanJsonString(finalOutput);

    try {
      const parsed = JSON.parse(cleaned);

      return {
        statusCode: 200,
        body: JSON.stringify({
          output: JSON.stringify(parsed)
        })
      };
    } catch (e) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: safeJsonOutput(
            "Could not parse analysis",
            "warning",
            "The document was processed, but formatting failed."
          )
        })
      };
    }

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        output: safeJsonOutput(
          "Analysis failed",
          "risk",
          err.message || "Server error"
        )
      })
    };
  }
};
