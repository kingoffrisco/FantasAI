"""
FantasAI Local Ollama API Server
FastAPI server that wraps Ollama models for fantasy football analysis

3 Endpoints:
1. /news-processing (Qwen 8B) - Batch process articles
2. /fantasy-analysis (Qwen 14B) - Team/trade analysis
3. /premium-chat (Qwen 14B) - Conversational assistant
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import httpx
import json
from datetime import datetime

app = FastAPI(
    title="FantasAI Ollama API",
    description="Local LLM server for fantasy football intelligence",
    version="1.0.0"
)

# CORS for Cloudflare Workers
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ollama configuration
OLLAMA_BASE_URL = "http://localhost:11434"
QWEN_8B_MODEL = "qwen2.5:7b"  # Ollama model name
QWEN_14B_MODEL = "qwen2.5:14b"

# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class NewsArticle(BaseModel):
    """Single news article for processing"""
    news_id: str
    headline: str
    full_text: str
    source_url: Optional[str] = None
    published_at: Optional[str] = None

class NewsProcessingRequest(BaseModel):
    """Batch news processing request"""
    articles: List[NewsArticle]
    extract_players: bool = True
    tag_injuries: bool = True
    score_relevance: bool = True
    summarize: bool = True

class NewsProcessingResult(BaseModel):
    """Result for a single article"""
    news_id: str
    extracted_players: Optional[List[str]] = None
    injury_tags: Optional[List[str]] = None
    relevance_score: Optional[float] = None
    summary: Optional[str] = None
    processing_time_ms: int

class FantasyAnalysisRequest(BaseModel):
    """Team/trade analysis request"""
    analysis_type: str  # "start_sit", "trade", "waiver", "dynasty"
    user_context: Dict[str, Any]  # Team roster, league settings, etc.
    query: str  # User's specific question

class PremiumChatRequest(BaseModel):
    """Premium chat request"""
    message: str
    conversation_history: Optional[List[Dict[str, str]]] = []
    league_context: Optional[Dict[str, Any]] = None

class APIResponse(BaseModel):
    """Standard API response"""
    success: bool
    data: Any
    error: Optional[str] = None
    processing_time_ms: int
    model_used: str

# ============================================================================
# OLLAMA CLIENT FUNCTIONS
# ============================================================================

async def call_ollama(model: str, prompt: str, system_prompt: Optional[str] = None) -> str:
    """Call Ollama API"""
    async with httpx.AsyncClient(timeout=120.0) as client:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False
        }
        
        if system_prompt:
            payload["system"] = system_prompt
        
        try:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json=payload
            )
            response.raise_for_status()
            result = response.json()
            return result.get("response", "")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Ollama error: {str(e)}")

# ============================================================================
# ENDPOINT 1: NEWS PROCESSING (Qwen 8B)
# ============================================================================

@app.post("/api/v1/news-processing", response_model=APIResponse)
async def process_news(request: NewsProcessingRequest):
    """
    Batch process news articles with Qwen 8B
    - Extract player names
    - Tag injury keywords
    - Score fantasy relevance (0-100)
    - Generate summaries
    """
    start_time = datetime.now()
    results = []
    
    system_prompt = """You are a fantasy football news analyzer. Extract structured data from articles.

Your tasks:
1. Extract all player names mentioned (first and last name)
2. Identify injury-related keywords (Out, Questionable, IR, Doubtful, etc.)
3. Score fantasy relevance 0-100 (0=irrelevant, 100=must-read)
4. Generate 2-sentence summary

Return JSON format:
{
  "players": ["Player Name", ...],
  "injury_tags": ["Out", "Questionable", ...],
  "relevance_score": 85,
  "summary": "Brief summary here."
}"""

    for article in request.articles:
        article_start = datetime.now()
        
        prompt = f"""Article: {article.headline}

Full text: {article.full_text[:1000]}

