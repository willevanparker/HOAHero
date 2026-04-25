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
        text: `You are HOA Hero, an assistant helping homebuyers evaluate HOA documents.

Return ONLY valid JSON. Do not use markdown. Do not include explanations outside the JSON.

Analyze the uploaded HOA documents for:
- special assessments
- reserve funding
- dues increases
- rental or leasing restrictions
- pet restrictions
- smoking restrictions
- insurance issues
- litigation
- repair obligations
- owner liability
- board discretion or governance concerns

Use this exact JSON shape:

{
  "summary": "Short headline, 3-8 words",
  "items": [
    { "type": "risk", "text": "One clear sentence." },
    { "type": "warning", "text": "One clear sentence." },
    { "type": "positive", "text": "One clear sentence." }
  ]
}

Rules:
- Use "risk" for serious buyer concerns.
- Use "warning" for items worth reviewing.
- Use "positive" for helpful or stabilizing signs.
- Return 4 to 7 total items.
- Each item text must be one sentence.
- Be practical and buyer-friendly.
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
        ],
        text: {
          format: {
            type: "json_schema",
            name: "hoa_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: {
                  type: "string"
                },
                items: {
                  type: "array",
                  minItems: 1,
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      type: {
                        type: "string",
                        enum: ["risk", "warning", "positive"]
                      },
                      text: {
                        type: "string"
                      }
                    },
                    required: ["type", "text"]
                  }
                }
              },
              required: ["summary", "items"]
            }
          }
        }
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        output: data.output_text
      })
    };

  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Server error"
      })
    };
  }
}
