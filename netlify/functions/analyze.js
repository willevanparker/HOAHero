export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
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

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET || "hoa-docs";

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
- Use plain English.
- Reference specific details when available.
- Do not provide legal, financial, or real estate advice.`
      }
    ];

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
  throw new Error(`Could not retrieve ${file.name} from storage. Status: ${fileResponse.status}. ${errorText}`);
}

      const arrayBuffer = await fileResponse.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = file.type || "application/pdf";

      content.push({
        type: "input_file",
        filename: file.name,
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