Extract data in JSON format."""

        try:
            response = await call_ollama(QWEN_8B_MODEL, prompt, system_prompt)
            
            # Parse JSON response
            try:
                parsed = json.loads(response)
                result = NewsProcessingResult(
                    news_id=article.news_id,
                    extracted_players=parsed.get("players"),
                    injury_tags=parsed.get("injury_tags"),
                    relevance_score=parsed.get("relevance_score"),
                    summary=parsed.get("summary"),
                    processing_time_ms=int((datetime.now() - article_start).total_seconds() * 1000)
                )
            except json.JSONDecodeError:
                # Fallback if model doesn't return valid JSON
                result = NewsProcessingResult(
                    news_id=article.news_id,
                    extracted_players=None,
                    injury_tags=None,
                    relevance_score=None,
                    summary=response[:200],
                    processing_time_ms=int((datetime.now() - article_start).total_seconds() * 1000)
                )
            
            results.append(result)
            
        except Exception as e:
            results.append(NewsProcessingResult(
                news_id=article.news_id,
                extracted_players=None,
                injury_tags=None,
                relevance_score=None,
                summary=f"Error: {str(e)}",
                processing_time_ms=int((datetime.now() - article_start).total_seconds() * 1000)
            ))
    
    total_time = int((datetime.now() - start_time).total_seconds() * 1000)
    
    return APIResponse(
        success=True,
        data={"results": [r.dict() for r in results]},
        processing_time_ms=total_time,
        model_used=QWEN_8B_MODEL
    )

# ============================================================================
# ENDPOINT 2: FANTASY ANALYSIS (Qwen 14B)
# ============================================================================

@app.post("/api/v1/fantasy-analysis", response_model=APIResponse)
async def fantasy_analysis(request: FantasyAnalysisRequest):
    """
    Advanced fantasy reasoning with Qwen 14B
    - Start/sit decisions
    - Trade analysis
    - Waiver wire recommendations
    - Dynasty projections
    """
    start_time = datetime.now()
    
    # Build context-aware prompt
    system_prompt = """You are an elite fantasy football analyst with deep knowledge of:
- Player performance trends and matchup analysis
- Injury impacts and backup scenarios
- Trade value and positional scarcity
- Dynasty asset valuation
- Waiver wire strategy

Provide detailed, actionable advice with specific reasoning."""

    # Format user context
    context_str = json.dumps(request.user_context, indent=2)
    
    prompt = f"""Analysis Type: {request.analysis_type}

User's Team Context:
{context_str}

Question: {request.query}

Provide detailed analysis with:
1. Recommendation
2. Key factors to consider
3. Risk assessment
4. Alternative options"""

    try:
        response = await call_ollama(QWEN_14B_MODEL, prompt, system_prompt)
        
        total_time = int((datetime.now() - start_time).total_seconds() * 1000)
        
        return APIResponse(
            success=True,
            data={"analysis": response},
            processing_time_ms=total_time,
            model_used=QWEN_14B_MODEL
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# ENDPOINT 3: PREMIUM CHAT (Qwen 14B)
# ============================================================================

@app.post("/api/v1/premium-chat", response_model=APIResponse)
async def premium_chat(request: PremiumChatRequest):
    """
    Conversational AI assistant with league data context
    Uses Qwen 14B with full conversation history
    """
    start_time = datetime.now()
    
    system_prompt = """You are FantasAI, an expert fantasy football assistant.

You have access to:
- League rosters and settings
- Current player stats and rankings
- Injury reports and news
- Matchup data and schedules

Provide helpful, conversational responses with specific recommendations."""

    # Build conversation context
    conversation = "\n".join([
        f"{msg['role']}: {msg['content']}" 
        for msg in request.conversation_history[-5:]  # Last 5 messages
    ])
    
    league_context_str = ""
    if request.league_context:
        league_context_str = f"\n\nLeague Context:\n{json.dumps(request.league_context, indent=2)}"
    
    prompt = f"""Previous conversation:
{conversation}

{league_context_str}

User: {request.message}
true # exit without an error
