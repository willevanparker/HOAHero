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

    let content = [
      {
        type: "input_text",
        text: `You are HOA Hero.

Analyze HOA documents and return ONLY JSON:

{
  "summary": "Short headline",
  "items": [
    { "type": "risk", "text": "..." },
    { "type": "warning", "text": "..." },
    { "type": "positive", "text": "..." }
  ]
}

Property Address: ${address}`
      }
    ];

    for (const file of files) {
      if (file.type === "pdf") {
        content.push({
          type: "input_file",
          filename: file.name,
          file_data: file.data
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
    const output = data.output[0].content[0].text;

    return {
      statusCode: 200,
      body: JSON.stringify({ output })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" })
    };
  }
}
