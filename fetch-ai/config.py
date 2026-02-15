"""
Configuration for the Concept Card Agent.
Uses environment variables (with .env via python-dotenv).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from repo root
_env_path = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(_env_path)

from pydantic import BaseModel, Field


class ElasticConfig(BaseModel):
    url: str = Field(
        default_factory=lambda: os.getenv("ELASTICSEARCH_URL", "https://localhost:9200")
    )
    api_key: str = Field(default_factory=lambda: os.getenv("ELASTIC_API_KEY", ""))


class BackendConfig(BaseModel):
    url: str = Field(
        default_factory=lambda: os.getenv("RENDER_BACKEND_URL", "http://localhost:3000")
    )


class LLMConfig(BaseModel):
    # XAI_API_KEY for xAI/Grok; OPENAI_API_KEY for OpenAI (XAI takes precedence)
    api_key: str = Field(
        default_factory=lambda: os.getenv("XAI_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    )
    base_url: str = Field(
        default_factory=lambda: os.getenv("LLM_BASE_URL", "")  # https://api.x.ai/v1 for xAI
    )
    model: str = Field(
        default_factory=lambda: os.getenv(
            "LLM_MODEL",
            os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        )
    )


class AgentConfig(BaseModel):
    seed: str = Field(default_factory=lambda: os.getenv("CONCEPT_CARD_AGENT_SEED", ""))
    port: int = Field(default_factory=lambda: int(os.getenv("CONCEPT_CARD_AGENT_PORT", "8010")))
    poll_interval_sec: float = Field(
        default_factory=lambda: float(os.getenv("CONCEPT_CARD_AGENT_POLL_INTERVAL", "45"))
    )


class ConceptCardAgentConfig(BaseModel):
    elastic: ElasticConfig = Field(default_factory=ElasticConfig)
    backend: BackendConfig = Field(default_factory=BackendConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)


def get_config() -> ConceptCardAgentConfig:
    return ConceptCardAgentConfig()
