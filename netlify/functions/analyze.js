export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const files = body.files || [];
    const question = body.question || "Analyze this HOA document for a homebuyer.";

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

    if (!supabaseUrl || !serviceKey || !process.env.OPENAI_API_KEY) {
      throw new Error("Missing required environment variables.");
    }

    const content = [
      {
        type: "input_text",
        text: `You are HOA Hero.

Current task:
${question}

Analyze the uploaded HOA document for a homebuyer.

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
- Focus only on the current task.
- Use plain English.
- Reference specific details when available.
- Do not provide legal, financial, or real estate advice.`
      }
    ];

    for (const file of files) {
      if (!file.path) {
        throw new Error("Uploaded file is missing a storage path.");
      }

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
        throw new Error(
          `Could not retrieve file from storage. Status: ${fileResponse.status}. ${errorText}`
        );
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      const fallbackName = file.path.split("/").pop() || "hoa-document.pdf";
      const filename = file.name || fallbackName;
      const mimeType = file.type || "application/pdf";

      content.push({
        type: "input_file",
        filename,
        file_data: `data:${mimeType};base64,${base64}`
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          output: JSON.stringify({
            summary: "Analysis failed",
            items: [
              {
                type: "risk",
                text: data.error?.message || "OpenAI request failed."
              }
            ]
          })
        })
      };
    }

    const output =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      JSON.stringify({
        summary: "No analysis returned",
        items: [
          { type: "warning", text: "The analysis completed, but no readable output was returned." }
        ]
      });

    return {
      statusCode: 200,
      body: JSON.stringify({ output })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        output: JSON.stringify({
          summary: "Server error",
          items: [
            {
              type: "risk",
              text: err.message || "Server error"
            }
          ]
        })
      })
    };
  }
}
