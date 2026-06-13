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
    const { targetName, questions, guesses } = body;

    if (!targetName || typeof targetName !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid targetName" },
        { status: 400 }
      );
    }

    const questionsList: string[] = Array.isArray(questions) ? questions : [];
    const guessesList: string[] = Array.isArray(guesses) ? guesses : [];

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
                "You are a savage comedian who writes extremely dark, brutal roast jokes. No mercy. Dark humor only. Be creative and specific. Max 3 sentences.",
            },
            {
              role: "user",
              content: `Roast this player based on their terrible performance:\nPlayer name: ${targetName}\nQuestions they asked: ${
                questionsList.join(", ") ||
                "None - they were too scared to even ask"
              }\nGuesses they made: ${
                guessesList.join(", ") || "None - they had no clue"
              }\nThey came LAST PLACE in the game.\nWrite the darkest most brutal roast of this player based specifically on how dumb their questions and guesses were. Reference their actual questions and guesses in the roast. Make it hurt.`,
            },
          ],
          temperature: 0.9,
          max_tokens: 256,
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
    const roastText =
      data.choices?.[0]?.message?.content ||
      `${targetName} played so badly that even the AI couldn't find words.`;

    return NextResponse.json({ roastText });
  } catch (error) {
    console.error("Roast API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
