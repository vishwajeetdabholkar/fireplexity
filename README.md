# Fireplexity v2

AI search engine with web, news, and images.

<img src="https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExNjBxbWFxamZycWRkMmVhMGFiZnNuZjMxc3lpNHpuamR4OWlwa3F4NSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/QbfaTCB1OmkRmIQwzJ/giphy.gif" width="100%" alt="Fireplexity Demo" />

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
