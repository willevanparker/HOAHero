export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");

    const address = body.address || "Unknown address";
    const files = body.files || [];

    const prompt = `
You are HOA Hero.

Analyze the following HOA documents and return structured insights.

Property Address: ${address}

Documents:
${files.map(f => `- ${f.name}`).join("\n")}

Return JSON in this format:

{
  "summary": "Short headline like 'Worth a closer look'",
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

    const output =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "No output";

    return {
      statusCode: 200,
      body: JSON.stringify({ output })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message
      })
    };
  }
}
