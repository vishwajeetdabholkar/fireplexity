import { NextResponse } from 'next/server'
import Together from 'together-ai'
import { createUIMessageStream, createUIMessageStreamResponse, convertToModelMessages } from 'ai'
import type { ModelMessage } from 'ai'
import { detectCompanyTicker } from '@/lib/company-ticker-map'
import { selectRelevantContent } from '@/lib/content-selection'

export async function POST(request: Request) {
  const requestId = Math.random().toString(36).substring(7)
  
  try {
    const body = await request.json()
    const messages = body.messages || []
    
    // Extract query from v5 message structure (messages have parts array)
    let query = body.query
    if (!query && messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.parts) {
        // v5 structure
        const textParts = lastMessage.parts.filter((p: any) => p.type === 'text')
        query = textParts.map((p: any) => p.text).join(' ')
      } else if (lastMessage.content) {
        // Fallback for v4 structure
        query = lastMessage.content
      }
    }

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Use API key from request body if provided, otherwise fall back to environment variable
    const firecrawlApiKey = body.firecrawlApiKey || process.env.FIRECRAWL_API_KEY
    const togetherApiKey = process.env.TOGETHER_API_KEY
    
    if (!firecrawlApiKey) {
      return NextResponse.json({ error: 'Firecrawl API key not configured' }, { status: 500 })
    }
    
    if (!togetherApiKey) {
      return NextResponse.json({ error: 'Together AI API key not configured' }, { status: 500 })
    }

    // Initialize Together client
    const together = new Together({ apiKey: togetherApiKey })

    // Always perform a fresh search for each query to ensure relevant results
    const isFollowUp = messages.length > 2
    
    // Create a UIMessage stream with custom data parts
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        try {
          let sources: Array<{
            url: string
            title: string
            description?: string
            content?: string
            markdown?: string
            publishedDate?: string
            author?: string
            image?: string
            favicon?: string
            siteName?: string
          }> = []
          let newsResults: Array<{
            url: string
            title: string
            description?: string
            publishedDate?: string
            source?: string
            image?: string
          }> = []
          let imageResults: Array<{
            url: string
            title: string
            thumbnail?: string
            source?: string
            width?: number
            height?: number
            position?: number
          }> = []
          let context = ''
          
          // Send status updates as transient data parts
          writer.write({
            type: 'data-status',
            id: 'status-1',
            data: { message: 'Starting search...' },
            transient: true
          })
          
          writer.write({
            type: 'data-status',
            id: 'status-2',
            data: { message: 'Searching for relevant sources...' },
            transient: true
          })
          
          // Make direct API call to Firecrawl v2 search endpoint
          const searchResponse = await fetch('https://api.firecrawl.dev/v2/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: query,
              sources: ['web', 'news', 'images'],
              limit: 6,
              scrapeOptions: {
                formats: ['markdown'],
                onlyMainContent: true,
                maxAge: 86400000  // 24 hours in milliseconds
              }
            })
          })

          if (!searchResponse.ok) {
            const errorData = await searchResponse.json()
            throw new Error(`Firecrawl API error: ${errorData.error || searchResponse.statusText}`)
          }

          const searchResult = await searchResponse.json()
          const searchData = searchResult.data || {}
          
          // Extract results from the v2 SDK response
          const webResults = searchData.web || []
          const newsData = searchData.news || []
          const imagesData = searchData.images || []
          
          // Transform web sources metadata
          sources = webResults.map((item: any) => {
            return {
              url: item.url,
              title: item.title || item.url,
              description: item.description || item.snippet,
              content: item.content,
              markdown: item.markdown,
              favicon: item.favicon,
              image: item.ogImage || item.image || item.metadata?.ogImage,  // Add ogImage support
              siteName: new URL(item.url).hostname
            };
          }).filter((item: any) => item.url) || []

          // Transform news results - now with correct schema
          newsResults = newsData.map((item: any) => {
            return {
              url: item.url,
              title: item.title,
              description: item.snippet || item.description,
              publishedDate: item.date,  // Direct API returns 'date' field
              source: item.source || (item.url ? new URL(item.url).hostname : undefined),
              image: item.imageUrl  // Direct API returns 'imageUrl' for news thumbnails
            };
          }).filter((item: any) => item.url) || []

          // Transform image results - now with correct schema from direct API
          imageResults = imagesData.map((item: any) => {
            // Verify we have the required fields
            if (!item.url || !item.imageUrl) {
              return null;
            }
            return {
              url: item.url,
              title: item.title || 'Untitled',
              thumbnail: item.imageUrl,  // Direct API returns 'imageUrl' field
              source: item.url ? new URL(item.url).hostname : undefined,
              width: item.imageWidth,
              height: item.imageHeight,
              position: item.position
            };
          }).filter(Boolean) || []  // Filter out null entries
          
          // Send all sources as a persistent data part
          writer.write({
            type: 'data-sources',
            id: 'sources-1',
            data: {
              sources,
              newsResults,
              imageResults
            }
          })
          
          // Small delay to ensure sources render first
          await new Promise(resolve => setTimeout(resolve, 300))
          
          // Update status
          writer.write({
            type: 'data-status',
            id: 'status-3',
            data: { message: 'Analyzing sources and generating answer...' },
            transient: true
          })
          
          // Detect if query is about a company
          const ticker = detectCompanyTicker(query)
          if (ticker) {
            writer.write({
              type: 'data-ticker',
              id: 'ticker-1',
              data: { symbol: ticker }
            })
          }
          
          // Prepare context from sources with intelligent content selection
          context = sources
            .map((source: { title: string; markdown?: string; content?: string; url: string }, index: number) => {
              const content = source.markdown || source.content || ''
              const relevantContent = selectRelevantContent(content, query, 2000)
              return `[${index + 1}] ${source.title}\nURL: ${source.url}\n${relevantContent}`
            })
            .join('\n\n---\n\n')

          
          // Prepare messages for the AI
          let aiMessages: ModelMessage[] = []
          
          if (!isFollowUp) {
            // Initial query with sources
            aiMessages = [
              {
                role: 'system',
                content: `You are a friendly assistant that helps users find information.

                CRITICAL FORMATTING RULE:
                - NEVER use LaTeX/math syntax ($...$) for regular numbers in your response
                - Write ALL numbers as plain text: "1 million" NOT "$1$ million", "50%" NOT "$50\\%$"
                - Only use math syntax for actual mathematical equations if absolutely necessary
                
                RESPONSE STYLE:
                - For greetings (hi, hello), respond warmly and ask how you can help
                - For simple questions, give direct, concise answers
                - For complex topics, provide detailed explanations only when needed
                - Match the user's energy level - be brief if they're brief
                
                FORMAT:
                - Use markdown for readability when appropriate
                - Keep responses natural and conversational
                - Include citations inline as [1], [2], etc. when referencing specific sources
                - Citations should correspond to the source order (first source = [1], second = [2], etc.)
                - Use the format [1] not CITATION_1 or any other format`
              },
              {
                role: 'user',
                content: `Answer this query: "${query}"\n\nBased on these sources:\n${context}`
              }
            ]
          } else {
            // Follow-up question - still use fresh sources from the new search
            aiMessages = [
              {
                role: 'system',
                content: `You are a friendly assistant continuing our conversation.

                CRITICAL FORMATTING RULE:
                - NEVER use LaTeX/math syntax ($...$) for regular numbers in your response
                - Write ALL numbers as plain text: "1 million" NOT "$1$ million", "50%" NOT "$50\\%$"
                - Only use math syntax for actual mathematical equations if absolutely necessary
                
                REMEMBER:
                - Keep the same conversational tone from before
                - Build on previous context naturally
                - Match the user's communication style
                - Use markdown when it helps clarity
                - Include citations inline as [1], [2], etc. when referencing specific sources
                - Citations should correspond to the source order (first source = [1], second = [2], etc.)
                - Use the format [1] not CITATION_1 or any other format`
              },
              // Include conversation context - convert UIMessages to ModelMessages
              ...convertToModelMessages(messages.slice(0, -1)),
              // Add the current query with the fresh sources
              {
                role: 'user',
                content: `Answer this query: "${query}"\n\nBased on these sources:\n${context}`
              }
            ]
          }
          
          // Stream the text generation using Together AI
          writer.write({
            type: 'data-status',
            id: 'status-4',
            data: { message: 'Contacting Together AI...' },
            transient: true
          })

          const togetherMessages = aiMessages.map((m: any) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : String(m.content ?? '')
          }))

          let fullAnswer = ''
          let receivedAnyDelta = false
          try {
            console.log(`[${requestId}] Starting Together stream`)
            const togetherStream = await together.chat.completions.create({
              model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
              messages: togetherMessages,
              temperature: 0.7,
              max_tokens: 1024,
              stream: true
            })

            // Begin text stream for UI assembly
            writer.write({ type: 'text-start', id: 'text-1' })

            for await (const chunk of togetherStream) {
              const delta = chunk?.choices?.[0]?.delta?.content || ''
              if (delta) {
                receivedAnyDelta = true
                fullAnswer += delta
                writer.write({ type: 'text-delta', id: 'text-1', delta })
              }
            }
            // End text stream so UI materializes a 'text' part
            writer.write({ type: 'text-end', id: 'text-1' })
            console.log(`[${requestId}] Together stream completed. receivedAnyDelta=${receivedAnyDelta}`)
          } catch (togetherError) {
            console.error(`[${requestId}] Together stream error`, togetherError)
            throw togetherError
          }

          if (!receivedAnyDelta) {
            console.warn(`[${requestId}] Together returned no content`)
            writer.write({
              type: 'data-error',
              id: 'error-empty',
              data: {
                error: 'No content received from Together AI.',
                suggestion: 'Verify TOGETHER_API_KEY and model access. Try again in a moment.'
              },
              transient: true
            })
          }
          
          // Generate follow-up questions
          const conversationPreview = isFollowUp 
            ? messages.map((m: { role: string; parts?: any[] }) => {
                const content = m.parts 
                  ? m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ')
                  : ''
                return `${m.role}: ${content}`
              }).join('\n\n')
            : `user: ${query}`
            
          try {
            const followUpResponse = await together.chat.completions.create({
              model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
              messages: [
                {
                  role: 'system',
                  content: `Generate 5 natural follow-up questions based on the query and answer.
                
                ONLY generate questions if the query warrants them:
                - Skip for simple greetings or basic acknowledgments
                - Create questions that feel natural, not forced
                - Make them genuinely helpful, not just filler
                - Focus on the topic and sources available
                
                If the query doesn't need follow-ups, return an empty response.
                  ${isFollowUp ? 'Consider the full conversation history and avoid repeating previous questions.' : ''}
                  Return only the questions, one per line, no numbering or bullets.`
                },
                {
                  role: 'user',
                  content: `Query: ${query}\n\nAnswer provided: ${fullAnswer.substring(0, 500)}...\n\n${sources.length > 0 ? `Available sources about: ${sources.map((s: { title: string }) => s.title).join(', ')}\n\n` : ''}Generate 5 diverse follow-up questions that would help the user learn more about this topic from different angles.`
                }
              ],
              temperature: 0.7,
              max_tokens: 256
            })
            
            // Process follow-up questions
            const followUpText = followUpResponse?.choices?.[0]?.message?.content || ''
            const followUpQuestions = followUpText
              .split('\n')
              .map((q: string) => q.trim())
              .filter((q: string) => q.length > 0)
              .slice(0, 5)

            // Send follow-up questions as a data part
            writer.write({
              type: 'data-followup',
              id: 'followup-1',
              data: { questions: followUpQuestions }
            })
          } catch (followUpError) {
            // Error generating follow-up questions
          }
          
        } catch (error) {
          
          // Handle specific error types
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          const statusCode = error && typeof error === 'object' && 'statusCode' in error 
            ? error.statusCode 
            : error && typeof error === 'object' && 'status' in error
            ? error.status
            : undefined
          
          // Provide user-friendly error messages (Firecrawl and Together AI)
          const errorResponses: Record<number, { error: string; suggestion?: string }> = {
            401: {
              error: 'Invalid API key',
              suggestion: 'Please check your Firecrawl or Together AI API key.'
            },
            402: {
              error: 'Insufficient credits',
              suggestion: 'You\'ve run out of credits. Please upgrade your Firecrawl or Together AI plan.'
            },
            429: {
              error: 'Rate limit exceeded',
              suggestion: 'Too many requests to Firecrawl or Together AI. Please wait and try again.'
            },
            504: {
              error: 'Request timeout',
              suggestion: 'The search took too long. Try a simpler query or fewer sources.'
            }
          }
          
          const errorResponse = statusCode && errorResponses[statusCode as keyof typeof errorResponses] 
            ? errorResponses[statusCode as keyof typeof errorResponses]
            : { error: errorMessage }
          
          writer.write({
            type: 'data-error',
            id: 'error-1',
            data: {
              error: errorResponse.error,
              ...(errorResponse.suggestion ? { suggestion: errorResponse.suggestion } : {}),
              ...(statusCode ? { statusCode } : {})
            },
            transient: true
          })
        }
      }
    })
    
    return createUIMessageStreamResponse({ stream })
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : ''
    return NextResponse.json(
      { error: 'Search failed', message: errorMessage, details: errorStack },
      { status: 500 }
    )
  }
}