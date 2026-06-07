from llama_cpp import Llama, llama_cpp
from config import (
    LLM_MODEL_PATH,
    LLM_MMPROJ_PATH,
    LLM_N_CTX,
    LLM_TEMPERATURE,
    LLM_TOP_P,
    LLM_TOP_K,
    LLM_MIN_P,
    LLM_PRESENCE_PENALTY,
    LLM_REPEAT_PENALTY,
)

_llm: Llama | None = None


def get_llm() -> Llama:
    global _llm
    if _llm is None:
        kwargs = {
            "model_path": LLM_MODEL_PATH,
            "n_ctx": LLM_N_CTX,
            "verbose": False,
        }
        if LLM_MMPROJ_PATH:
            kwargs["mmproj"] = LLM_MMPROJ_PATH
        _llm = Llama(**kwargs)
    return _llm


def _log_perf(llm: Llama) -> None:
    d = llama_cpp.llama_perf_context(llm.ctx)
    if d.n_p_eval > 0:
        mspt = d.t_p_eval_ms / d.n_p_eval
        tps = d.n_p_eval / (d.t_p_eval_ms / 1000)
        print(f"prompt eval time = {d.t_p_eval_ms:>10.2f} ms / {d.n_p_eval:>5} tokens ({mspt:>8.2f} ms per token, {tps:>8.2f} tokens per second)")
    if d.n_eval > 0:
        mspt = d.t_eval_ms / d.n_eval
        tps = d.n_eval / (d.t_eval_ms / 1000)
        print(f"       eval time = {d.t_eval_ms:>10.2f} ms / {d.n_eval:>5} tokens ({mspt:>8.2f} ms per token, {tps:>8.2f} tokens per second)")
    total_tokens = d.n_p_eval + d.n_eval
    total_time = d.t_p_eval_ms + d.t_eval_ms
    print(f"      total time = {total_time:>10.2f} ms / {total_tokens:>5} tokens")


def generate_stream(messages: list[dict]):
    llm = get_llm()
    llama_cpp.llama_perf_context_reset(llm.ctx)

    stream = llm.create_chat_completion(
        messages=messages,  # type: ignore[arg-type]
        stream=True,
        temperature=LLM_TEMPERATURE,
        top_p=LLM_TOP_P,
        top_k=LLM_TOP_K,
        min_p=LLM_MIN_P,
        presence_penalty=LLM_PRESENCE_PENALTY,
        repeat_penalty=LLM_REPEAT_PENALTY,
    )
    for chunk in stream:
        token = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")  # type: ignore[union-attr]
        if token:
            yield token

    _log_perf(llm)
