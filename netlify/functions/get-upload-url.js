export async function handler(event) {
  try {
    const { fileName } = JSON.parse(event.body || "{}");

    if (!fileName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing fileName." })
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_BUCKET || "hoa-docs";

    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `uploads/${Date.now()}-${safeName}`;

    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${path}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          expiresIn: 7200
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data.error || data.message || "Could not create upload URL."
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        path,
        token: data.token
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Server error."
      })
    };
  }
}
