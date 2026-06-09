from typing import Any

from config import (
    LLM_MIN_P,
    LLM_MMPROJ_PATH,
    LLM_MODEL_PATH,
    LLM_N_CTX,
    LLM_PRESENCE_PENALTY,
    LLM_REPEAT_PENALTY,
    LLM_TEMPERATURE,
    LLM_TOP_K,
    LLM_TOP_P,
)
from llama_cpp import Llama

_llm: Llama | None = None


def get_llm() -> Llama:
    global _llm
    if _llm is None:
        kwargs = {
            "model_path": LLM_MODEL_PATH,
            "n_ctx": LLM_N_CTX,
            "verbose": True,
        }
        if LLM_MMPROJ_PATH:
            kwargs["mmproj"] = LLM_MMPROJ_PATH
        _llm = Llama(**kwargs)
    return _llm


def generate_stream(messages: list[dict]):
    llm = get_llm()

    gen_kwargs: dict[str, Any] = {}
    if LLM_TEMPERATURE is not None:
        gen_kwargs["temperature"] = LLM_TEMPERATURE
    if LLM_TOP_P is not None:
        gen_kwargs["top_p"] = LLM_TOP_P
    if LLM_TOP_K is not None:
        gen_kwargs["top_k"] = LLM_TOP_K
    if LLM_MIN_P is not None:
        gen_kwargs["min_p"] = LLM_MIN_P
    if LLM_PRESENCE_PENALTY is not None:
        gen_kwargs["presence_penalty"] = LLM_PRESENCE_PENALTY
    if LLM_REPEAT_PENALTY is not None:
        gen_kwargs["repeat_penalty"] = LLM_REPEAT_PENALTY
    stream = llm.create_chat_completion(
        messages=messages,  # type: ignore[arg-type]
        stream=True,
        **gen_kwargs,
    )
    for chunk in stream:
        token = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")  # type: ignore[union-attr]
        if token:
            yield token
