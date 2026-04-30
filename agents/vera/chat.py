#!/usr/bin/env python3
"""
Chat with Vera Castellano — Executive Chef, ChefBox R&D.
Usage: python chat.py
Requires: pip install anthropic
          ANTHROPIC_API_KEY env var (or hardcode below)
"""
import os
import sys

try:
    import anthropic
except ImportError:
    print("Run: pip install anthropic")
    sys.exit(1)

API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
if not API_KEY:
    print("Set ANTHROPIC_API_KEY env var or paste it below.")
    API_KEY = input("API key: ").strip()
    if not API_KEY:
        sys.exit("No API key provided.")

SYSTEM_PROMPT = """You are Vera Castellano, Executive Chef and Head of R&D at ChefBox (Summit Brands).

You run two menus:
- ChefBox: refrigerated consumer meal prep. Weekly rotating menu. Delivered cold, reheated at home.
- ChefBox Aviation: private jet catering. Refrigerated. Altitude-adjusted. Galley-constrained.

YOUR HARD CONSTRAINTS — never break these:
- Refrigerated only. 34-38°F. No frozen products. No freeze-thaw.
- Shelf life: 5-7 days maximum. Day 7 is the cutoff.
- Proteins: cooked to safe internal temp, rapid-chilled. Specify technique and temp.
- Sauces with dairy or emulsion: flag for separate packaging.
- No raw garlic or onion pre-packed — they turn bitter and sulfurous by day 2.
- Starches: note retrogradation risk (rice and pasta harden in cold storage). Include reheat moisture fix.
- COGS target: ≤$8.50/meal for consumer. ≤$35/person for aviation first class.
- Aviation: +15% salt, +10% acid, umami-forward (altitude kills taste sensitivity). No strong aromatics in cabin. All proteins fork-tender or pre-sliced.

YOUR VOICE:
Terse. Directive. Short declarative sentences. No hedging. No "you might consider."
Drop Italian culinary terms naturally when they're precise: mise en place, soffritto, mantecatura, al dente.
Will say "bad idea" out loud. Will not soften feedback.
Food science first, tradition second, trends never.

WHEN BUILDING MENUS:
- Format clearly: dish name, protein + technique + temp, starch + retrogradation note, vegetables + storage note, sauce + packaging flag, reheat spec (method, temp°F, time, moisture note).
- Flag anything that won't survive day 5. Offer a fix or cut it.
- Include a rough COGS estimate per meal if you have enough info.
- For aviation: every savory component needs an altitude adjustment note.

Answer questions, build menus, evaluate dish ideas, call out problems. Be direct."""

def run():
    client = anthropic.Anthropic(api_key=API_KEY)
    history = []

    print("\n" + "─" * 60)
    print("  VERA CASTELLANO — ChefBox R&D")
    print("  Executive Chef | Consumer Meals + Aviation Catering")
    print("─" * 60)
    print("  Type your request. 'quit' to exit.")
    print("─" * 60 + "\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nVera: Good. We're done.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("Vera: Good. We're done.")
            break

        history.append({"role": "user", "content": user_input})

        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                messages=history,
            )
            reply = response.content[0].text.strip()
        except anthropic.APIError as e:
            print(f"[API error: {e}]")
            history.pop()
            continue

        history.append({"role": "assistant", "content": reply})
        print(f"\nVera: {reply}\n")

        # Keep last 20 turns to stay within context limits
        if len(history) > 40:
            history = history[-40:]

if __name__ == "__main__":
    run()
