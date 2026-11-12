# Fitness Store Demo

This project is a minimal Node.js application demonstrating a product purchase flow that unlocks a free AI-generated meal and workout plan.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Provide an OpenAI API key:
   ```bash
   export OPENAI_API_KEY="your-key"
   ```
3. Start the server:
   ```bash
   npm start
   ```

## Customization

- Edit `config.json` to change available products and the brands displayed on the home page.
- After a mock purchase, users complete an intake form and receive an AI-generated plan.

This app is for demonstration purposes only and does not process real payments.

## DealFlip

The `dealflip/` folder holds a separate app: a deal finder and contract-assignment calculator with AI drafting. See [dealflip/README.md](dealflip/README.md).
