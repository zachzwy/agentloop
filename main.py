import os
from openai import OpenAI
from dotenv import load_dotenv

# [done] Phase 1: A simple Q&A agent, with no tool calling, single round.
# Phase 2: A simple Q&A agent, with a simple search_web tool calling, single round.
# Phase 3: A simple Q&A agent, with a simple read_file tool calling, single round.
# Phase 4: A simple Q&A agent, with a simple search_web tool calling, multi-round via defining exit criteria.
# Phase 5: A simple coding assistant agent, with read_file, write_file tool calling, single round.
# Phase 6: A simple coding assistant agent, with read_file, write_file tool calling, multi-round via defining exit criteria.
# Check point and define next phases.

load_dotenv()

# Phase 1: A simple Q&A agent, with no tool calling, single round.
def phase_1():
    # Get input from user.
    user_input = input("Enter your question: ")

    # Call the LLM.
    client = OpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com",
    )
    response = client.chat.completions.create(
        model="deepseek-v4-flash",
        messages=[{"role": "user", "content": user_input}],
        stream=False,
    )

    print(response.choices[0].message.content)

    return

if __name__ == "__main__":
    phase_1()
