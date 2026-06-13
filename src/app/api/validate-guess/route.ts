import { NextRequest, NextResponse } from "next/server";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

export async function POST(request: NextRequest) {
  if (!GROQ_API_KEY) {
    return NextResponse.json(
      { error: "Groq API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { guess, secretPerson } = body;

    if (!guess || typeof guess !== "string" || !secretPerson || typeof secretPerson !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid guess or secretPerson" },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are a strict trivia judge. The user will provide a 'Secret Person' and a 'Guess'. Your job is to determine if they refer to the exact same entity. Consider common typos, synonyms, stage names, and character vs actor names (e.g. 'Iron Man' and 'Tony Stark' are the same). Respond with exactly one word: YES or NO.",
            },
            {
              role: "user",
              content: `Secret Person: "${secretPerson}"\nGuess: "${guess}"`,
            },
          ],
          temperature: 0.1, // Low temperature for consistent formatting
          max_tokens: 10, // We only need "YES" or "NO"
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Groq API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Groq API request failed" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const answerText = data.choices?.[0]?.message?.content?.trim().toUpperCase() || "NO";
    
    // Check if the response contains "YES" to handle cases where the model
    // might append punctuation like "YES."
    const isCorrect = answerText.includes("YES");

    return NextResponse.json({ isCorrect });
  } catch (error) {
    console.error("Validate guess API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
