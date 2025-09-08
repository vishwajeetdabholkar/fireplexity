# Fireplexity v2

AI search engine with web, news, and images.

<img src="https://github.com/user-attachments/assets/ca00d8eb-c5e5-44ca-81c5-9779bfe9bef6" width="100%" alt="Fireplexity Demo" />


## Setup

```bash
git clone https://github.com/vishwajeetdabholkar/fireplexity.git
cd fireplexity
npm install
```

## Configure

```bash
cp .env.example .env.local
```

Add your keys to `.env.local`:
```
FIRECRAWL_API_KEY=fc-your-api-key
GROQ_API_KEY=gsk_your-groq-api-key
```

## Run

```bash
npm run dev
```

Open http://localhost:3000

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mendableai/fireplexity)

## Get API Keys

- [Firecrawl](https://firecrawl.dev)
- [TogetherAI](https://www.together.ai/)

MIT License
