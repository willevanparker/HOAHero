export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const address = body.address || "";
    const files = body.files || [];

    if (!files.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          output: JSON.stringify({
            summary: "No documents provided for analysis",
            items: [
              {
                type: "warning",
                text: "Upload at least one HOA document."
              }
            ]
          })
        })
      };
    }

    const content = [
      {
        type: "input_text",
        text: `You are HOA Hero.

Analyze the uploaded HOA documents for a homebuyer.

Return ONLY valid JSON. No markdown. No explanation outside the JSON.

Use this exact format:

{
  "summary": "Short headline",
  "items": [
    { "type": "risk", "text": "One clear sentence." },
    { "type": "warning", "text": "One clear sentence." },
    { "type": "positive", "text": "One clear sentence." }
  ]
}

Rules:
- Use "risk" for serious buyer concerns.
- Use "warning" for items worth reviewing.
- Use "positive" for helpful signs.
- Return 4 to 7 items.
- Focus on assessments, reserves, dues, leasing, pets, smoking, insurance, lawsuits, repairs, liability, and board discretion.
- Do not provide legal, financial, or real estate advice.

Property Address: ${address || "Not provided"}`
      }
    ];

    for (const file of files) {
      if (file.type === "pdf") {
        content.push({
          type: "input_file",
          filename: file.name,
          file_data: `data:application/pdf;base64,${file.data}`
        });
      } else {
        content.push({
          type: "input_text",
          text: `FILE: ${file.name}\n${file.data}`
        });
      }
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: content
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data.error?.message || "OpenAI request failed."
        })
      };
    }

    const output =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "No output returned.";

    return {
      statusCode: 200,
      body: JSON.stringify({ output })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Server error"
      })
    };
  }
}
