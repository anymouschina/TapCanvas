import os
from pydantic import BaseModel, Field
from typing import Any, Optional

from langchain_core.runnables import RunnableConfig


class Configuration(BaseModel):
    """The configuration for the agent."""

    query_generator_model: str = Field(
        default="gemini-2.0-flash",
        metadata={
            "description": "The name of the language model to use for the agent's query generation."
        },
    )

    role_selector_model: str = Field(
        default="gemini-2.0-flash",
        metadata={
            "description": "The model used to classify user intent and select the active role."
        },
    )

    reflection_model: str = Field(
        default="gemini-2.5-flash",
        metadata={
            "description": "The name of the language model to use for the agent's reflection."
        },
    )

    answer_model: str = Field(
        default="gemini-2.5-pro",
        metadata={
            "description": "The name of the language model to use for the agent's answer."
        },
    )

    safety_classifier_model: str = Field(
        default="gemini-2.0-flash",
        metadata={
            "description": "Model used for safety classification decisions (sexual/gore/violence) to avoid brittle keyword heuristics.",
        },
    )

    number_of_initial_queries: int = Field(
        default=3,
        metadata={"description": "The number of initial search queries to generate."},
    )

    max_research_loops: int = Field(
        default=2,
        metadata={"description": "The maximum number of research loops to perform."},
    )

    hard_max_research_loops: int = Field(
        default=10,
        metadata={"description": "Hard cap for any research loop to prevent runaway cycles."},
    )

    hard_max_turn_loops: int = Field(
        default=10,
        metadata={"description": "Hard cap for repeated in-thread agent loops to prevent self-looping behavior."},
    )

    search_provider: str = Field(
        default="disabled",
        metadata={
            "description": "Knowledge/search provider to use. Options: 'google', 'openai', 'autorag', or 'disabled'."
        },
    )

    search_model: str = Field(
        default="gemini-2.0-flash",
        metadata={"description": "Model to use for the search step (Gemini or GPT depending on provider)."},
    )

    llm_provider: str = Field(
        default="auto",
        metadata={
            "description": "Provider for generate/reflection/answer steps. Options: 'auto', 'gemini', or 'openai'."
        },
    )

    autorag_endpoint: str = Field(
        default="",
        metadata={
            "description": "Internal AutoRAG proxy endpoint (Worker route), e.g. https://ai.beqlee.icu/internal/autorag/search",
        },
    )

    autorag_id: str = Field(
        default="",
        metadata={"description": "Cloudflare AutoRAG deployment id (passed to env.AI.autorag(id))."},
    )

    @classmethod
    def from_runnable_config(
        cls, config: Optional[RunnableConfig] = None
    ) -> "Configuration":
        """Create a Configuration instance from a RunnableConfig."""
        configurable = (
            config["configurable"] if config and "configurable" in config else {}
        )

        def _default(field: str) -> Any:
            return cls.model_fields[field].default

        # Get raw values from environment or config
        raw_values: dict[str, Any] = {}
        for name in cls.model_fields.keys():
            env_val = os.environ.get(name.upper())
            cfg_val = configurable.get(name)
            raw_values[name] = env_val if env_val is not None else cfg_val

        # Filter out None values
        values = {k: v for k, v in raw_values.items() if v is not None}

        llm_provider = values.get("llm_provider", _default("llm_provider"))
        llm_provider = str(llm_provider).lower().strip()
        if llm_provider == "auto":
            llm_provider = "openai" if os.environ.get("OPENAI_API_KEY") else "gemini"

        # If using OpenAI provider and models are missing/invalid, default to gpt-5.2
        if llm_provider == "openai":
            for field in (
                "query_generator_model",
                "role_selector_model",
                "reflection_model",
                "answer_model",
                "safety_classifier_model",
            ):
                if field not in values or not values[field]:
                    values[field] = "gpt-5.2"
                elif isinstance(values[field], str) and values[field].startswith("gpt-5.") and values[field] != "gpt-5.2":
                    values[field] = "gpt-5.2"

        if values.get("search_provider", _default("search_provider")).lower() == "openai":
            if "search_model" not in values or not values["search_model"]:
                values["search_model"] = "gpt-5.2"
            elif isinstance(values["search_model"], str) and values["search_model"].startswith("gpt-5.") and values["search_model"] != "gpt-5.2":
                values["search_model"] = "gpt-5.2"

        return cls(**values)
