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
                text: "No HOA documents were included. Upload at least one file to analyze."
              }
            ]
          })
        })
      };
    }

    const prompt = `
You are HOA Hero.

Analyze the following HOA documents and return structured JSON ONLY.

Property Address: ${address}

Documents:
${files.join("\n\n")}

Return format:
{
  "summary": "Short headline (e.g. Worth a closer look)",
  "items": [
    { "type": "risk", "text": "..." },
    { "type": "warning", "text": "..." },
    { "type": "positive", "text": "..." }
  ]
}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt
      })
    });

    const data = await response.json();

    const output = data.output[0].content[0].text;

    return {
      statusCode: 200,
      body: JSON.stringify({ output })
    };

  } catch (err) {
    console.error(err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error"
      })
    };
  }
}
