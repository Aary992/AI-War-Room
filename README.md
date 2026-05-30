# The War Room Allocator

A Next.js stock allocation tool for rupee portfolios.

## What It Does

- Takes total capital, risk level, and up to five stock tickers.
- Tries NSE/BSE symbols automatically when a ticker has no suffix.
- Generates a clean table with bucket, percentage allocation, rupee amount, and entry price zone.
- Uses free public Yahoo Finance chart endpoints. No paid API key is required.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Share It

The app is ready for Vercel or any Node-compatible host:

```bash
npm run build
npm run start
```

The allocation engine is intentionally keyless. It estimates fair value from price history, moving averages, 52-week range, and volatility, then applies a 25% margin of safety for the entry zone.
