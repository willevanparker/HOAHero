const pdfParse = require("pdf-parse");

function chunkText(text, maxChars = 12000) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars));
    start += maxChars;
  }

  return chunks;
}

async function callOpenAI(input) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1",
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

exports.handler = async function(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const files = body.files || [];
    const question = body.question || "Analyze this HOA document.";

    if (!files.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: JSON.stringify({
            summary: "No documents provided",
            items: [
              { type: "warning", text: "Upload a document or skip this step." }
            ]
          })
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

      let extractedText = "";

      if ((file.type || "").includes("pdf") || file.path.toLowerCase().endsWith(".pdf")) {
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || "";
      } else {
        extractedText = buffer.toString("utf8");
      }

      combinedText += `\n\n${extractedText}`;
    }

    if (!combinedText.trim()) {
      throw new Error("No readable text found in document.");
    }

    const chunks = chunkText(combinedText, 12000);
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

SECTION ${i + 1}:
${chunks[i]}
`;

      const result = await callOpenAI(prompt);
      chunkResults.push(result);
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

let cleaned = finalOutput
  .replace(/```json/g, "")
  .replace(/```/g, "")
  .trim();

let parsed;

try {
  parsed = JSON.parse(cleaned);
} catch (e) {
  console.error("RAW OUTPUT:", finalOutput);

  return {
    statusCode: 200,
    body: JSON.stringify({
      output: JSON.stringify({
        summary: "Could not parse analysis",
        items: [
          { type: "warning", text: "The document was processed, but formatting failed." }
        ]
      })
    })
  };
}

return {
  statusCode: 200,
  body: JSON.stringify({
    output: JSON.stringify(parsed)
  })
};

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        output: JSON.stringify({
          summary: "Analysis failed",
          items: [
            { type: "risk", text: err.message }
          ]
        })
      })
    };
  }
};
