import re
import time

from . import models as m
from .ai.client import LiveExtractor, StructuredLLM
from .ai.evidence import validate_extractive_answer
from .ai.schemas import AnswerQuote, ExtractiveAnswer

ADVICE = re.compile(
    r"매수|매도|목표\s*주가|목표가|사야|팔아야|사도\s*돼|살까|팔까|자동매매|buy|sell|price\s*target|guaranteed",
    re.I,
)


def answer_question(settings, factory, user_id, document_id, question, evidence):
    mode = "demo" if settings.demo_mode else "extractive"
    if ADVICE.search(question):
        return {
            "status": "policy_blocked",
            "message": "매수·매도 추천, 목표주가, 확정적인 주가 전망은 제공하지 않습니다. 공시의 사실과 변경점에 관해 질문해 주세요.",
            "evidence": [],
            "run_id": None,
            "mode": mode,
        }
    run_id, start = m.uid(), time.monotonic()
    with factory.begin() as s:
        s.add(
            m.AIRun(
                id=run_id,
                document_id=document_id,
                user_id=user_id,
                stage="followup",
                model="fixture-evidence-selector"
                if settings.demo_mode
                else (settings.openai_model or "unconfigured"),
                prompt_version="followup-v1",
                pipeline_version="pipeline-v1",
                status="running",
            )
        )
    llm = None
    try:
        source_map = {item["fact_id"]: item["quote"] for item in evidence}
        if settings.demo_mode:
            words = {w.casefold() for w in re.findall(r"[a-zA-Z가-힣]{2,}", question)}
            aliases = {
                "매출": "revenue",
                "배당": "dividend",
                "설비": "capex",
                "설비투자": "capex",
                "위험": "risk",
                "리스크": "risk",
                "경영진": "management",
            }
            words |= {v for k, v in aliases.items() if k in question}
            selected = [item for item in evidence if any(word in item["quote"].casefold() for word in words)]
            answer = ExtractiveAnswer(
                abstain=not selected,
                quotes=[AnswerQuote(source_id=x["fact_id"], quote=x["quote"]) for x in selected[:5]],
            )
        else:
            llm = StructuredLLM(settings, factory)
            answer = LiveExtractor(llm).answer(
                question, [{"source_id": k, "source_text": v} for k, v in source_map.items()]
            )
        quotes = validate_extractive_answer(answer, source_map)
        accepted = []
        for quoted in quotes:
            item = next(item for item in evidence if item["fact_id"] == quoted["source_id"])
            accepted.append({**quoted, "source_url": item["source_url"], "location": item["location"]})
        status = "answered" if accepted else "abstained"
        with factory.begin() as s:
            run = s.get(m.AIRun, run_id)
            run.status = status
            run.latency_ms = int((time.monotonic() - start) * 1000)
            run.finished_at = m.now()
            run.validation_result = {
                "mode": "extractive",
                "accepted_citations": len(accepted),
                "question_stored": False,
                "untrusted_content_has_no_tools": True,
            }
            if llm:
                run.input_tokens, run.output_tokens = llm.usage.input_tokens, llm.usage.output_tokens
                run.cost_usd, run.model_version = llm.usage.cost(settings), llm.usage.model_version
            else:
                run.input_tokens, run.output_tokens, run.cost_usd = 0, 0, 0
                run.model_version = "fixture-selector-v1"
        return {
            "status": status,
            "message": "질문과 관련해 원문에서 확인되는 근거입니다. 아래는 생성한 주장이 아니라 원문 인용입니다."
            if accepted
            else "제공된 공시 근거만으로 이 질문에 답하기 어렵습니다. 확인되지 않은 내용을 추측하지 않습니다.",
            "evidence": accepted,
            "run_id": run_id,
            "mode": mode,
        }
    except Exception as exc:
        with factory.begin() as s:
            run = s.get(m.AIRun, run_id)
            run.status, run.error_code = "failed", getattr(exc, "code", type(exc).__name__)[:100]
            run.latency_ms, run.finished_at = int((time.monotonic() - start) * 1000), m.now()
            if llm:
                run.input_tokens, run.output_tokens = llm.usage.input_tokens, llm.usage.output_tokens
                run.cost_usd, run.model_version = llm.usage.cost(settings), llm.usage.model_version
        return {
            "status": "unavailable",
            "message": "근거 확인을 완료하지 못했습니다. 잠시 후 다시 시도하거나 아래 공시 원문을 확인해 주세요.",
            "evidence": [],
            "run_id": run_id,
            "mode": mode,
        }
    finally:
        if llm:
            llm.close()
