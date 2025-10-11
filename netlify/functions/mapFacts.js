// netlify/functions/mapFacts.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function openai(path, body) {
  const res = await fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!OPENAI_API_KEY) return { statusCode: 500, body: JSON.stringify({ error: "Missing OPENAI_API_KEY" }) };

    const body = JSON.parse(event.body || "{}");
    const { sceneDesc, knownPlaces } = body;

    const sys =
      "Extract world-map facts from a single fantasy scene. " +
      "Return STRICT JSON with keys: places, relations, current_place_id.\n" +
      "Schema:\n" +
      "{ places:[{name:string,id:string,tags:string[],notes:string}], " +
      "  relations:[{a:string,b:string,type:'near'|'path'|'door'|'road'|'river',bearing?:'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW',distance?:1|2|3}], " +
      "  current_place_id:string }\n" +
      "Rules: 1) Prefer 0-2 relations. 2) If a place matches an existing name from KNOWN, reuse its id (slug of name). " +
      "3) If no clear location, create one from the dominant setting noun phrase (e.g., 'Misty Harbor', 'Ancient Library Entrance'). " +
      "4) Set current_place_id to where the scene primarily occurs. 5) Keep notes short (<= 24 words).";

    const user =
      `SCENE:\n"""${sceneDesc}"""\n\nKNOWN PLACE NAMES:\n${(knownPlaces || []).join(", ") || "(none)"}`;

    const resp = await openai("responses", {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      input: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    });

    let parsed;
    try {
      parsed = JSON.parse(resp.output[0].content[0].text);
    } catch {
      parsed = { places: [], relations: [], current_place_id: "" };
    }

    // basic sanitation
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    parsed.places = (parsed.places || []).map(p => ({
      name: String(p.name || "").slice(0, 60),
      id: p.id || slug(String(p.name || "place")),
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 6).map(String) : [],
      notes: String(p.notes || "").slice(0, 140)
    }));
    parsed.relations = (parsed.relations || []).map(r => ({
      a: r.a || "", b: r.b || "", type: ["near","path","door","road","river"].includes(r.type) ? r.type : "near",
      bearing: ["N","NE","E","SE","S","SW","W","NW"].includes(r.bearing) ? r.bearing : undefined,
      distance: [1,2,3].includes(r.distance) ? r.distance : undefined
    }));
    parsed.current_place_id = parsed.current_place_id || (parsed.places[0]?.id || "");

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Server error" }) };
  }
};
